-- 0050_taking_money_instead_of_metal.sql
-- An owner on a refining lot may take the money instead of the metal.
--
-- Reported by the accountant: "Chuc nang phan kim hien khong dung voi quy
-- trinh hien tai". The source sheet says what was missing. In
-- `[BC 201] PC49 Sales Report_Y2026`, sheet `3.3 MH SCRAP GOLD`, column S is
-- headed `Lấy tiền / Lấy vàng` — take the money, or take the gold. It is a
-- choice made per owner, on every pooled lot, and this system had no way to
-- record it.
--
-- `refining_receipt` could only describe metal coming back: `qty_gram > 0`,
-- nothing else. So a lot where the pooling partner took cash could never be
-- settled, and — worse — could never be closed, because the closing rule reads
-- "every owner has a receipt" and a cash settlement produced none. The lot sat
-- open for ever, and the verification suite asserted that as correct
-- behaviour.
--
-- A settlement is therefore one of two shapes, and the row says which:
--
--   METAL  qty_gram, and a gold type it came back as
--   CASH   amount_usd, and no weight at all
--
-- Not two nullable columns anybody may fill in either combination: the check
-- below makes the shape follow the kind, so a cash settlement carrying a
-- weight, or metal carrying a price and no weight, is refused rather than
-- averaged into a report later.

DO $$ BEGIN
  CREATE TYPE pc49.refining_settle_kind AS ENUM ('METAL', 'CASH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE pc49.refining_receipt
  ADD COLUMN IF NOT EXISTS settle_kind pc49.refining_settle_kind NOT NULL DEFAULT 'METAL';

ALTER TABLE pc49.refining_receipt
  ADD COLUMN IF NOT EXISTS amount_usd numeric(18,2);

-- The weight was mandatory and positive. It still is for metal; for cash there
-- is no weight to record, so the requirement moves from the column to the kind.
ALTER TABLE pc49.refining_receipt
  ALTER COLUMN qty_gram DROP NOT NULL;

ALTER TABLE pc49.refining_receipt
  DROP CONSTRAINT IF EXISTS refining_receipt_qty_gram_check;

ALTER TABLE pc49.refining_receipt
  DROP CONSTRAINT IF EXISTS refining_receipt_shape_follows_kind;

ALTER TABLE pc49.refining_receipt
  ADD CONSTRAINT refining_receipt_shape_follows_kind CHECK (
    (settle_kind = 'METAL' AND qty_gram > 0 AND amount_usd IS NULL)
    OR
    (settle_kind = 'CASH' AND amount_usd > 0 AND qty_gram IS NULL)
  );

COMMENT ON COLUMN pc49.refining_receipt.settle_kind IS
  'Lấy vàng (METAL) or Lấy tiền (CASH), per column S of sheet 3.3 MH SCRAP GOLD.';

-- ---- Closing a lot ------------------------------------------------------------
--
-- The rule was "every owner has a receipt", which silently meant "every owner
-- took metal". It becomes "every owner has been settled", either way. The
-- message says which owners still have not, because "lot S26.02 cannot close"
-- with no name in it sends somebody reading the whole sheet.

CREATE OR REPLACE FUNCTION pc49.refining_lot_check_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_order  constant pc49.refining_status[] :=
    ARRAY['DRAFT', 'SENT', 'ASSAYED', 'RECEIVED', 'CLOSED']::pc49.refining_status[];
  v_from   int;
  v_to     int;
  v_unpaid text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  v_from := array_position(v_order, OLD.status);
  v_to   := array_position(v_order, NEW.status);

  IF v_to <> v_from + 1 THEN
    RAISE EXCEPTION 'a lot cannot move from % to %: the cycle runs one stage at a time',
      OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'SENT' THEN
    IF NEW.sent_date IS NULL THEN
      RAISE EXCEPTION 'lot % needs a send date before it can be sent', NEW.lot_code;
    END IF;
    IF NEW.spot_gold_per_oz_sent IS NULL AND NEW.spot_pt_per_oz_sent IS NULL THEN
      RAISE EXCEPTION 'lot % needs the spot price on the day it was sent', NEW.lot_code;
    END IF;
    -- Freeze the rates that applied today.
    SELECT value INTO NEW.fee_pct_gold FROM pc49.system_param WHERE key = 'REFINING_FEE_PCT_GOLD';
    SELECT value INTO NEW.fee_pct_pt   FROM pc49.system_param WHERE key = 'REFINING_FEE_PCT_PT';
  END IF;

  IF NEW.status = 'ASSAYED' AND NEW.assay_date IS NULL THEN
    RAISE EXCEPTION 'lot % needs an assay date', NEW.lot_code;
  END IF;

  IF NEW.status = 'CLOSED' THEN
    -- "Has a receipt", which now means settled either way: a cash settlement
    -- is a row here exactly as a metal one is. Only the wording had assumed
    -- metal, and it was the wording somebody read at the moment they could not
    -- close a lot that was, in fact, finished.
    SELECT string_agg(DISTINCT l.owner_code, ', ') INTO v_unpaid
      FROM pc49.refining_lot_line l
     WHERE l.lot_id = NEW.id
       AND NOT EXISTS (SELECT 1 FROM pc49.refining_receipt r
                        WHERE r.lot_id = NEW.id AND r.owner_code = l.owner_code);
    IF v_unpaid IS NOT NULL THEN
      RAISE EXCEPTION 'lot % has not settled with %', NEW.lot_code, v_unpaid;
    END IF;
  END IF;

  RETURN NEW;
END $$;


-- ---- Recording a settlement ---------------------------------------------------
--
-- The old signature could only be handed a weight. Dropped rather than
-- overloaded: two functions of the same name, one of which silently means
-- "metal", is how a caller ends up settling in the wrong shape without ever
-- seeing an error.

DROP FUNCTION IF EXISTS pc49.receive_refining(uuid, date, text, numeric, numeric);

CREATE OR REPLACE FUNCTION pc49.receive_refining(
  p_lot_id      uuid,
  p_date        date,
  p_owner_code  text,
  p_qty_gram    numeric DEFAULT NULL,
  p_unit_price  numeric DEFAULT NULL,
  p_settle_kind pc49.refining_settle_kind DEFAULT 'METAL',
  p_amount_usd  numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_status  pc49.refining_status;
  v_code    text;
  v_id      uuid;
BEGIN
  SELECT status, lot_code INTO v_status, v_code FROM pc49.refining_lot WHERE id = p_lot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lot % does not exist', p_lot_id;
  END IF;
  IF v_status NOT IN ('ASSAYED', 'RECEIVED') THEN
    RAISE EXCEPTION 'lot % has not been assayed yet; it is %', v_code, v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pc49.refining_lot_line
                  WHERE lot_id = p_lot_id AND owner_code = p_owner_code) THEN
    RAISE EXCEPTION 'lot % has no line belonging to %', v_code, p_owner_code;
  END IF;

  -- Said here as well as in the table's own check, so the accountant reads
  -- which figure is missing rather than a constraint name.
  IF p_settle_kind = 'METAL' AND coalesce(p_qty_gram, 0) <= 0 THEN
    RAISE EXCEPTION 'taking metal from lot % needs a weight', v_code;
  END IF;
  IF p_settle_kind = 'CASH' AND coalesce(p_amount_usd, 0) <= 0 THEN
    RAISE EXCEPTION 'taking money from lot % needs an amount', v_code;
  END IF;

  INSERT INTO pc49.refining_receipt
    (lot_id, receive_date, gold_type_code, owner_code, settle_kind, qty_gram,
     unit_price, amount_usd)
  VALUES (p_lot_id, p_date, 'GRAIN', p_owner_code, p_settle_kind,
          CASE WHEN p_settle_kind = 'METAL' THEN p_qty_gram END,
          CASE WHEN p_settle_kind = 'METAL' THEN p_unit_price END,
          CASE WHEN p_settle_kind = 'CASH'  THEN p_amount_usd END)
  RETURNING id INTO v_id;

  -- Settling in cash finishes that owner too, so it moves the lot on exactly
  -- as a delivery of metal does.
  IF v_status = 'ASSAYED' THEN
    UPDATE pc49.refining_lot
       SET status = 'RECEIVED', received_date = coalesce(received_date, p_date)
     WHERE id = p_lot_id;
  END IF;

  RETURN v_id;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0050_taking_money_instead_of_metal')
ON CONFLICT (version) DO NOTHING;
