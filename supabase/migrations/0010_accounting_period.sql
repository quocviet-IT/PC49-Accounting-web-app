-- 0010_accounting_period.sql
-- Monthly period close, and the only sanctioned way to correct a closed period.
--
-- A period is open unless a row says otherwise, so nothing has to be seeded for
-- the system to work on day one. Once closed, the period refuses new postings
-- and refuses voids; a mistake is corrected by a reversing entry dated in an
-- open period, which is what the accounting team does today.

DO $$ BEGIN
  CREATE TYPE pc49.period_state AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.accounting_period (
  period     text PRIMARY KEY CHECK (period ~ '^\d{4}-\d{2}$'),
  status     pc49.period_state NOT NULL DEFAULT 'OPEN',
  closed_at  timestamptz,
  closed_by  uuid,
  note       text,
  CONSTRAINT accounting_period_closed_needs_timestamp
    CHECK (status = 'OPEN' OR closed_at IS NOT NULL)
);

-- Absence of a row means open. Callers never have to care whether the row exists.
CREATE OR REPLACE FUNCTION pc49.period_status(p_period text)
RETURNS pc49.period_state
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT coalesce(
    (SELECT status FROM pc49.accounting_period WHERE period = p_period),
    'OPEN'::pc49.period_state)
$$;

CREATE OR REPLACE FUNCTION pc49.journal_entry_guard_closed_period()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  -- Posting into a closed period.
  IF NEW.posted_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.posted_at IS NULL)
     AND pc49.period_status(NEW.period) = 'CLOSED' THEN
    RAISE EXCEPTION 'period % is closed; post into an open period or use a reversing entry',
      NEW.period;
  END IF;

  -- Voiding an entry that sits in a closed period.
  IF TG_OP = 'UPDATE'
     AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL
     AND pc49.period_status(NEW.period) = 'CLOSED' THEN
    RAISE EXCEPTION 'period % is closed; correct entry % with a reversing entry instead of voiding it',
      NEW.period, NEW.id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS journal_entry_guard_closed_period ON pc49.journal_entry;
CREATE TRIGGER journal_entry_guard_closed_period
  BEFORE INSERT OR UPDATE ON pc49.journal_entry
  FOR EACH ROW EXECUTE FUNCTION pc49.journal_entry_guard_closed_period();

-- Mirrors a posted entry into an open period: debits and credits swapped, and
-- the weight negated so the second unit reverses too.
CREATE OR REPLACE FUNCTION pc49.reverse_entry(p_entry_id uuid, p_on_date date)
RETURNS uuid LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_original pc49.journal_entry;
  v_period   text := to_char(p_on_date, 'YYYY-MM');
  v_new_id   uuid;
BEGIN
  SELECT * INTO v_original FROM pc49.journal_entry WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry % does not exist', p_entry_id;
  END IF;
  IF v_original.posted_at IS NULL THEN
    RAISE EXCEPTION 'entry % is not posted; there is nothing to reverse', p_entry_id;
  END IF;
  IF pc49.period_status(v_period) = 'CLOSED' THEN
    RAISE EXCEPTION 'period % is closed; date the reversal in an open period', v_period;
  END IF;

  INSERT INTO pc49.journal_entry
    (entry_date, period, doc_no_hp, receipt_no, payment_no, partner_code,
     txn_kind, memo, reversal_of_id)
  VALUES
    (p_on_date, v_period, v_original.doc_no_hp, v_original.receipt_no, v_original.payment_no,
     v_original.partner_code, v_original.txn_kind,
     'Reversal of: ' || coalesce(v_original.memo, p_entry_id::text), p_entry_id)
  RETURNING id INTO v_new_id;

  INSERT INTO pc49.journal_line
    (entry_id, seq, debit_account, credit_account, amount_usd,
     gold_type_code, gold_pct, uom, qty_native, unit_price, cogs_unit)
  SELECT v_new_id, seq,
         credit_account, debit_account, amount_usd,
         gold_type_code, gold_pct, uom, -qty_native, unit_price, cogs_unit
    FROM pc49.journal_line WHERE entry_id = p_entry_id;

  UPDATE pc49.journal_entry SET posted_at = now() WHERE id = v_new_id;
  RETURN v_new_id;
END $$;

ALTER TABLE pc49.accounting_period ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_period_read ON pc49.accounting_period;
CREATE POLICY accounting_period_read ON pc49.accounting_period
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

-- Closing a period is the supervisor's call, not the accountant's.
DROP POLICY IF EXISTS accounting_period_write ON pc49.accounting_period;
CREATE POLICY accounting_period_write ON pc49.accounting_period
  FOR ALL USING (pc49.effective_role() IN ('GS_US', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('GS_US', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.accounting_period TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0010_accounting_period')
ON CONFLICT (version) DO NOTHING;
