-- 0005_prices.sql
-- Daily prices and the costing rule.
--
-- From the Data sheet of GENERAL REPORT: "Gia TT la gia thi truong lay theo gia
-- cua Amark. Gia von hang ban la binh quan gia mua tai ngay hom do; neu khong co
-- lay gia TT." There is no FIFO and no lot-based weighted average. That is the
-- client's accounting policy and must not be changed unilaterally.

CREATE TABLE IF NOT EXISTS pc49.gold_price_daily (
  price_date          date NOT NULL,
  gold_type_code      text NOT NULL REFERENCES pc49.gold_type (code),
  -- Both prices are quoted in the gold type's native unit.
  market_price        numeric(18,6),
  avg_purchase_price  numeric(18,6),
  variance            numeric(18,6) GENERATED ALWAYS AS (market_price - avg_purchase_price) STORED,
  source              text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (price_date, gold_type_code)
);

DO $$ BEGIN
  CREATE TYPE pc49.metal AS ENUM ('GOLD', 'PLATINUM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.spot_price_daily (
  price_date     date NOT NULL,
  metal          pc49.metal NOT NULL,
  spot_per_oz    numeric(18,6) NOT NULL,
  -- Value conversion uses VALUATION_GRAM_PER_OZ (31.1), never the weight
  -- conversion factor for an ounce (31.105). The source uses two different
  -- numbers for these two purposes on purpose.
  spot_per_gram  numeric(18,7) GENERATED ALWAYS AS (spot_per_oz / 31.1) STORED,
  source         text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (price_date, metal)
);

-- Cost of goods sold for a gold type on a given day.
-- Returns null when no price of any kind is recorded for that day.
CREATE OR REPLACE FUNCTION pc49.cogs_price(d date, gt text)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT coalesce(avg_purchase_price, market_price)
    FROM pc49.gold_price_daily
   WHERE price_date = d AND gold_type_code = gt
$$;

ALTER TABLE pc49.gold_price_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.spot_price_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gold_price_read ON pc49.gold_price_daily;
CREATE POLICY gold_price_read ON pc49.gold_price_daily
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

-- The accountant maintains prices daily, so this is not admin-only.
DROP POLICY IF EXISTS gold_price_write ON pc49.gold_price_daily;
CREATE POLICY gold_price_write ON pc49.gold_price_daily
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS spot_price_read ON pc49.spot_price_daily;
CREATE POLICY spot_price_read ON pc49.spot_price_daily
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS spot_price_write ON pc49.spot_price_daily;
CREATE POLICY spot_price_write ON pc49.spot_price_daily
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON pc49.gold_price_daily, pc49.spot_price_daily TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0005_prices')
ON CONFLICT (version) DO NOTHING;
