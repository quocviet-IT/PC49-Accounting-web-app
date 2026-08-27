-- 0004_gold_flow_rules.sql
-- The valid inbound and outbound paths for each gold type, taken verbatim from
-- the Link sheet of GENERAL REPORT.
--
-- This is stored as data rather than encoded in application code because it is
-- a business rule the accounting team owns and changes. P3 enforces it with a
-- trigger on gold_txn.

DO $$ BEGIN
  CREATE TYPE pc49.txn_type AS ENUM (
    'PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'PICKUP',
    'TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP', 'ON_THE_WAY', 'CANCEL', 'MEMO'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.flow_direction AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.gold_flow_rule (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gold_type_code         text NOT NULL REFERENCES pc49.gold_type (code),
  txn_type               pc49.txn_type NOT NULL,
  direction              pc49.flow_direction NOT NULL,
  source_gold_type_code  text REFERENCES pc49.gold_type (code),
  note                   text,
  -- NULLS NOT DISTINCT so that (TRANSFER_IN, null) collides with itself on
  -- re-run and ON CONFLICT DO NOTHING keeps the seed idempotent. A plain
  -- primary key cannot be used here because source_gold_type_code is nullable
  -- and primary key columns are implicitly NOT NULL.
  UNIQUE NULLS NOT DISTINCT (gold_type_code, txn_type, direction, source_gold_type_code)
);

-- A null source_gold_type_code means the rule does not depend on where the gold
-- came from. Both (TRANSFER_IN, null) and (TRANSFER_IN, 'GRAIN') may exist: the
-- first allows a transfer from anywhere, the second names Grain specifically.
INSERT INTO pc49.gold_flow_rule (gold_type_code, txn_type, direction, source_gold_type_code, note) VALUES
  -- Rong Phung: in by purchase or transfer from Grain; out by customer sale or memo
  ('RP',    'PO',           'IN',  NULL,    'Mua'),
  ('RP',    'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('RP',    'TRANSFER_IN',  'IN',  'GRAIN', 'Transfer tu Grain'),
  ('RP',    'RA_RP',        'IN',  'GRAIN', 'Ra RP'),
  ('RP',    'SALE',         'OUT', NULL,    'Ban khach'),
  ('RP',    'DEPOSIT',      'OUT', NULL,    'Khach dat coc'),
  ('RP',    'PICKUP',       'OUT', NULL,    'Giao don dat coc'),
  ('RP',    'MEMO',         'OUT', NULL,    'Memo'),

  -- 9999: in by purchase, transfer from Grain or from Scrap Gold
  ('9999',  'PO',           'IN',  NULL,    'Mua'),
  ('9999',  'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('9999',  'TRANSFER_IN',  'IN',  'GRAIN', 'Transfer tu Grain'),
  ('9999',  'TRANSFER_IN',  'IN',  'SG',    'Transfer tu Scrap Gold'),
  ('9999',  'SALE',         'OUT', NULL,    'Ban noi bo'),
  ('9999',  'MEMO',         'OUT', NULL,    'Memo'),
  ('9999',  'TRANSFER_OUT', 'OUT', NULL,    'Transfer'),

  -- Credit Suisse
  ('CS',    'PO',           'IN',  NULL,    'Mua'),
  ('CS',    'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('CS',    'TRANSFER_IN',  'IN',  'GRAIN', 'Transfer tu Grain'),
  ('CS',    'SALE',         'OUT', NULL,    'Ban khach'),
  ('CS',    'DEPOSIT',      'OUT', NULL,    'Khach dat coc'),
  ('CS',    'PICKUP',       'OUT', NULL,    'Giao don dat coc'),
  ('CS',    'MEMO',         'OUT', NULL,    'Memo'),
  ('CS',    'TRANSFER_OUT', 'OUT', NULL,    'Transfer'),

  -- Maple Leaf
  ('ML',    'PO',           'IN',  NULL,    'Mua'),
  ('ML',    'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('ML',    'TRANSFER_IN',  'IN',  'GRAIN', 'Transfer tu Grain'),
  ('ML',    'SALE',         'OUT', NULL,    'Ban khach'),
  ('ML',    'DEPOSIT',      'OUT', NULL,    'Khach dat coc'),
  ('ML',    'PICKUP',       'OUT', NULL,    'Giao don dat coc'),
  ('ML',    'MEMO',         'OUT', NULL,    'Memo'),
  ('ML',    'TRANSFER_OUT', 'OUT', NULL,    'Transfer'),

  -- American Eagle: the only type the source also sells to vendors
  ('AE',    'PO',           'IN',  NULL,    'Mua'),
  ('AE',    'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('AE',    'TRANSFER_IN',  'IN',  'GRAIN', 'Transfer tu Grain'),
  ('AE',    'SALE',         'OUT', NULL,    'Ban noi bo, ban NCC, ban khach'),
  ('AE',    'DEPOSIT',      'OUT', NULL,    'Khach dat coc'),
  ('AE',    'PICKUP',       'OUT', NULL,    'Giao don dat coc'),
  ('AE',    'MEMO',         'OUT', NULL,    'Memo'),
  ('AE',    'TRANSFER_OUT', 'OUT', NULL,    'Transfer'),

  -- Other
  ('OTH',   'PO',           'IN',  NULL,    'Mua'),
  ('OTH',   'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('OTH',   'TRANSFER_IN',  'IN',  'GRAIN', 'Transfer tu Grain'),
  ('OTH',   'SALE',         'OUT', NULL,    'Ban NCC'),
  ('OTH',   'MEMO',         'OUT', NULL,    'Memo'),
  ('OTH',   'TRANSFER_OUT', 'OUT', NULL,    'Transfer'),

  -- Scrap Gold: bought only, and leaves only by internal sale or refining
  ('SG',    'PO',           'IN',  NULL,    'Mua'),
  ('SG',    'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('SG',    'SALE',         'OUT', NULL,    'Ban noi bo'),
  ('SG',    'TRANSFER_OUT', 'OUT', NULL,    'Phan kim'),

  -- Grain: the hub. Everything can turn into it and it can turn into anything.
  ('GRAIN', 'PO',           'IN',  NULL,    'Mua'),
  ('GRAIN', 'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('GRAIN', 'TRANSFER_IN',  'IN',  NULL,    'Transfer tu cac loai vang khac'),
  ('GRAIN', 'SALE',         'OUT', NULL,    'Ban noi bo'),
  ('GRAIN', 'TRANSFER_OUT', 'OUT', NULL,    'Transfer qua vang khac'),
  ('GRAIN', 'RA_RP',        'OUT', NULL,    'Ra RP'),

  -- Platinum: like Scrap Gold, plus transfers in
  ('PT',    'PO',           'IN',  NULL,    'Mua'),
  ('PT',    'PO_VENDOR',    'IN',  NULL,    'Mua NCC'),
  ('PT',    'TRANSFER_IN',  'IN',  'GRAIN', 'Transfer tu Grain'),
  ('PT',    'TRANSFER_IN',  'IN',  'SG',    'Transfer tu Scrap Gold'),
  ('PT',    'SALE',         'OUT', NULL,    'Ban noi bo'),
  ('PT',    'TRANSFER_OUT', 'OUT', NULL,    'Phan kim')
ON CONFLICT DO NOTHING;

-- ON_THE_WAY means ordered from a vendor and not yet received. It applies only
-- to the bullion types PC49 orders in. Scrap Gold and Platinum are bought over
-- the counter from walk-in customers, so there is nothing in transit for them,
-- and the Link sheet lists their only inbound path as a purchase.
INSERT INTO pc49.gold_flow_rule (gold_type_code, txn_type, direction, source_gold_type_code, note)
SELECT code, 'ON_THE_WAY', 'IN', NULL, 'Da dat NCC, chua nhan' FROM pc49.gold_type
WHERE code NOT IN ('SG', 'PT')
ON CONFLICT DO NOTHING;

INSERT INTO pc49.gold_flow_rule (gold_type_code, txn_type, direction, source_gold_type_code, note)
SELECT code, 'CANCEL', 'IN', NULL, 'Khach huy don dat coc' FROM pc49.gold_type
WHERE code IN ('RP', '9999', 'CS', 'ML', 'AE', 'OTH')
ON CONFLICT DO NOTHING;

ALTER TABLE pc49.gold_flow_rule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gold_flow_rule_read ON pc49.gold_flow_rule;
CREATE POLICY gold_flow_rule_read ON pc49.gold_flow_rule
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS gold_flow_rule_admin_write ON pc49.gold_flow_rule;
CREATE POLICY gold_flow_rule_admin_write ON pc49.gold_flow_rule
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

GRANT SELECT ON pc49.gold_flow_rule TO authenticated;
GRANT INSERT, UPDATE, DELETE ON pc49.gold_flow_rule TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0004_gold_flow_rules')
ON CONFLICT (version) DO NOTHING;
