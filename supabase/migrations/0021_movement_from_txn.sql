-- 0021_movement_from_txn.sql
-- Stock movements are generated from the transaction, never typed.
--
-- Provisional value comes from cogs_price for the day, the same function the
-- ledger uses, so stock and cost of sales can never disagree about what a gram
-- was worth on a given date.
--
-- Note what this does NOT do: it never reads qty_gram off the journal. The
-- source records each physical movement twice, once on the revenue line and
-- once on the cost line, so summing the journal double counts weight. P2 pinned
-- both readings with tests; inventory reads the transaction instead.

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

  ELSIF t.txn_type = 'TRANSFER_OUT' THEN
    -- Away to the refinery. It has left the vault but PC49 still owns it.
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

-- Movements follow the ledger: a transaction moves stock at the moment it is
-- posted, not when it is typed.
CREATE OR REPLACE FUNCTION pc49.gold_txn_after_post()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF NEW.journal_entry_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.journal_entry_id IS NULL) THEN
    PERFORM pc49.record_inventory_movement(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_txn_after_post ON pc49.gold_txn;
CREATE TRIGGER gold_txn_after_post
  AFTER INSERT OR UPDATE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_after_post();

INSERT INTO pc49.schema_migrations (version) VALUES ('0021_movement_from_txn')
ON CONFLICT (version) DO NOTHING;
