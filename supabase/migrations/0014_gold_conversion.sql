-- 0014_gold_conversion.sql
-- Turning one kind of gold into another: Transfer, Ra RP, and the two legs of a
-- refining shipment.
--
-- Six of the nine gold types can only be received by conversion from Grain, so
-- this is not a corner case: it is how most stock arrives. One conversion always
-- produces at least two transaction rows sharing a conversion_id.
--
-- Weight in must match weight out within a tolerance the accounting team sets.
-- Beyond the tolerance the conversion is still saved with a warning attached,
-- because the accountant has to be able to record what actually happened and
-- explain it, rather than being blocked by a system that thinks it knows better.

DO $$ BEGIN
  CREATE TYPE pc49.conversion_kind AS ENUM
    ('TRANSFER', 'RA_RP', 'REFINING_SEND', 'REFINING_RECEIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.gold_conversion (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conv_date      date NOT NULL,
  kind           pc49.conversion_kind NOT NULL,
  note           text,
  -- Set when the accountant marks the conversion finished. Balance is checked
  -- at that moment, not on every leg, because the legs are entered one by one.
  completed_at   timestamptz,
  variance_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid
);

ALTER TABLE pc49.gold_txn
  DROP CONSTRAINT IF EXISTS gold_txn_conversion_id_fkey,
  DROP CONSTRAINT IF EXISTS gold_txn_transfer_needs_conversion;

ALTER TABLE pc49.gold_txn
  ADD CONSTRAINT gold_txn_conversion_id_fkey
    FOREIGN KEY (conversion_id) REFERENCES pc49.gold_conversion (id),
  ADD CONSTRAINT gold_txn_transfer_needs_conversion CHECK (
    txn_type NOT IN ('TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP') OR conversion_id IS NOT NULL);

CREATE OR REPLACE FUNCTION pc49.gold_conversion_check_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_in        numeric;
  v_out       numeric;
  v_tolerance numeric;
  v_diff_pct  numeric;
BEGIN
  IF NEW.completed_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(CASE WHEN qty_gram > 0 THEN qty_gram ELSE 0 END), 0),
         coalesce(sum(CASE WHEN qty_gram < 0 THEN -qty_gram ELSE 0 END), 0)
    INTO v_in, v_out
    FROM pc49.gold_txn WHERE conversion_id = NEW.id AND voided_at IS NULL;

  IF v_in = 0 OR v_out = 0 THEN
    RAISE EXCEPTION 'conversion % has only one side: % grams in, % grams out',
      NEW.id, v_in, v_out;
  END IF;

  SELECT value INTO v_tolerance
    FROM pc49.system_param WHERE key = 'CONVERSION_WEIGHT_TOLERANCE_PCT';

  v_diff_pct := abs(v_in - v_out) / v_out * 100;

  IF v_diff_pct > v_tolerance THEN
    NEW.variance_note := format(
      '%s grams out, %s grams in: %s percent difference, tolerance is %s percent',
      v_out, v_in, round(v_diff_pct, 4), v_tolerance);
  ELSE
    NEW.variance_note := NULL;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_conversion_check_balance ON pc49.gold_conversion;
CREATE TRIGGER gold_conversion_check_balance
  BEFORE INSERT OR UPDATE ON pc49.gold_conversion
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_conversion_check_balance();

ALTER TABLE pc49.gold_conversion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gold_conversion_read ON pc49.gold_conversion;
CREATE POLICY gold_conversion_read ON pc49.gold_conversion
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS gold_conversion_write ON pc49.gold_conversion;
CREATE POLICY gold_conversion_write ON pc49.gold_conversion
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.gold_conversion TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0014_gold_conversion')
ON CONFLICT (version) DO NOTHING;
