-- 0025_cash_balance.sql
-- Balances, and the record of why the books disagree with the US cash book.
--
-- Balances are derived from movements plus an opening balance, never stored, so
-- they cannot drift from the rows that produce them.
--
-- Disagreement is normal and must be recordable. The Bao cao Cash sheet has a
-- column for the reason, and one January entry reads "khong tim thay" - not
-- found. A reconciliation that only accepts "matched" would push the accountant
-- back into a spreadsheet the first time a figure did not agree.

CREATE TABLE IF NOT EXISTS pc49.cash_opening_balance (
  cash_account_code  text NOT NULL REFERENCES pc49.cash_account (code),
  as_of              date NOT NULL,
  amount             numeric(18,2) NOT NULL,
  note               text,
  PRIMARY KEY (cash_account_code, as_of)
);

CREATE OR REPLACE FUNCTION pc49.cash_balance(p_account text, p_as_of date)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT coalesce(
    (SELECT amount FROM pc49.cash_opening_balance
      WHERE cash_account_code = p_account AND as_of <= p_as_of
      ORDER BY as_of DESC LIMIT 1), 0)
  + coalesce((
      SELECT sum(CASE WHEN t.direction = 'IN' THEN t.amount ELSE -t.amount END)
        FROM pc49.cash_txn t
       WHERE t.cash_account_code = p_account
         AND t.voided_at IS NULL
         AND t.txn_date <= p_as_of
         AND t.txn_date > coalesce(
             (SELECT as_of FROM pc49.cash_opening_balance
               WHERE cash_account_code = p_account AND as_of <= p_as_of
               ORDER BY as_of DESC LIMIT 1), '0001-01-01'::date)
    ), 0)
$$;

CREATE OR REPLACE VIEW pc49.v_cash_daily_balance AS
  SELECT t.cash_account_code,
         t.txn_date AS day,
         sum(CASE WHEN t.direction = 'IN'  THEN t.amount ELSE 0 END) AS total_in,
         sum(CASE WHEN t.direction = 'OUT' THEN t.amount ELSE 0 END) AS total_out,
         pc49.cash_balance(t.cash_account_code, t.txn_date)          AS closing
    FROM pc49.cash_txn t
   WHERE t.voided_at IS NULL
   GROUP BY t.cash_account_code, t.txn_date;

-- The B. REPORT THUCHI layout: opening for the year, movements in the period,
-- and the closing balance, per account.
CREATE OR REPLACE FUNCTION pc49.cashflow_by_account(p_period text)
RETURNS TABLE (
  cash_account_code  text,
  display_name       text,
  is_clearing        boolean,
  opening            numeric,
  received           numeric,
  paid               numeric,
  closing            numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH bounds AS (
    SELECT to_date(p_period || '-01', 'YYYY-MM-DD') AS period_start,
           (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date
             AS period_end
  )
  SELECT a.code,
         a.display_name,
         a.account_type = 'CLEARING',
         pc49.cash_balance(a.code, (SELECT period_start - 1 FROM bounds)),
         coalesce((SELECT sum(t.amount) FROM pc49.cash_txn t, bounds b
                    WHERE t.cash_account_code = a.code AND t.direction = 'IN'
                      AND t.voided_at IS NULL
                      AND t.txn_date BETWEEN b.period_start AND b.period_end), 0),
         coalesce((SELECT sum(t.amount) FROM pc49.cash_txn t, bounds b
                    WHERE t.cash_account_code = a.code AND t.direction = 'OUT'
                      AND t.voided_at IS NULL
                      AND t.txn_date BETWEEN b.period_start AND b.period_end), 0),
         pc49.cash_balance(a.code, (SELECT period_end FROM bounds))
    FROM pc49.cash_account a
   WHERE a.is_active
   ORDER BY a.sort_order
$$;

DO $$ BEGIN
  CREATE TYPE pc49.reconciliation_status AS ENUM
    ('PENDING', 'MATCHED', 'DIFF_EXPLAINED', 'NOT_FOUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.cash_reconciliation (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rec_date           date NOT NULL,
  cash_account_code  text NOT NULL REFERENCES pc49.cash_account (code),
  our_closing        numeric(18,2),
  us_closing         numeric(18,2),
  difference         numeric(18,2)
    GENERATED ALWAYS AS (our_closing - us_closing) STORED,
  status             pc49.reconciliation_status NOT NULL DEFAULT 'PENDING',
  reason             text,
  resolved_by        uuid,
  resolved_at        timestamptz,
  UNIQUE (rec_date, cash_account_code),
  -- A difference cannot be called explained without an explanation. This is the
  -- whole point of the column in the source sheet.
  CONSTRAINT cash_reconciliation_explained_needs_reason CHECK (
    status <> 'DIFF_EXPLAINED' OR btrim(coalesce(reason, '')) <> '')
);

-- Intercompany lending. PC49 has been lending HP money since November 2022 and
-- the source tracks it in the cash book, so it belongs here rather than in a
-- module of its own. It posts to 1388.
CREATE TABLE IF NOT EXISTS pc49.internal_loan (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_date         date NOT NULL,
  counterparty      text NOT NULL,
  direction         text NOT NULL CHECK (direction IN ('LEND', 'REPAY')),
  amount            numeric(18,2) NOT NULL CHECK (amount > 0),
  description       text,
  approved_by       text,
  journal_entry_id  uuid REFERENCES pc49.journal_entry (id),
  cash_txn_id       uuid REFERENCES pc49.cash_txn (id)
);

CREATE OR REPLACE VIEW pc49.v_internal_loan_balance AS
  SELECT counterparty,
         sum(CASE WHEN direction = 'LEND' THEN amount ELSE -amount END) AS outstanding
    FROM pc49.internal_loan
   GROUP BY counterparty;

ALTER TABLE pc49.cash_opening_balance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.cash_reconciliation   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.internal_loan         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_opening_balance_read ON pc49.cash_opening_balance;
CREATE POLICY cash_opening_balance_read ON pc49.cash_opening_balance
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS cash_opening_balance_write ON pc49.cash_opening_balance;
CREATE POLICY cash_opening_balance_write ON pc49.cash_opening_balance
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS cash_reconciliation_read ON pc49.cash_reconciliation;
CREATE POLICY cash_reconciliation_read ON pc49.cash_reconciliation
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS cash_reconciliation_write ON pc49.cash_reconciliation;
CREATE POLICY cash_reconciliation_write ON pc49.cash_reconciliation
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS internal_loan_read ON pc49.internal_loan;
CREATE POLICY internal_loan_read ON pc49.internal_loan
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS internal_loan_write ON pc49.internal_loan;
CREATE POLICY internal_loan_write ON pc49.internal_loan
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.cash_opening_balance, pc49.cash_reconciliation,
                                pc49.internal_loan TO authenticated;
GRANT SELECT ON pc49.v_cash_daily_balance, pc49.v_internal_loan_balance TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0025_cash_balance')
ON CONFLICT (version) DO NOTHING;
