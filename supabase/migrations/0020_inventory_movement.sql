-- 0020_inventory_movement.sql
-- One movement ledger, several correct answers.
--
-- Book inventory, physical inventory and total gold assets all read these same
-- rows and differ only by which buckets they count, so they cannot drift apart
-- the way three separate spreadsheets do.
--
-- Deposited gold is the reason more than one answer is correct: it is sold on
-- paper but still on the premises. PHYSICAL GOLD INVENTORY in the source exists
-- to show that second number, and says so - the file "focuses on tracking gold
-- actually in stock, not deducting gold in deposit status, because at that point
-- the gold is still in the shop".

DO $$ BEGIN
  CREATE TYPE pc49.inventory_bucket AS ENUM
    ('ON_HAND', 'DEPOSIT_HELD', 'AT_REFINERY', 'ON_MEMO', 'ON_THE_WAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.valuation_status AS ENUM ('PROVISIONAL', 'DEFINITIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.movement_source AS ENUM ('GOLD_TXN', 'REFINING', 'ADJUSTMENT', 'OPENING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.inventory_movement (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  move_date          date NOT NULL,
  gold_type_code     text NOT NULL REFERENCES pc49.gold_type (code),
  -- PC49, or a counterparty whose metal is passing through a pooled lot. A
  -- partner's weight shares this table but never a PC49 report.
  owner_code         text NOT NULL DEFAULT 'PC49',
  bucket             pc49.inventory_bucket NOT NULL,
  -- Positive into the bucket, negative out of it.
  qty_gram           numeric(18,4) NOT NULL,
  qty_native         numeric(18,4),
  uom                pc49.uom,
  unit_cost          numeric(18,6),

  -- The source values issues provisionally and corrects with an adjustment. In
  -- January 2026 that adjustment was 70,125.12 against a gross profit of
  -- 31,008.27 for the same month, so it is not a rounding artefact and must stay
  -- visible rather than being folded into cost.
  valuation_status   pc49.valuation_status NOT NULL DEFAULT 'PROVISIONAL',
  provisional_value  numeric(18,2),
  definitive_value   numeric(18,2),
  valuation_adjustment numeric(18,2)
    GENERATED ALWAYS AS (definitive_value - provisional_value) STORED,
  valued_at          timestamptz,

  source_type        pc49.movement_source NOT NULL,
  source_id          uuid,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT inventory_movement_definitive_needs_value CHECK (
    valuation_status = 'PROVISIONAL' OR definitive_value IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS inventory_movement_date_idx   ON pc49.inventory_movement (move_date);
CREATE INDEX IF NOT EXISTS inventory_movement_gold_idx   ON pc49.inventory_movement (gold_type_code);
CREATE INDEX IF NOT EXISTS inventory_movement_bucket_idx ON pc49.inventory_movement (bucket);
CREATE INDEX IF NOT EXISTS inventory_movement_source_idx ON pc49.inventory_movement (source_type, source_id);

-- What the books say we own and have not sold.
CREATE OR REPLACE VIEW pc49.v_inventory_book AS
  SELECT gold_type_code, owner_code, sum(qty_gram) AS qty_gram
    FROM pc49.inventory_movement
   WHERE bucket = 'ON_HAND'
   GROUP BY 1, 2;

-- What is actually in the shop. Deposited gold is sold on paper but has not left.
CREATE OR REPLACE VIEW pc49.v_inventory_physical AS
  SELECT gold_type_code, owner_code, sum(qty_gram) AS qty_gram
    FROM pc49.inventory_movement
   WHERE bucket IN ('ON_HAND', 'DEPOSIT_HELD')
   GROUP BY 1, 2;

-- Everything PC49 owns, wherever it happens to be sitting.
CREATE OR REPLACE VIEW pc49.v_inventory_total_asset AS
  SELECT gold_type_code, owner_code, sum(qty_gram) AS qty_gram
    FROM pc49.inventory_movement
   WHERE bucket IN ('ON_HAND', 'DEPOSIT_HELD', 'AT_REFINERY', 'ON_MEMO')
   GROUP BY 1, 2;

ALTER TABLE pc49.inventory_movement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_movement_read ON pc49.inventory_movement;
CREATE POLICY inventory_movement_read ON pc49.inventory_movement
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS inventory_movement_write ON pc49.inventory_movement;
CREATE POLICY inventory_movement_write ON pc49.inventory_movement
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.inventory_movement TO authenticated;
GRANT SELECT ON pc49.v_inventory_book, pc49.v_inventory_physical,
                pc49.v_inventory_total_asset TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0020_inventory_movement')
ON CONFLICT (version) DO NOTHING;
