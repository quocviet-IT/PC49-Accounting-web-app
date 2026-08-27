-- 0003_chart_of_accounts.sql
-- The chart of accounts from the Data Acc sheet of GENERAL REPORT.
--
-- Three codes are seeded that the Data Acc sheet does NOT list. Each is needed
-- for the system to be internally consistent, and each is flagged in section 11
-- of the business specification as a question for the accounting team:
--
--   632PT  cost of sales for platinum. Appears as a line in the D. P&L sheet
--          (Gia von NVL vang PT) but is missing from Data Acc.
--   156AE  inventory for American Eagle. The gold type has 632AE and 157AE but
--          no inventory account anywhere in the source.
--   711    other income. Referenced by the D. P&L sheet, absent from Data Acc.
--
-- The 45th row of Data Acc holds the bare string US, which is not an account
-- code and is deliberately not seeded.

DO $$ BEGIN
  CREATE TYPE pc49.account_type AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.account (
  code             text PRIMARY KEY,
  name_vi          text NOT NULL,
  name_en          text NOT NULL,
  account_type     pc49.account_type NOT NULL,
  parent_code      text REFERENCES pc49.account (code),
  gold_type_code   text,
  is_clearing      boolean NOT NULL DEFAULT false,
  allows_negative  boolean NOT NULL DEFAULT false,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0
);

INSERT INTO pc49.account
  (code, name_vi, name_en, account_type, gold_type_code, is_clearing, allows_negative, sort_order) VALUES
  -- Cost of goods sold, one per gold type
  ('632RP',     'Giá vốn vàng Rồng Phụng',      'COGS - Rong Phung',            'EXPENSE',   'RP',    false, false, 100),
  ('632-9999',  'Giá vốn vàng 9999',            'COGS - 9999',                  'EXPENSE',   '9999',  false, false, 101),
  ('632ML',     'Giá vốn vàng Maple Leaf',      'COGS - Maple Leaf',            'EXPENSE',   'ML',    false, false, 102),
  ('632CS',     'Giá vốn vàng Credit Suisse',   'COGS - Credit Suisse',         'EXPENSE',   'CS',    false, false, 103),
  ('632AE',     'Giá vốn vàng American Eagle',  'COGS - American Eagle',        'EXPENSE',   'AE',    false, false, 104),
  ('632Oth',    'Giá vốn vàng khác',            'COGS - Other',                 'EXPENSE',   'OTH',   false, false, 105),
  ('632SG',     'Giá vốn vàng vụn',             'COGS - Scrap Gold',            'EXPENSE',   'SG',    false, false, 106),
  ('632Grain',  'Giá vốn vàng Grain',           'COGS - Grain',                 'EXPENSE',   'GRAIN', false, false, 107),
  ('632PT',     'Giá vốn bạch kim',             'COGS - Platinum',              'EXPENSE',   'PT',    false, false, 108),
  -- Raw material inventory
  ('155-9999',  'NVL vàng 9999',                'Raw material - 9999',          'ASSET',     '9999',  false, false, 200),
  ('155SG',     'NVL vàng vụn',                 'Raw material - Scrap Gold',    'ASSET',     'SG',    false, false, 201),
  ('155Grain',  'NVL vàng Grain',               'Raw material - Grain',         'ASSET',     'GRAIN', false, false, 202),
  ('155PT',     'NVL bạch kim',                 'Raw material - Platinum',      'ASSET',     'PT',    false, false, 203),
  -- Merchandise inventory
  ('156RP',     'Hàng hoá vàng Rồng Phụng',     'Inventory - Rong Phung',       'ASSET',     'RP',    false, false, 210),
  ('156CS',     'Hàng hoá vàng Credit Suisse',  'Inventory - Credit Suisse',    'ASSET',     'CS',    false, false, 211),
  ('156ML',     'Hàng hoá vàng Maple Leaf',     'Inventory - Maple Leaf',       'ASSET',     'ML',    false, false, 212),
  ('156AE',     'Hàng hoá vàng American Eagle', 'Inventory - American Eagle',   'ASSET',     'AE',    false, false, 213),
  ('156Other',  'Hàng hoá vàng khác',           'Inventory - Other',            'ASSET',     'OTH',   false, false, 214),
  -- Goods out on consignment or at the refinery
  ('157RP',     'Hàng gửi đi vàng Rồng Phụng',  'In transit - Rong Phung',      'ASSET',     'RP',    false, false, 220),
  ('157-9999',  'Hàng gửi đi vàng 9999',        'In transit - 9999',            'ASSET',     '9999',  false, false, 221),
  ('157CS',     'Hàng gửi đi vàng Credit Suisse','In transit - Credit Suisse',  'ASSET',     'CS',    false, false, 222),
  ('157ML',     'Hàng gửi đi vàng Maple Leaf',  'In transit - Maple Leaf',      'ASSET',     'ML',    false, false, 223),
  ('157AE',     'Hàng gửi đi vàng American Eagle','In transit - American Eagle','ASSET',     'AE',    false, false, 224),
  ('157Other',  'Hàng gửi đi vàng khác',        'In transit - Other',           'ASSET',     'OTH',   false, false, 225),
  ('157SG',     'Hàng gửi đi vàng vụn',         'In transit - Scrap Gold',      'ASSET',     'SG',    false, false, 226),
  ('157Grain',  'Hàng gửi đi vàng Grain',       'In transit - Grain',           'ASSET',     'GRAIN', false, false, 227),
  ('157PT',     'Hàng gửi đi bạch kim',         'In transit - Platinum',        'ASSET',     'PT',    false, false, 228),
  -- Cash and bank
  ('1111',      'Tiền mặt',                     'Cash on hand',                 'ASSET',     NULL,    false, false, 300),
  ('1121-3388', '121 - PC49 BoA CK 3388',       '121 - PC49 BoA CK 3388',       'ASSET',     NULL,    false, false, 310),
  ('1121-9530', '130 - PC49 CHA CK 9530',       '130 - PC49 CHA CK 9530',       'ASSET',     NULL,    false, false, 311),
  ('1121-6086', '145 - TL Wis CK 6086',         '145 - TL Wis CK 6086',         'ASSET',     NULL,    false, false, 312),
  -- Funds in flight: recorded on a document but not yet settled into a bank
  -- account, so these are allowed to go negative.
  ('1121ZL',    'Tiền Zelle',                   'Zelle in flight',              'ASSET',     NULL,    true,  true,  320),
  ('1121BW',    'Tiền Bankwire',                'Bankwire in flight',           'ASSET',     NULL,    true,  true,  321),
  ('1121CK',    'Tiền Check',                   'Check in flight',              'ASSET',     NULL,    true,  true,  322),
  -- Receivables and payables
  ('131',       'Phải thu khách hàng',          'Accounts receivable',          'ASSET',     NULL,    false, false, 400),
  ('1388',      'Phải thu khác',                'Other receivable',             'ASSET',     NULL,    false, false, 401),
  ('331',       'Phải trả người bán',           'Accounts payable',             'LIABILITY', NULL,    false, false, 410),
  ('333',       'Thuế phải nộp',                'Taxes payable',                'LIABILITY', NULL,    false, false, 411),
  ('334',       'Phải trả người lao động',      'Payroll payable',              'LIABILITY', NULL,    false, false, 412),
  -- Revenue
  ('511',       'Doanh thu bán hàng',           'Sales revenue',                'REVENUE',   NULL,    false, false, 500),
  ('515',       'Doanh thu hoạt động tài chính','Financial income',             'REVENUE',   NULL,    false, false, 501),
  ('711',       'Thu nhập khác',                'Other income',                 'REVENUE',   NULL,    false, false, 502),
  -- Expense
  ('635',       'Chi phí tài chính',            'Financial expense',            'EXPENSE',   NULL,    false, false, 600),
  ('641',       'Chi phí bán hàng',             'Selling expense',              'EXPENSE',   NULL,    false, false, 601),
  ('642',       'Chi phí quản lý',              'Administrative expense',       'EXPENSE',   NULL,    false, false, 602)
ON CONFLICT (code) DO UPDATE SET
  name_vi = excluded.name_vi, name_en = excluded.name_en,
  account_type = excluded.account_type, gold_type_code = excluded.gold_type_code,
  is_clearing = excluded.is_clearing, allows_negative = excluded.allows_negative,
  sort_order = excluded.sort_order;

-- Now that the accounts exist, tie the two tables together in both directions.
ALTER TABLE pc49.account
  DROP CONSTRAINT IF EXISTS account_gold_type_code_fkey;
ALTER TABLE pc49.account
  ADD CONSTRAINT account_gold_type_code_fkey
  FOREIGN KEY (gold_type_code) REFERENCES pc49.gold_type (code);

ALTER TABLE pc49.gold_type
  DROP CONSTRAINT IF EXISTS gold_type_inventory_account_fkey,
  DROP CONSTRAINT IF EXISTS gold_type_cogs_account_fkey,
  DROP CONSTRAINT IF EXISTS gold_type_in_transit_account_fkey;
ALTER TABLE pc49.gold_type
  ADD CONSTRAINT gold_type_inventory_account_fkey
    FOREIGN KEY (inventory_account) REFERENCES pc49.account (code),
  ADD CONSTRAINT gold_type_cogs_account_fkey
    FOREIGN KEY (cogs_account) REFERENCES pc49.account (code),
  ADD CONSTRAINT gold_type_in_transit_account_fkey
    FOREIGN KEY (in_transit_account) REFERENCES pc49.account (code);

ALTER TABLE pc49.account ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_read ON pc49.account;
CREATE POLICY account_read ON pc49.account
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS account_admin_write ON pc49.account;
CREATE POLICY account_admin_write ON pc49.account
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

GRANT SELECT ON pc49.account TO authenticated;
GRANT INSERT, UPDATE, DELETE ON pc49.account TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0003_chart_of_accounts')
ON CONFLICT (version) DO NOTHING;
