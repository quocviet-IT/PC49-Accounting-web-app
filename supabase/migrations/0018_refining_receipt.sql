-- 0018_refining_receipt.sql
-- The stage the spreadsheet has no columns for: refined Grain actually coming
-- back, eight days or so after assay.
--
-- Without it the Grain that returns is disconnected from the lot it came from,
-- and nobody can prove a lot was settled or that a pooling partner was paid
-- back. Recording it per owner is what makes "lot S26.02 is closed" a statement
-- somebody can check.

CREATE TABLE IF NOT EXISTS pc49.refining_receipt (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id          uuid NOT NULL REFERENCES pc49.refining_lot (id) ON DELETE CASCADE,
  receive_date    date NOT NULL,
  gold_type_code  text NOT NULL REFERENCES pc49.gold_type (code) DEFAULT 'GRAIN',
  owner_code      text NOT NULL,
  qty_gram        numeric(18,4) NOT NULL CHECK (qty_gram > 0),
  unit_price      numeric(18,6),
  gold_txn_id     uuid REFERENCES pc49.gold_txn (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid
);

CREATE INDEX IF NOT EXISTS refining_receipt_lot_idx ON pc49.refining_receipt (lot_id);

-- The status trigger reads refining_receipt, so it can only be attached once
-- that table exists.
DROP TRIGGER IF EXISTS refining_lot_check_status ON pc49.refining_lot;
CREATE TRIGGER refining_lot_check_status
  BEFORE INSERT OR UPDATE ON pc49.refining_lot
  FOR EACH ROW EXECUTE FUNCTION pc49.refining_lot_check_status();

CREATE OR REPLACE FUNCTION pc49.receive_refining(
  p_lot_id      uuid,
  p_date        date,
  p_owner_code  text,
  p_qty_gram    numeric,
  p_unit_price  numeric DEFAULT NULL)
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

  INSERT INTO pc49.refining_receipt
    (lot_id, receive_date, gold_type_code, owner_code, qty_gram, unit_price)
  VALUES (p_lot_id, p_date, 'GRAIN', p_owner_code, p_qty_gram, p_unit_price)
  RETURNING id INTO v_id;

  IF v_status = 'ASSAYED' THEN
    UPDATE pc49.refining_lot
       SET status = 'RECEIVED', received_date = coalesce(received_date, p_date)
     WHERE id = p_lot_id;
  END IF;

  RETURN v_id;
END $$;

ALTER TABLE pc49.refining_receipt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refining_receipt_read ON pc49.refining_receipt;
CREATE POLICY refining_receipt_read ON pc49.refining_receipt
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS refining_receipt_write ON pc49.refining_receipt;
CREATE POLICY refining_receipt_write ON pc49.refining_receipt
  FOR ALL USING (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.refining_receipt TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0018_refining_receipt')
ON CONFLICT (version) DO NOTHING;
