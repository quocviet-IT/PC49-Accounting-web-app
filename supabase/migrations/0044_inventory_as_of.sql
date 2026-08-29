-- 0044_inventory_as_of.sql
-- What the stock was on a given day, not only what it is now.
--
-- Reported by the accountant: "Chua co cot chon ngay muon xem bao cao" — the
-- stock table had no date on it. It answered one question, "what do we hold
-- right now", and every other question people actually ask of a stock report is
-- about a date: what was on hand at the end of last month, what we held the day
-- before a count, what the closing figure was when the period was signed off.
--
-- `v_inventory_book`, `v_inventory_physical` and `v_inventory_total_asset` sum
-- every movement with no date filter, and a view cannot take an argument. This
-- is the same three figures with a cut-off, in one round trip instead of three.
--
-- The bucket lists are the views' own, repeated rather than referenced because
-- there is nothing to reference: they live inside three view definitions. If a
-- bucket is ever added, both places need it, and the check in
-- `verify-inventory.mjs` compares this against the views on today's date, which
-- is what would notice.

CREATE OR REPLACE FUNCTION pc49.inventory_as_of(p_as_of date, p_owner text DEFAULT 'PC49')
RETURNS TABLE (
  gold_type_code text,
  book_gram      numeric,
  physical_gram  numeric,
  total_gram     numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT m.gold_type_code,
         -- What the books say we own and have not sold.
         coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'ON_HAND'), 0),
         -- What is actually in the shop: deposited gold is sold on paper but
         -- has not left.
         coalesce(sum(m.qty_gram) FILTER (
           WHERE m.bucket IN ('ON_HAND', 'DEPOSIT_HELD')), 0),
         -- Everything owned, wherever it is sitting.
         coalesce(sum(m.qty_gram) FILTER (
           WHERE m.bucket IN ('ON_HAND', 'DEPOSIT_HELD', 'AT_REFINERY', 'ON_MEMO')), 0)
    FROM pc49.inventory_movement m
   WHERE m.owner_code = p_owner
     AND m.move_date <= p_as_of
   GROUP BY m.gold_type_code
$$;

REVOKE ALL ON FUNCTION pc49.inventory_as_of(date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pc49.inventory_as_of(date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0044_inventory_as_of')
ON CONFLICT (version) DO NOTHING;
