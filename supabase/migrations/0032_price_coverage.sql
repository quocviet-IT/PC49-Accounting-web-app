-- 0032_price_coverage.sql
-- Knowing which prices are missing, and which of them already cost something.
--
-- `cogs_price` returns null when a day has no price for a gold type, and
-- `post_gold_txn` then writes the sale with revenue and no cost line. The entry
-- still balances - a revenue line balances itself and so does a cost line - so
-- nothing complains, and the month's gross profit is overstated by the whole
-- cost of that sale.
--
-- Refusing to post would be worse: the accountant enters the day's trading in
-- one sitting, often before anybody has set the day's price, and a screen that
-- rejects every sale until then is a screen they stop using. So the posting rule
-- stays as it is, and the gap is made visible instead.

-- What a day's price screen needs: every active gold type, whatever price has
-- been set, and how much of it actually changed hands that day. The last column
-- is what turns a long list into a short one - it says which rows matter today.
CREATE OR REPLACE FUNCTION pc49.price_grid(p_date date)
RETURNS TABLE (
  gold_type_code      text,
  name_vi             text,
  name_en             text,
  native_uom          pc49.uom,
  market_price        numeric,
  avg_purchase_price  numeric,
  variance            numeric,
  traded_qty          numeric,
  sold_qty            numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT g.code, g.name_vi, g.name_en, g.native_uom,
         p.market_price, p.avg_purchase_price, p.variance,
         coalesce(t.traded, 0),
         coalesce(t.sold, 0)
    FROM pc49.gold_type g
    LEFT JOIN pc49.gold_price_daily p
           ON p.price_date = p_date AND p.gold_type_code = g.code
    LEFT JOIN LATERAL (
      SELECT sum(abs(x.qty))                                        AS traded,
             sum(abs(x.qty)) FILTER (WHERE x.txn_type IN ('SALE', 'PICKUP')) AS sold
        FROM pc49.gold_txn x
       WHERE x.gold_type_code = g.code AND x.txn_date = p_date AND x.voided_at IS NULL
    ) t ON true
   WHERE g.is_active
   ORDER BY g.sort_order
$$;

-- Sales that were posted on a day with no price, so they carry revenue and no
-- cost. Every one of these overstates the gross profit of its month.
CREATE OR REPLACE VIEW pc49.v_sale_without_cost AS
  SELECT t.id            AS txn_id,
         t.txn_date,
         to_char(t.txn_date, 'YYYY-MM') AS period,
         t.doc_no,
         t.gold_type_code,
         t.uom,
         t.qty,
         t.amount,
         t.partner_code
    FROM pc49.gold_txn t
   WHERE t.txn_type IN ('SALE', 'PICKUP')
     AND t.voided_at IS NULL
     AND t.journal_entry_id IS NOT NULL
     -- cogs_unit is written only on the cost line, so its absence across the
     -- whole entry is exactly "this sale was never costed".
     AND NOT EXISTS (
       SELECT 1 FROM pc49.journal_line l
        WHERE l.entry_id = t.journal_entry_id AND l.cogs_unit IS NOT NULL);

-- The same thing counted by day, which is what the price screen warns with.
CREATE OR REPLACE VIEW pc49.v_uncosted_by_day AS
  SELECT txn_date, gold_type_code, count(*) AS sales, sum(amount) AS revenue
    FROM pc49.v_sale_without_cost
   GROUP BY txn_date, gold_type_code;

GRANT SELECT ON pc49.v_sale_without_cost, pc49.v_uncosted_by_day TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0032_price_coverage')
ON CONFLICT (version) DO NOTHING;
