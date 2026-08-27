-- 0026_bank_gold_allocation.sql
-- Working backwards from a bank transaction to the gold it bought or sold.
--
-- The rule, taken verbatim from sheet VIII1 of the process handbook:
--
--   Purchases apply the Amark price; sales apply the market price on the day.
--   A price quoted per Oz converts to Luong by dividing by 0.83.
--   The unit price may vary within +/- $100 of the reference price.
--   Adjust the price so the quantity comes out whole. If the adjusted price
--   then exceeds the band, the excess is recorded as cash.
--
-- That last sentence is why a bank transaction can create a cash movement out
-- of nothing: any matching engine that does not know this will keep producing
-- allocations that look wrong by a few dollars.
--
-- Note on the band: it is expressed in dollars against the reference price in
-- that row's own unit. For gold quoted per Luong or per Oz, in the thousands,
-- $100 is a real constraint. For Grain quoted per gram, around $139, it never
-- binds. That asymmetry is in the source, not introduced here.

CREATE TABLE IF NOT EXISTS pc49.bank_gold_allocation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_txn_id        uuid NOT NULL REFERENCES pc49.cash_txn (id) ON DELETE CASCADE,
  seq                int  NOT NULL,
  gold_type_code     text NOT NULL REFERENCES pc49.gold_type (code),
  qty                numeric(18,4) NOT NULL CHECK (qty <> 0),
  uom                pc49.uom NOT NULL,
  -- What the accountant settled on, so the quantity comes out whole.
  unit_price         numeric(18,6) NOT NULL,
  -- Amark for a purchase, market for a sale, in the same unit as unit_price.
  ref_price          numeric(18,6),
  price_variance     numeric(18,6)
    GENERATED ALWAYS AS (unit_price - ref_price) STORED,
  product_desc       text,
  confirmed_by       uuid,
  confirmed_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cash_txn_id, seq)
);

CREATE INDEX IF NOT EXISTS bank_gold_allocation_txn_idx ON pc49.bank_gold_allocation (cash_txn_id);

-- Whether a line is outside the band. A generated column cannot read
-- system_param, so this is a function and the views call it.
CREATE OR REPLACE FUNCTION pc49.allocation_exceeds_tolerance(p_variance numeric)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT p_variance IS NOT NULL
     AND abs(p_variance) > (SELECT value FROM pc49.system_param
                             WHERE key = 'BANK_PRICE_TOLERANCE_USD')
$$;

-- A line outside the band is the accountant's judgement call, not the system's,
-- so it cannot stand unconfirmed.
CREATE OR REPLACE FUNCTION pc49.bank_gold_allocation_check()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF pc49.allocation_exceeds_tolerance(NEW.unit_price - NEW.ref_price)
     AND NEW.confirmed_by IS NULL THEN
    RAISE EXCEPTION
      'unit price % is more than the allowed band from the reference price %; confirm it explicitly',
      NEW.unit_price, NEW.ref_price;
  END IF;
  IF NEW.confirmed_by IS NOT NULL AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bank_gold_allocation_check ON pc49.bank_gold_allocation;
CREATE TRIGGER bank_gold_allocation_check
  BEFORE INSERT OR UPDATE ON pc49.bank_gold_allocation
  FOR EACH ROW EXECUTE FUNCTION pc49.bank_gold_allocation_check();

-- Converts a price quoted per ounce into a price per luong, using the divisor
-- the accounting team set rather than a literal.
CREATE OR REPLACE FUNCTION pc49.oz_price_to_luong(p_price_per_oz numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT p_price_per_oz
       / (SELECT value FROM pc49.system_param WHERE key = 'OZ_TO_LUONG_PRICE_DIVISOR')
$$;

-- Suggests a whole quantity for an amount at the day's reference price, and the
-- unit price that quantity implies. The accountant accepts or overrides it.
CREATE OR REPLACE FUNCTION pc49.suggest_gold_allocation(
  p_amount numeric, p_gold_type text, p_date date)
RETURNS TABLE (qty numeric, unit_price numeric, ref_price numeric, variance numeric)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH r AS (
    SELECT market_price AS ref FROM pc49.gold_price_daily
     WHERE price_date = p_date AND gold_type_code = p_gold_type
  ), q AS (
    SELECT round(abs(p_amount) / r.ref) AS whole_qty, r.ref FROM r WHERE r.ref > 0
  )
  SELECT q.whole_qty,
         CASE WHEN q.whole_qty = 0 THEN NULL ELSE abs(p_amount) / q.whole_qty END,
         q.ref,
         CASE WHEN q.whole_qty = 0 THEN NULL ELSE abs(p_amount) / q.whole_qty - q.ref END
    FROM q
$$;

-- What a bank transaction was resolved into, and what is left over. The residual
-- is the "excess recorded as cash" the rule describes: it is surfaced, never
-- silently absorbed into a price.
CREATE OR REPLACE VIEW pc49.v_bank_allocation AS
  SELECT t.id AS cash_txn_id,
         t.txn_date,
         t.cash_account_code,
         t.direction,
         t.amount,
         t.description,
         coalesce(a.allocated, 0)                       AS allocated_value,
         t.amount - coalesce(a.allocated, 0)            AS residual_cash,
         coalesce(a.lines, 0)                           AS allocation_lines,
         coalesce(a.needs_confirmation, false)          AS has_unconfirmed_outlier
    FROM pc49.cash_txn t
    LEFT JOIN LATERAL (
      SELECT sum(al.qty * al.unit_price)                        AS allocated,
             count(*)                                           AS lines,
             bool_or(pc49.allocation_exceeds_tolerance(al.price_variance)
                     AND al.confirmed_by IS NULL)               AS needs_confirmation
        FROM pc49.bank_gold_allocation al WHERE al.cash_txn_id = t.id
    ) a ON true
   WHERE t.voided_at IS NULL;

ALTER TABLE pc49.bank_gold_allocation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_gold_allocation_read ON pc49.bank_gold_allocation;
CREATE POLICY bank_gold_allocation_read ON pc49.bank_gold_allocation
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS bank_gold_allocation_write ON pc49.bank_gold_allocation;
CREATE POLICY bank_gold_allocation_write ON pc49.bank_gold_allocation
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON pc49.bank_gold_allocation TO authenticated;
GRANT SELECT ON pc49.v_bank_allocation TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0026_bank_gold_allocation')
ON CONFLICT (version) DO NOTHING;
