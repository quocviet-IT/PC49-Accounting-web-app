-- 0022_stock_reports.sql
-- The stock reports, computed from the movement ledger.
--
-- The NXT sheet closes as
--   Closing = Opening + Receipts - Provisional issue value - Adjustment
-- and the adjustment is not a rounding artefact: 70,125.12 in January 2026,
-- against a gross profit of 31,008.27 for the same month. It gets its own
-- column and is never folded into cost.

-- Movements by month, ready to be aggregated with an opening balance.
CREATE OR REPLACE VIEW pc49.v_stock_period_movement AS
  SELECT to_char(move_date, 'YYYY-MM')                       AS period,
         gold_type_code,
         owner_code,
         sum(CASE WHEN qty_gram > 0 THEN qty_gram ELSE 0 END)                    AS receipt_gram,
         sum(CASE WHEN qty_gram < 0 THEN qty_gram ELSE 0 END)                    AS issue_gram,
         sum(CASE WHEN qty_gram > 0 THEN coalesce(provisional_value, 0) ELSE 0 END) AS receipt_value,
         sum(CASE WHEN qty_gram < 0 THEN coalesce(provisional_value, 0) ELSE 0 END) AS provisional_issue_value,
         sum(coalesce(valuation_adjustment, 0))                                  AS adjustment,
         sum(qty_gram)                                                            AS net_gram
    FROM pc49.inventory_movement
   WHERE bucket = 'ON_HAND'
   GROUP BY 1, 2, 3;

-- The NXT sheet. Opening comes from movements dated before the period, which is
-- how a period can be recomputed at any time without a stored running balance
-- that can go stale.
CREATE OR REPLACE FUNCTION pc49.stock_movement_report(p_period text, p_owner text DEFAULT 'PC49')
RETURNS TABLE (
  gold_type_code           text,
  gold_name_en             text,
  native_uom               pc49.uom,
  opening_gram             numeric,
  opening_value            numeric,
  receipt_gram             numeric,
  receipt_value            numeric,
  issue_gram               numeric,
  provisional_issue_value  numeric,
  adjustment               numeric,
  closing_gram             numeric,
  closing_value            numeric,
  avg_unit_cost            numeric
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH bounds AS (
    SELECT to_date(p_period || '-01', 'YYYY-MM-DD') AS period_start,
           (to_date(p_period || '-01', 'YYYY-MM-DD') + interval '1 month')::date AS next_start
  ),
  opening AS (
    SELECT m.gold_type_code,
           sum(m.qty_gram)                          AS gram,
           sum(coalesce(m.provisional_value, 0)
               * sign(m.qty_gram))                  AS value
      FROM pc49.inventory_movement m, bounds b
     WHERE m.bucket = 'ON_HAND' AND m.owner_code = p_owner
       AND m.move_date < b.period_start
     GROUP BY 1
  ),
  period AS (
    SELECT m.gold_type_code,
           sum(CASE WHEN m.qty_gram > 0 THEN m.qty_gram ELSE 0 END)                    AS receipt_gram,
           sum(CASE WHEN m.qty_gram < 0 THEN m.qty_gram ELSE 0 END)                    AS issue_gram,
           sum(CASE WHEN m.qty_gram > 0 THEN coalesce(m.provisional_value, 0) ELSE 0 END) AS receipt_value,
           sum(CASE WHEN m.qty_gram < 0 THEN coalesce(m.provisional_value, 0) ELSE 0 END) AS issue_value,
           sum(coalesce(m.valuation_adjustment, 0))                                    AS adjustment
      FROM pc49.inventory_movement m, bounds b
     WHERE m.bucket = 'ON_HAND' AND m.owner_code = p_owner
       AND m.move_date >= b.period_start AND m.move_date < b.next_start
     GROUP BY 1
  )
  SELECT g.code,
         g.name_en,
         g.native_uom,
         coalesce(o.gram, 0)                          AS opening_gram,
         coalesce(o.value, 0)                         AS opening_value,
         coalesce(p.receipt_gram, 0)                  AS receipt_gram,
         coalesce(p.receipt_value, 0)                 AS receipt_value,
         coalesce(p.issue_gram, 0)                    AS issue_gram,
         coalesce(p.issue_value, 0)                   AS provisional_issue_value,
         coalesce(p.adjustment, 0)                    AS adjustment,
         coalesce(o.gram, 0) + coalesce(p.receipt_gram, 0) + coalesce(p.issue_gram, 0)
           AS closing_gram,
         -- Exactly the NXT formula. The issue value and the adjustment are both
         -- subtracted, and both are signed, so an adjustment that reduces cost
         -- increases the closing value.
         coalesce(o.value, 0) + coalesce(p.receipt_value, 0)
           - coalesce(p.issue_value, 0) - coalesce(p.adjustment, 0)
           AS closing_value,
         CASE WHEN coalesce(o.gram, 0) + coalesce(p.receipt_gram, 0) = 0 THEN 0
              ELSE (coalesce(o.value, 0) + coalesce(p.receipt_value, 0))
                   / (coalesce(o.gram, 0) + coalesce(p.receipt_gram, 0)) END
           AS avg_unit_cost
    FROM pc49.gold_type g
    LEFT JOIN opening o ON o.gold_type_code = g.code
    LEFT JOIN period  p ON p.gold_type_code = g.code
   WHERE g.is_active
   ORDER BY g.sort_order
$$;

-- Closing balance per bucket per day, which is what the half-month INVENTORY
-- REPORT and the daily PHYSICAL GOLD INVENTORY are both built from.
CREATE OR REPLACE VIEW pc49.v_inventory_by_day AS
  SELECT move_date AS day,
         gold_type_code,
         owner_code,
         bucket,
         sum(qty_gram) AS moved_gram,
         sum(sum(qty_gram)) OVER (
           PARTITION BY gold_type_code, owner_code, bucket
           ORDER BY move_date
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS closing_gram
    FROM pc49.inventory_movement
   GROUP BY move_date, gold_type_code, owner_code, bucket;

-- The three states the Deposit & Pickup sheet colour-codes by hand.
CREATE OR REPLACE VIEW pc49.v_deposit_status AS
  SELECT d.id,
         d.txn_date,
         d.partner_code,
         d.gold_type_code,
         d.uom,
         d.qty,
         d.qty_gram,
         d.amount AS deposit_amount,
         s.txn_type::text AS settled_by,
         s.txn_date       AS settled_date,
         CASE
           WHEN s.txn_type = 'PICKUP' THEN 'COLLECTED'
           WHEN s.txn_type = 'CANCEL' THEN 'CANCELLED'
           WHEN EXISTS (SELECT 1 FROM pc49.v_inventory_book b
                         WHERE b.gold_type_code = d.gold_type_code
                           AND b.owner_code = 'PC49' AND b.qty_gram > 0)
             THEN 'AWAITING_COLLECTION'
           ELSE 'ON_ORDER'
         END AS status
    FROM pc49.gold_txn d
    LEFT JOIN pc49.gold_txn s ON s.deposit_ref_id = d.id AND s.voided_at IS NULL
   WHERE d.txn_type = 'DEPOSIT' AND d.voided_at IS NULL;

-- The AP Report: what is owed to the vendors PC49 buys bullion from.
CREATE OR REPLACE VIEW pc49.v_vendor_payable AS
  SELECT t.partner_code,
         t.gold_type_code,
         sum(t.qty)                                        AS qty,
         sum(-t.amount)                                    AS purchased_value,
         sum(-t.amount) - coalesce(sum(p.paid), 0)         AS outstanding
    FROM pc49.gold_txn t
    LEFT JOIN LATERAL (
      SELECT sum(amount) AS paid FROM pc49.gold_txn_payment gp WHERE gp.txn_id = t.id
    ) p ON true
   WHERE t.txn_type = 'PO_VENDOR' AND t.voided_at IS NULL
   GROUP BY 1, 2;

GRANT SELECT ON pc49.v_stock_period_movement, pc49.v_inventory_by_day,
                pc49.v_deposit_status, pc49.v_vendor_payable TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0022_stock_reports')
ON CONFLICT (version) DO NOTHING;
