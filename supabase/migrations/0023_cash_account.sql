-- 0023_cash_account.sql
-- PC49's cash and bank accounts, and the table that undoes Rocket's account
-- number scrambling.
--
-- The hidden MATCHING sheet in Rocket Data Processing is a log of that damage:
-- "Account information missing, must be re-filtered and typed by hand" against
-- account 4500, "transactions in 2024 match but the closing balance is wrong"
-- against 2859, and "Rocket not connected" against eight more. Today the
-- accountant retypes these every day. Here the mapping is a table, and a line
-- that matches nothing goes to a review queue instead of being quietly dropped.

DO $$ BEGIN
  CREATE TYPE pc49.cash_account_type AS ENUM ('CASH', 'BANK', 'CLEARING', 'CC_LOAN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.cash_account (
  code           text PRIMARY KEY REFERENCES pc49.account (code),
  display_name   text NOT NULL,
  account_type   pc49.cash_account_type NOT NULL,
  bank_name      text,
  account_no     text,
  -- Where the source records things like "Rocket not connected" or
  -- "closed since March 2023".
  status_note    text,
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     int NOT NULL DEFAULT 0
);

INSERT INTO pc49.cash_account
  (code, display_name, account_type, bank_name, account_no, sort_order) VALUES
  ('1111',      'PC49 CASH',              'CASH',     NULL,              NULL,   10),
  ('1121-3388', '121 - PC49 BoA CK 3388', 'BANK',     'Bank of America', '3388', 20),
  ('1121-9530', '130 - PC49 CHA CK 9530', 'BANK',     'Chase',           '9530', 21),
  ('1121-6086', '145 - TL Wis CK 6086',   'BANK',     'Wise (US)',       '6086', 22),
  -- Money recorded on a receipt but not yet settled into a bank account. These
  -- are cash accounts for balance purposes even though no bank holds them, and
  -- they are allowed to close negative: the source shows Check at -53,850 at the
  -- end of January 2026.
  ('1121ZL',    'Tiền Zelle',             'CLEARING', NULL,              NULL,   30),
  ('1121BW',    'Tiền Bankwire',          'CLEARING', NULL,              NULL,   31),
  ('1121CK',    'Tiền Check',             'CLEARING', NULL,              NULL,   32)
ON CONFLICT (code) DO UPDATE SET
  display_name = excluded.display_name, account_type = excluded.account_type,
  bank_name = excluded.bank_name, account_no = excluded.account_no,
  sort_order = excluded.sort_order;

CREATE TABLE IF NOT EXISTS pc49.rocket_account_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_account_no     text,
  raw_account_name   text,
  raw_institution    text,
  cash_account_code  text NOT NULL REFERENCES pc49.cash_account (code),
  note               text,
  UNIQUE NULLS NOT DISTINCT (raw_account_no, raw_account_name)
);

INSERT INTO pc49.rocket_account_map
  (raw_account_no, raw_account_name, raw_institution, cash_account_code, note) VALUES
  ('3388', 'Business Adv Relationship', 'Bank of America', '1121-3388', NULL),
  ('9530', 'PERFBUS CHK',               'Chase',           '1121-9530', NULL),
  ('6086', 'USD account',               'Wise (US)',       '1121-6086', NULL)
ON CONFLICT DO NOTHING;

ALTER TABLE pc49.cash_account       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.rocket_account_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_account_read ON pc49.cash_account;
CREATE POLICY cash_account_read ON pc49.cash_account
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS cash_account_admin_write ON pc49.cash_account;
CREATE POLICY cash_account_admin_write ON pc49.cash_account
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

DROP POLICY IF EXISTS rocket_account_map_read ON pc49.rocket_account_map;
CREATE POLICY rocket_account_map_read ON pc49.rocket_account_map
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

-- The accountant is the one who discovers a new scrambled number, so this is
-- not admin-only.
DROP POLICY IF EXISTS rocket_account_map_write ON pc49.rocket_account_map;
CREATE POLICY rocket_account_map_write ON pc49.rocket_account_map
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.cash_account, pc49.rocket_account_map TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0023_cash_account')
ON CONFLICT (version) DO NOTHING;
