-- 0028_asset_and_apar_report.sql
-- Receivables and payables, and the total assets report.
--
-- The [OC-124] sheet in the source shows AR = AP = 0 for all twelve months while
-- C. REPORT APAR shows movement of 512,469 over the same period. The two
-- disagree because the first is keyed by hand and the second is computed. Here
-- both come from the ledger, so there is only one answer and it is derivable.

-- Receivables and payables by counterparty, carrying weight as well as money,
-- because the source reports both and a gold debt is settled in grams.
CREATE OR REPLACE FUNCTION pc49.apar_report(p_period text)
RETURNS TABLE (
  partner_code   text,
  account_code   text,
  opening_value  numeric,
  debit_value    numeric,
  credit_value   numeric,
  closing_value  numeric,
  closing_gram   numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH movement AS (
    SELECT coalesce(e.partner_code, '(unknown)') AS partner_code,
           a.code                                AS account_code,
           e.period,
           CASE WHEN l.debit_account  = a.code THEN l.amount_usd ELSE 0 END AS dr,
           CASE WHEN l.credit_account = a.code THEN l.amount_usd ELSE 0 END AS cr,
           coalesce(l.qty_gram, 0)               AS gram
      FROM pc49.journal_line l
      JOIN pc49.journal_entry e ON e.id = l.entry_id
      JOIN pc49.account a ON a.code IN (l.debit_account, l.credit_account)
     WHERE a.code IN ('131', '331', '1388')
       AND e.posted_at IS NOT NULL AND e.voided_at IS NULL
  )
  SELECT m.partner_code,
         m.account_code,
         coalesce(sum(CASE WHEN m.period <  p_period THEN m.dr - m.cr END), 0),
         coalesce(sum(CASE WHEN m.period =  p_period THEN m.dr END), 0),
         coalesce(sum(CASE WHEN m.period =  p_period THEN m.cr END), 0),
         coalesce(sum(CASE WHEN m.period <= p_period THEN m.dr - m.cr END), 0),
         coalesce(sum(CASE WHEN m.period <= p_period THEN m.gram END), 0)
    FROM movement m
   GROUP BY m.partner_code, m.account_code
  HAVING coalesce(sum(CASE WHEN m.period <= p_period THEN m.dr - m.cr END), 0) <> 0
      OR coalesce(sum(CASE WHEN m.period =  p_period THEN m.dr + m.cr END), 0) <> 0
   ORDER BY m.account_code, m.partner_code
$$;

-- The [OC-124] layout:
--   E = inventory value  = closing grams x spot per oz / 31.1
--   F = AR, G = AP, H = cash and bank
--   I = (E + F + H) - G
CREATE OR REPLACE FUNCTION pc49.total_asset_report(p_as_of date)
RETURNS TABLE (
  inventory_gram   numeric,
  spot_per_gram    numeric,
  inventory_value  numeric,
  receivable       numeric,
  payable          numeric,
  cash             numeric,
  bank             numeric,
  cash_flow_total  numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH gram AS (
    SELECT coalesce(sum(qty_gram), 0) AS g
      FROM pc49.inventory_movement
     WHERE owner_code = 'PC49'
       AND bucket IN ('ON_HAND', 'DEPOSIT_HELD', 'AT_REFINERY', 'ON_MEMO')
       AND move_date <= p_as_of
  ), spot AS (
    SELECT spot_per_gram AS p FROM pc49.spot_price_daily
     WHERE metal = 'GOLD' AND price_date <= p_as_of
     ORDER BY price_date DESC LIMIT 1
  ), period AS (
    SELECT to_char(p_as_of, 'YYYY-MM') AS period
  ), ar AS (
    SELECT coalesce(sum(closing_value), 0) AS v
      FROM pc49.apar_report((SELECT period FROM period))
     WHERE account_code IN ('131', '1388')
  ), ap AS (
    SELECT coalesce(-sum(closing_value), 0) AS v
      FROM pc49.apar_report((SELECT period FROM period))
     WHERE account_code = '331'
  ), money AS (
    SELECT coalesce(sum(CASE WHEN a.account_type = 'CASH' THEN pc49.cash_balance(a.code, p_as_of) END), 0) AS cash,
           coalesce(sum(CASE WHEN a.account_type = 'BANK' THEN pc49.cash_balance(a.code, p_as_of) END), 0) AS bank
      FROM pc49.cash_account a WHERE a.is_active
  )
  SELECT gram.g,
         spot.p,
         gram.g * coalesce(spot.p, 0),
         ar.v,
         ap.v,
         money.cash,
         money.bank,
         (gram.g * coalesce(spot.p, 0) + ar.v + money.cash + money.bank) - ap.v
    FROM gram, ar, ap, money LEFT JOIN spot ON true
$$;

INSERT INTO pc49.schema_migrations (version) VALUES ('0028_asset_and_apar_report')
ON CONFLICT (version) DO NOTHING;
