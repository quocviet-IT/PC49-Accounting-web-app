-- 0002_reference_data.sql
-- Units, business constants and the nine gold types PC49 trades.

DO $$ BEGIN
  CREATE TYPE pc49.uom AS ENUM ('GRAM', 'OZ', 'LUONG');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Weight conversion only. Value conversion uses system_param.VALUATION_GRAM_PER_OZ,
-- which is 31.1, not 31.105. The source workbooks use two different numbers on
-- purpose; do not reconcile them.
CREATE TABLE IF NOT EXISTS pc49.uom_factor (
  uom            pc49.uom PRIMARY KEY,
  gram_per_unit  numeric(12,5) NOT NULL CHECK (gram_per_unit > 0)
);

INSERT INTO pc49.uom_factor (uom, gram_per_unit) VALUES
  ('GRAM',  1),
  ('OZ',    31.105),
  ('LUONG', 37.5)
ON CONFLICT (uom) DO UPDATE SET gram_per_unit = excluded.gram_per_unit;

CREATE TABLE IF NOT EXISTS pc49.system_param (
  key         text PRIMARY KEY,
  value       numeric(18,6) NOT NULL,
  unit        text,
  description text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO pc49.system_param (key, value, unit, description) VALUES
  ('VALUATION_GRAM_PER_OZ',           31.1,  'gram/oz',
   'Divisor for inventory value: weight x spot per oz / this. Deliberately not 31.105.'),
  ('OZ_TO_LUONG_PRICE_DIVISOR',       0.83,  NULL,
   'Converts a unit price quoted per oz into a price per luong.'),
  ('BANK_PRICE_TOLERANCE_USD',        100,   'USD',
   'Allowed variance from the reference price when converting a bank transaction into gold.'),
  ('CONVERSION_WEIGHT_TOLERANCE_PCT', 0.5,   'percent',
   'Allowed gram difference between the in and out sides of an internal conversion.'),
  ('REFINING_FEE_PCT_GOLD',           0.5,   'percent',
   'Refining loss rate for gold. Confirmed by the US team 2026-08-27.'),
  ('REFINING_FEE_PCT_PT',             5.0,   'percent',
   'Refining loss rate for platinum. Confirmed by the US team 2026-08-27.')
ON CONFLICT (key) DO UPDATE
  SET value = excluded.value, description = excluded.description, updated_at = now();

CREATE TABLE IF NOT EXISTS pc49.gold_type (
  code                text PRIMARY KEY,
  name_vi             text NOT NULL,
  name_en             text NOT NULL,
  native_uom          pc49.uom NOT NULL,
  inventory_account   text,
  cogs_account        text,
  in_transit_account  text,
  sort_order          int  NOT NULL,
  is_active           boolean NOT NULL DEFAULT true
);

INSERT INTO pc49.gold_type
  (code, name_vi, name_en, native_uom, inventory_account, cogs_account, in_transit_account, sort_order) VALUES
  ('RP',    'Rồng Phụng',     'Rong Phung',     'LUONG', '156RP',    '632RP',    '157RP',    1),
  ('9999',  'Vàng 9999',      '9999',           'LUONG', '155-9999', '632-9999', '157-9999', 2),
  ('ML',    'Maple Leaf',     'Maple Leaf',     'OZ',    '156ML',    '632ML',    '157ML',    3),
  ('CS',    'Credit Suisse',  'Credit Suisse',  'OZ',    '156CS',    '632CS',    '157CS',    4),
  ('AE',    'American Eagle', 'American Eagle', 'OZ',    '156AE',    '632AE',    '157AE',    5),
  ('OTH',   'Vàng khác',      'Other',          'OZ',    '156Other', '632Oth',   '157Other', 6),
  ('SG',    'Vàng vụn',       'Scrap Gold',     'GRAM',  '155SG',    '632SG',    '157SG',    7),
  ('GRAIN', 'Vàng Grain',     'Grain',          'GRAM',  '155Grain', '632Grain', '157Grain', 8),
  ('PT',    'Bạch kim',       'Platinum',       'GRAM',  '155PT',    '632PT',    '157PT',    9)
ON CONFLICT (code) DO UPDATE SET
  name_vi = excluded.name_vi, name_en = excluded.name_en, native_uom = excluded.native_uom,
  inventory_account = excluded.inventory_account, cogs_account = excluded.cogs_account,
  in_transit_account = excluded.in_transit_account, sort_order = excluded.sort_order;

ALTER TABLE pc49.uom_factor   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.system_param ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.gold_type    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uom_factor_read ON pc49.uom_factor;
CREATE POLICY uom_factor_read ON pc49.uom_factor
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS system_param_read ON pc49.system_param;
CREATE POLICY system_param_read ON pc49.system_param
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS system_param_admin_write ON pc49.system_param;
CREATE POLICY system_param_admin_write ON pc49.system_param
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

DROP POLICY IF EXISTS gold_type_read ON pc49.gold_type;
CREATE POLICY gold_type_read ON pc49.gold_type
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS gold_type_admin_write ON pc49.gold_type;
CREATE POLICY gold_type_admin_write ON pc49.gold_type
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

GRANT SELECT ON pc49.uom_factor, pc49.system_param, pc49.gold_type TO authenticated;
GRANT INSERT, UPDATE, DELETE ON pc49.system_param, pc49.gold_type TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0002_reference_data')
ON CONFLICT (version) DO NOTHING;
