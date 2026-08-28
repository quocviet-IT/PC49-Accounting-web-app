-- 0035_trial_balance.sql
-- The two reports every set of books is read through, and neither existed.
--
-- A trial balance is the first thing an accountant or an auditor asks for: every
-- account, what it opened at, what moved, what it closed at, and the proof that
-- the two columns agree. PC49 could produce a profit and loss and a list of
-- assets but had no way to see the accounts those were built from.
--
-- A general ledger is the next question after the trial balance — "what made
-- that figure" — and it has to answer with the entries themselves rather than
-- another total.

/**
 * Every account for one month.
 *
 * Signed by the account's own nature: an asset or a cost reads debit-positive,
 * a liability, equity or revenue reads credit-positive, so every closing figure
 * on the report is the amount that account actually holds rather than a number
 * the reader has to negate in their head.
 *
 * The debit and credit columns stay unsigned, because their whole purpose is to
 * be added up and compared.
 */
CREATE OR REPLACE FUNCTION pc49.trial_balance(p_period text)
RETURNS TABLE (
  account_code  text,
  name_vi       text,
  name_en       text,
  account_type  pc49.account_type,
  opening       numeric,
  debit         numeric,
  credit        numeric,
  closing       numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH movement AS (
    SELECT a.code,
           e.period,
           CASE WHEN l.debit_account  = a.code THEN l.amount_usd ELSE 0 END AS dr,
           CASE WHEN l.credit_account = a.code THEN l.amount_usd ELSE 0 END AS cr
      FROM pc49.journal_line l
      JOIN pc49.journal_entry e ON e.id = l.entry_id
      JOIN pc49.account a ON a.code IN (l.debit_account, l.credit_account)
     WHERE e.posted_at IS NOT NULL AND e.voided_at IS NULL
  ), summed AS (
    SELECT code,
           coalesce(sum(dr) FILTER (WHERE period <  p_period), 0) AS dr_before,
           coalesce(sum(cr) FILTER (WHERE period <  p_period), 0) AS cr_before,
           coalesce(sum(dr) FILTER (WHERE period =  p_period), 0) AS dr_in,
           coalesce(sum(cr) FILTER (WHERE period =  p_period), 0) AS cr_in
      FROM movement
     GROUP BY code
  )
  SELECT a.code, a.name_vi, a.name_en, a.account_type,
         -- The sign each kind of account is read in.
         CASE WHEN a.account_type IN ('ASSET', 'EXPENSE')
              THEN coalesce(s.dr_before, 0) - coalesce(s.cr_before, 0)
              ELSE coalesce(s.cr_before, 0) - coalesce(s.dr_before, 0) END,
         coalesce(s.dr_in, 0),
         coalesce(s.cr_in, 0),
         CASE WHEN a.account_type IN ('ASSET', 'EXPENSE')
              THEN coalesce(s.dr_before, 0) - coalesce(s.cr_before, 0)
                 + coalesce(s.dr_in, 0)     - coalesce(s.cr_in, 0)
              ELSE coalesce(s.cr_before, 0) - coalesce(s.dr_before, 0)
                 + coalesce(s.cr_in, 0)     - coalesce(s.dr_in, 0) END
    FROM pc49.account a
    LEFT JOIN summed s ON s.code = a.code
   -- An account that has never been touched and holds nothing is noise on a
   -- monthly report; one that moved, or that carries a balance, is not.
   WHERE coalesce(s.dr_before, 0) <> 0 OR coalesce(s.cr_before, 0) <> 0
      OR coalesce(s.dr_in, 0)     <> 0 OR coalesce(s.cr_in, 0)     <> 0
   ORDER BY a.sort_order, a.code
$$;

/**
 * Every posted line that touched one account, oldest first, with the balance
 * after each.
 *
 * The running balance is what makes this a ledger rather than a filtered list:
 * the question it answers is "when did this account get to that figure", and a
 * column of movements without the running total cannot answer it.
 */
CREATE OR REPLACE FUNCTION pc49.general_ledger(
  p_account text,
  p_from    date,
  p_to      date)
RETURNS TABLE (
  entry_date     date,
  entry_id       uuid,
  memo           text,
  partner_code   text,
  contra_account text,
  debit          numeric,
  credit         numeric,
  balance        numeric,
  gold_type_code text,
  qty_gram       numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH acct AS (
    SELECT account_type FROM pc49.account WHERE code = p_account
  ), opening AS (
    -- Everything before the window, as one number: the ledger has to start from
    -- where the account already stood, not from zero.
    SELECT coalesce(sum(
      CASE WHEN (SELECT account_type FROM acct) IN ('ASSET', 'EXPENSE')
           THEN CASE WHEN l.debit_account = p_account THEN l.amount_usd ELSE -l.amount_usd END
           ELSE CASE WHEN l.credit_account = p_account THEN l.amount_usd ELSE -l.amount_usd END
      END), 0) AS amount
      FROM pc49.journal_line l
      JOIN pc49.journal_entry e ON e.id = l.entry_id
     WHERE p_account IN (l.debit_account, l.credit_account)
       AND e.posted_at IS NOT NULL AND e.voided_at IS NULL
       AND e.entry_date < p_from
  ), lines AS (
    SELECT e.entry_date,
           e.id AS entry_id,
           e.memo,
           e.partner_code,
           -- The other side of the line, which is what makes a ledger readable.
           CASE WHEN l.debit_account = p_account THEN l.credit_account
                ELSE l.debit_account END AS contra_account,
           CASE WHEN l.debit_account  = p_account THEN l.amount_usd ELSE 0 END AS debit,
           CASE WHEN l.credit_account = p_account THEN l.amount_usd ELSE 0 END AS credit,
           l.gold_type_code,
           coalesce(l.qty_gram, 0) AS qty_gram,
           l.seq
      FROM pc49.journal_line l
      JOIN pc49.journal_entry e ON e.id = l.entry_id
     WHERE p_account IN (l.debit_account, l.credit_account)
       AND e.posted_at IS NOT NULL AND e.voided_at IS NULL
       AND e.entry_date BETWEEN p_from AND p_to
  )
  SELECT lines.entry_date, lines.entry_id, lines.memo, lines.partner_code,
         lines.contra_account, lines.debit, lines.credit,
         (SELECT amount FROM opening) + sum(
           CASE WHEN (SELECT account_type FROM acct) IN ('ASSET', 'EXPENSE')
                THEN lines.debit - lines.credit
                ELSE lines.credit - lines.debit END)
         OVER (ORDER BY lines.entry_date, lines.entry_id, lines.seq
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
         lines.gold_type_code, lines.qty_gram
    FROM lines
   ORDER BY lines.entry_date, lines.entry_id, lines.seq
$$;

INSERT INTO pc49.schema_migrations (version) VALUES ('0035_trial_balance')
ON CONFLICT (version) DO NOTHING;
