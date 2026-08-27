-- 0009_journal.sql
-- The double-entry journal, carrying money and gold weight on the same line.
--
-- Each line keeps a debit account and a credit account on one row, matching the
-- No/Co column layout the accountant already uses in Nhat Ky Chung, rather than
-- the one-account-per-line form a textbook would use. A line naming both
-- accounts balances itself; a line naming one needs a companion line.
--
-- Balance is enforced by a trigger at posting time, so no application code path
-- can write an unbalanced entry.

DO $$ BEGIN
  CREATE TYPE pc49.txn_kind AS ENUM ('SO', 'PO', 'CASH_REPORT', 'BANK_STATEMENT', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.journal_entry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date      date NOT NULL,
  period          text NOT NULL,
  -- The source document reference. NOT an entry identifier: on 2026-01-01 the
  -- number 9001 spans three unrelated transactions while one transaction spans
  -- 9001 and 1002, so it cannot be used to group double entries.
  doc_no_hp       text,
  receipt_no      text,
  payment_no      text,
  partner_code    text,
  txn_kind        pc49.txn_kind NOT NULL DEFAULT 'MANUAL',
  memo            text,
  posted_at       timestamptz,
  posted_by       uuid,
  voided_at       timestamptz,
  void_reason     text,
  reversal_of_id  uuid REFERENCES pc49.journal_entry (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT journal_entry_period_matches_date
    CHECK (period = to_char(entry_date, 'YYYY-MM')),
  CONSTRAINT journal_entry_void_needs_reason
    CHECK (voided_at IS NULL OR btrim(coalesce(void_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS journal_entry_date_idx   ON pc49.journal_entry (entry_date);
CREATE INDEX IF NOT EXISTS journal_entry_period_idx ON pc49.journal_entry (period);

CREATE TABLE IF NOT EXISTS pc49.journal_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id        uuid NOT NULL REFERENCES pc49.journal_entry (id) ON DELETE CASCADE,
  seq             int  NOT NULL,
  debit_account   text REFERENCES pc49.account (code),
  credit_account  text REFERENCES pc49.account (code),
  amount_usd      numeric(18,2) NOT NULL,
  -- The second unit. Null on a line that moves only money.
  gold_type_code  text REFERENCES pc49.gold_type (code),
  gold_pct        numeric(6,4),
  uom             pc49.uom,
  qty_native      numeric(18,4),
  qty_gram        numeric(18,4),
  unit_price      numeric(18,4),
  cogs_unit       numeric(18,4),
  -- The BC T/C column: whether this line has reached the cash flow report.
  cash_flag       boolean NOT NULL DEFAULT false,
  UNIQUE (entry_id, seq),
  CONSTRAINT journal_line_needs_an_account
    CHECK (debit_account IS NOT NULL OR credit_account IS NOT NULL),
  CONSTRAINT journal_line_gold_needs_a_unit
    CHECK (gold_type_code IS NULL OR uom IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS journal_line_entry_idx ON pc49.journal_line (entry_id);
CREATE INDEX IF NOT EXISTS journal_line_gold_idx  ON pc49.journal_line (gold_type_code);

-- qty_gram is derived from qty_native and the unit. It cannot be a generated
-- column because the conversion factor lives in another table.
CREATE OR REPLACE FUNCTION pc49.journal_line_fill_grams()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF NEW.qty_native IS NULL OR NEW.uom IS NULL THEN
    NEW.qty_gram := NULL;
  ELSE
    SELECT NEW.qty_native * f.gram_per_unit INTO NEW.qty_gram
      FROM pc49.uom_factor f WHERE f.uom = NEW.uom;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS journal_line_fill_grams ON pc49.journal_line;
CREATE TRIGGER journal_line_fill_grams
  BEFORE INSERT OR UPDATE ON pc49.journal_line
  FOR EACH ROW EXECUTE FUNCTION pc49.journal_line_fill_grams();

-- Debits minus credits across an entry. Zero means it balances.
CREATE OR REPLACE FUNCTION pc49.entry_balance(p_entry_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT coalesce(sum(
    CASE WHEN debit_account  IS NOT NULL THEN amount_usd ELSE 0 END
  ) - sum(
    CASE WHEN credit_account IS NOT NULL THEN amount_usd ELSE 0 END
  ), 0)
  FROM pc49.journal_line WHERE entry_id = p_entry_id
$$;

-- An entry may be edited freely while it is a draft. The moment it is posted,
-- it must balance and must have at least one line.
CREATE OR REPLACE FUNCTION pc49.journal_entry_check_balance()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_lines int;
  v_balance numeric;
BEGIN
  IF NEW.posted_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.posted_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_lines FROM pc49.journal_line WHERE entry_id = NEW.id;
  IF v_lines = 0 THEN
    RAISE EXCEPTION 'entry % has no lines and does not balance', NEW.id;
  END IF;

  v_balance := pc49.entry_balance(NEW.id);
  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'entry % does not balance: debits minus credits is %', NEW.id, v_balance;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS journal_entry_check_balance ON pc49.journal_entry;
CREATE TRIGGER journal_entry_check_balance
  BEFORE INSERT OR UPDATE ON pc49.journal_entry
  FOR EACH ROW EXECUTE FUNCTION pc49.journal_entry_check_balance();

-- A posted entry is immutable except for voiding. Corrections go through a
-- reversing entry, never through an edit.
CREATE OR REPLACE FUNCTION pc49.journal_line_reject_change_when_posted()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE v_posted timestamptz;
BEGIN
  SELECT posted_at INTO v_posted FROM pc49.journal_entry
   WHERE id = coalesce(NEW.entry_id, OLD.entry_id);
  IF v_posted IS NOT NULL THEN
    RAISE EXCEPTION 'entry % is posted; correct it with a reversing entry',
      coalesce(NEW.entry_id, OLD.entry_id);
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS journal_line_reject_change_when_posted ON pc49.journal_line;
CREATE TRIGGER journal_line_reject_change_when_posted
  BEFORE INSERT OR UPDATE OR DELETE ON pc49.journal_line
  FOR EACH ROW EXECUTE FUNCTION pc49.journal_line_reject_change_when_posted();

ALTER TABLE pc49.journal_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.journal_line  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_entry_read ON pc49.journal_entry;
CREATE POLICY journal_entry_read ON pc49.journal_entry
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS journal_entry_write ON pc49.journal_entry;
CREATE POLICY journal_entry_write ON pc49.journal_entry
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS journal_line_read ON pc49.journal_line;
CREATE POLICY journal_line_read ON pc49.journal_line
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS journal_line_write ON pc49.journal_line;
CREATE POLICY journal_line_write ON pc49.journal_line
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.journal_entry, pc49.journal_line TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0009_journal')
ON CONFLICT (version) DO NOTHING;
