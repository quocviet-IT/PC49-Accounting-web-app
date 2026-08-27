-- 0017_refining_lot.sql
-- A refining lot: scrap and bullion sent away to be melted down and returned as
-- Grain.
--
-- Two things make this more than a list. PC49 pools shipments with a
-- counterparty, so OWNERSHIP SITS ON EACH LINE and PC49's inventory must never
-- absorb the partner's metal. And the rates and prices that applied when the lot
-- was sent are stamped onto the lot, so changing a parameter next month cannot
-- rewrite what a closed lot was worth.

DO $$ BEGIN
  CREATE TYPE pc49.refining_status AS ENUM
    ('DRAFT', 'SENT', 'ASSAYED', 'RECEIVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.refining_lot (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_code                text NOT NULL UNIQUE,
  status                  pc49.refining_status NOT NULL DEFAULT 'DRAFT',
  refinery_name           text,

  -- Stage 1: gold leaves the vault.
  sent_date               date,
  spot_gold_per_oz_sent   numeric(18,6),
  spot_pt_per_oz_sent     numeric(18,6),

  -- Stage 2: the refinery confirms weight and purity. This is NOT the refined
  -- output: in lot S26.02 the weight recorded here equals the gross weight sent.
  assay_date              date,
  spot_gold_per_oz_assay  numeric(18,6),

  -- Stage 3: refined Grain actually comes back. The spreadsheet has no columns
  -- for this stage at all, which is why nobody can prove a lot was settled.
  received_date           date,

  -- Snapshotted from system_param when the lot is sent, never read live.
  fee_pct_gold            numeric(8,4),
  fee_pct_pt              numeric(8,4),

  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid
);

CREATE TABLE IF NOT EXISTS pc49.refining_lot_line (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id             uuid NOT NULL REFERENCES pc49.refining_lot (id) ON DELETE CASCADE,
  seq                int  NOT NULL,
  -- PC49, or the counterparty the shipment was pooled with.
  owner_code         text NOT NULL,
  metal              pc49.metal NOT NULL DEFAULT 'GOLD',
  -- What was sent, in the accountant's own words: "18CS", "SCRAP 706.4GR 73.51%".
  source_desc        text,
  gold_type_code     text REFERENCES pc49.gold_type (code),
  gross_weight_gram  numeric(18,4),
  gold_pct           numeric(8,4),
  pure_weight_gram   numeric(18,6)
    GENERATED ALWAYS AS (gross_weight_gram * gold_pct) STORED,
  assay_pct          numeric(8,4),
  assay_weight_gram  numeric(18,4),
  photo_asset_id     uuid,
  UNIQUE (lot_id, seq)
);

CREATE INDEX IF NOT EXISTS refining_lot_line_lot_idx   ON pc49.refining_lot_line (lot_id);
CREATE INDEX IF NOT EXISTS refining_lot_line_owner_idx ON pc49.refining_lot_line (owner_code);

-- The cycle runs one way, one stage at a time. Skipping assay would let an
-- unweighed lot be received; going backwards would let a settled lot be reopened
-- and re-sent without anyone noticing.
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
    SELECT string_agg(DISTINCT l.owner_code, ', ') INTO v_unpaid
      FROM pc49.refining_lot_line l
     WHERE l.lot_id = NEW.id
       AND NOT EXISTS (SELECT 1 FROM pc49.refining_receipt r
                        WHERE r.lot_id = NEW.id AND r.owner_code = l.owner_code);
    IF v_unpaid IS NOT NULL THEN
      RAISE EXCEPTION 'lot % still owes metal to %', NEW.lot_code, v_unpaid;
    END IF;
  END IF;

  RETURN NEW;
END $$;

ALTER TABLE pc49.refining_lot      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.refining_lot_line ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refining_lot_read ON pc49.refining_lot;
CREATE POLICY refining_lot_read ON pc49.refining_lot
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

-- The accountant assembles a lot; the supervisor approves it. Both may write.
DROP POLICY IF EXISTS refining_lot_write ON pc49.refining_lot;
CREATE POLICY refining_lot_write ON pc49.refining_lot
  FOR ALL USING (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'));

DROP POLICY IF EXISTS refining_lot_line_read ON pc49.refining_lot_line;
CREATE POLICY refining_lot_line_read ON pc49.refining_lot_line
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS refining_lot_line_write ON pc49.refining_lot_line;
CREATE POLICY refining_lot_line_write ON pc49.refining_lot_line
  FOR ALL USING (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.refining_lot, pc49.refining_lot_line TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0017_refining_lot')
ON CONFLICT (version) DO NOTHING;
