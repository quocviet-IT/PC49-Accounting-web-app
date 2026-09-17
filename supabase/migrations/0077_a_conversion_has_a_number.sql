-- 0077_a_conversion_has_a_number.sql
-- A conversion becomes something a person enters, numbers, corrects and
-- cancels, and posting one stops sending gold to the refinery.
--
-- Until now every conversion came from the spreadsheet loader, which grouped a
-- day's transfer rows under one key (0063). "cai transfer dau?" (17-09) asked
-- where to enter one. The screen needs what a receipt has (0073): a number, a
-- partner, a revision that moves with any change, a cancellation with a
-- reason, a link from a correction to what it corrects, and a place for the
-- reason a person gives when the weights do not meet, beside the variance_note
-- 0014's trigger writes.
--
-- Two faults are fixed on the way, both about transfer rows:
--
--   record_inventory_movement   sent every TRANSFER_OUT to AT_REFINERY (0021).
--                               Right for a refining lot; wrong for Grain turned
--                               into Rong Phung, where the Grain went on being
--                               counted as owned while the RP was counted too.
--                               Only a refining lot's leg goes there now. None of
--                               the 81 loaded conversion legs is posted yet, so
--                               no recorded movement changes.
--   correction_blocked_code     a refining lot's legs (refining_lot_id, 0056)
--                               could be corrected from the ledger like a
--                               purchase. They answer REFINING_LEG, checked after
--                               every older code so no older answer changes.

ALTER TABLE pc49.gold_conversion
  ADD COLUMN IF NOT EXISTS doc_no                 text,
  ADD COLUMN IF NOT EXISTS partner_code           text,
  ADD COLUMN IF NOT EXISTS variance_reason        text,
  ADD COLUMN IF NOT EXISTS revision               int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS voided_at              timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason            text,
  ADD COLUMN IF NOT EXISTS corrects_conversion_id uuid REFERENCES pc49.gold_conversion (id),
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by             uuid;

ALTER TABLE pc49.gold_conversion
  DROP CONSTRAINT IF EXISTS gold_conversion_void_needs_reason;
ALTER TABLE pc49.gold_conversion
  ADD CONSTRAINT gold_conversion_void_needs_reason CHECK (
    voided_at IS NULL OR btrim(coalesce(void_reason, '')) <> '');

CREATE INDEX IF NOT EXISTS gold_conversion_date_idx ON pc49.gold_conversion (conv_date);

-- The revision rule of a transaction (0055).
DROP TRIGGER IF EXISTS gold_conversion_revision ON pc49.gold_conversion;
CREATE TRIGGER gold_conversion_revision
  BEFORE UPDATE ON pc49.gold_conversion
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_bump_revision();

DROP TRIGGER IF EXISTS audit_gold_conversion ON pc49.gold_conversion;
CREATE TRIGGER audit_gold_conversion
  AFTER INSERT OR UPDATE OR DELETE ON pc49.gold_conversion
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

-- 0071's checks, in 0071's order, and one more at the end.
CREATE OR REPLACE FUNCTION pc49.correction_blocked_code(p_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  t pc49.gold_txn;
BEGIN
  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF t.voided_at IS NOT NULL THEN RETURN 'VOIDED'; END IF;

  IF t.conversion_id IS NOT NULL THEN RETURN 'CONVERSION_LEG'; END IF;
  IF t.deposit_ref_id IS NOT NULL THEN RETURN 'DEPOSIT_PICKUP'; END IF;
  IF EXISTS (SELECT 1 FROM pc49.gold_txn p WHERE p.deposit_ref_id = p_id
              AND p.voided_at IS NULL) THEN
    RETURN 'DEPOSIT_PICKED_UP';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_receipt r WHERE r.gold_txn_id = p_id) THEN
    RETURN 'REFINING_RECEIPT';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_lot_source s WHERE s.txn_id = p_id) THEN
    RETURN 'REFINING_SOURCE';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.cash_txn c WHERE c.gold_txn_id = p_id) THEN
    RETURN 'CASH_LINK';
  END IF;
  IF t.refining_lot_id IS NOT NULL THEN RETURN 'REFINING_LEG'; END IF;

  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION pc49.correction_blocked_reason(p_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
  SELECT CASE pc49.correction_blocked_code(p_id)
    WHEN 'NOT_FOUND'         THEN 'there is no such transaction'
    WHEN 'VOIDED'            THEN 'this transaction has already been cancelled'
    WHEN 'CONVERSION_LEG'    THEN 'this is one leg of a conversion; correct the conversion instead'
    WHEN 'DEPOSIT_PICKUP'    THEN 'this is the pickup for a deposit; the two are corrected together'
    WHEN 'DEPOSIT_PICKED_UP' THEN 'a pickup has already been recorded against this deposit'
    WHEN 'REFINING_RECEIPT'  THEN 'this row came back from a refining lot'
    WHEN 'REFINING_SOURCE'   THEN 'this purchase has been picked into a refining lot'
    WHEN 'CASH_LINK'         THEN 'this is tied to a cash movement'
    WHEN 'REFINING_LEG'      THEN 'this row belongs to a refining lot; correct it on the refining screen'
  END
$$;

-- 0021's body. The one change is the condition on the AT_REFINERY leg.
CREATE OR REPLACE FUNCTION pc49.record_inventory_movement(p_txn_id uuid)
RETURNS int LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  t       pc49.gold_txn;
  v_price numeric;
  v_value numeric;
  v_n     int := 0;
BEGIN
  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_txn_id;
  IF NOT FOUND OR t.voided_at IS NOT NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM pc49.inventory_movement
              WHERE source_type = 'GOLD_TXN' AND source_id = p_txn_id) THEN
    RETURN 0;   -- already recorded
  END IF;

  v_price := pc49.cogs_price(t.txn_date, t.gold_type_code);
  v_value := CASE WHEN v_price IS NULL THEN NULL
                  ELSE round(abs(t.qty) * v_price, 2) END;

  -- ON_HAND leg. Every type except a pickup or a straight on-the-way order
  -- touches it, and qty_gram already carries the sign: a purchase is positive,
  -- a sale negative.
  IF t.txn_type IN ('PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'TRANSFER_IN',
                    'TRANSFER_OUT', 'RA_RP', 'MEMO') THEN
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'ON_HAND', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;
  END IF;

  -- The second leg, for the types that move gold between buckets rather than in
  -- or out of the business.
  IF t.txn_type = 'DEPOSIT' THEN
    -- Sold on paper, still in the shop.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'DEPOSIT_HELD', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'PICKUP' THEN
    -- The customer collects: the gold finally leaves the premises.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'DEPOSIT_HELD', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'CANCEL' THEN
    -- The order falls through: the gold goes back on the shelf.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'DEPOSIT_HELD', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id),
           (t.txn_date, t.gold_type_code, 'ON_HAND', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 2;

  ELSIF t.txn_type = 'TRANSFER_OUT' AND t.refining_lot_id IS NOT NULL THEN
    -- Away to the refinery. It has left the vault but PC49 still owns it. A
    -- conversion's transfer out has no second leg: the gold became another
    -- kind of gold in the vault, which its TRANSFER_IN leg records.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'AT_REFINERY', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'MEMO' THEN
    -- Lent out. The source admits it does not track whether these come back;
    -- keeping them in their own bucket is what makes that answerable.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'ON_MEMO', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'ON_THE_WAY' THEN
    -- Ordered from a vendor, not yet received: owned but not yet in the vault.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'ON_THE_WAY', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;
  END IF;

  RETURN v_n;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0077_a_conversion_has_a_number')
ON CONFLICT (version) DO NOTHING;
