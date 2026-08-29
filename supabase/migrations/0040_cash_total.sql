-- 0040_cash_total.sql
-- The money on hand, in one question instead of one per account.
--
-- The dashboard asked the database for every active cash account, then called
-- `cash_balance` once per account, in sequence, over the network. Four round
-- trips where one would do, on the first screen anybody opens in the morning.
-- Measured at thirty-four seconds inside the Supabase client on a laptop with a
-- slow link; it is the reason the sign-in check kept timing out.
--
-- Built on `cash_balance` rather than beside it. The reason the loop existed at
-- all was to make sure the dashboard and the Cash screen could never disagree
-- about what a balance is, and that was worth keeping — it just did not have to
-- cost a round trip each.
--
-- Clearing accounts are left out here as they were in the loop: money in a
-- Zelle or check clearing account has been counted once already in the account
-- it is on its way to.

CREATE OR REPLACE FUNCTION pc49.cash_total(p_as_of date)
RETURNS numeric
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT coalesce(sum(pc49.cash_balance(a.code, p_as_of)), 0)
    FROM pc49.cash_account a
   WHERE a.is_active AND a.account_type <> 'CLEARING'
$$;

INSERT INTO pc49.schema_migrations (version) VALUES ('0040_cash_total')
ON CONFLICT (version) DO NOTHING;
