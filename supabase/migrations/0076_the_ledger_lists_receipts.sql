-- 0076_the_ledger_lists_receipts.sql
-- The gold ledger lists receipts, one row each, with their items beneath.
--
-- The predicate is 0069's, one line at a time, with two changes. The search
-- also reads what the items are called ("nhan" finds the receipt with the
-- ring on it). And whether a receipt can be corrected is a fact about the
-- receipt: one item in a refining lot locks all of it, so every line of that
-- receipt answers "locked", and the receipt is never listed as correctable
-- because its other items could have been.
--
-- A receipt matches when any of its live items matches, so a filter on a gold
-- type finds the receipt with that gold on it and shows the whole receipt.
-- The totals still add up matching items, so purchases, sales and grams are
-- the figures they were; what they count is receipts.
--
--   gold_receipt_locked         a live item of the receipt is blocked (0071)
--   gold_receipt_ledger_match   the predicate
--   gold_receipt_lines          a receipt's items, as the screen expands them
--   gold_receipt_payments       what was paid on the receipt, by method
--   gold_receipt_sold_by        who sold it: the first item's shares
--   gold_receipt_ledger         one page of receipts, with the count of all
--   gold_receipt_ledger_totals  receipts, purchases, sales and grams per gold type
--
-- 0068's gold_txn_ledger and gold_txn_ledger_totals stay until nothing calls
-- them, and go in a later migration. Like 0069's helpers, nothing here sets a
-- search_path: every name is qualified, and the predicate must stay foldable.

CREATE OR REPLACE FUNCTION pc49.gold_receipt_locked(p_key uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pc49.gold_txn t
                  WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
                    AND t.voided_at IS NULL
                    AND pc49.correction_blocked_code(t.id) IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_ledger_match(
  t        pc49.gold_txn,
  p_from   date,
  p_to     date,
  p_type   text,
  p_gold   text,
  p_staff  text,
  p_method text,
  p_status text,
  p_query  text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT t.voided_at IS NULL
     AND (p_from IS NULL OR t.txn_date >= p_from)
     AND (p_to IS NULL OR t.txn_date <= p_to)
     AND (p_type IS NULL OR t.txn_type::text = p_type)
     AND (p_gold IS NULL OR t.gold_type_code = p_gold)
     AND (p_staff IS NULL
          OR t.sales_person_code = p_staff
          OR pc49.gold_txn_shared_by(t.id, p_staff))
     AND (p_method IS NULL OR pc49.gold_txn_paid_with(t.id, p_method))
     AND (p_status IS NULL
          OR (p_status = 'correctable'
              AND NOT pc49.gold_receipt_locked(coalesce(t.receipt_id, t.id)))
          OR (p_status = 'locked'
              AND pc49.gold_receipt_locked(coalesce(t.receipt_id, t.id))))
     AND (p_query IS NULL
          OR pc49.fold_search(p_query) = ''
          OR pc49.fold_search(t.doc_no) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.partner_code) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.remarks) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.item_desc) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.partner_phone_matches(t.partner_code, p_query))
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_lines(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'lineNo', coalesce(t.line_no, 1), 'itemDesc', t.item_desc,
           'goldTypeCode', t.gold_type_code, 'scrapDetail', t.scrap_detail,
           'goldPct', t.gold_pct, 'uom', t.uom, 'qty', t.qty,
           'unitPrice', t.unit_price, 'amount', t.amount,
           'blockedCode', pc49.correction_blocked_code(t.id))
         ORDER BY coalesce(t.line_no, 1)), '[]'::jsonb)
    FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
     AND t.voided_at IS NULL
$$;

-- One entry per method, in the order each was first used on the receipt: the
-- items' payments added back together.
CREATE OR REPLACE FUNCTION pc49.gold_receipt_payments(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'seq', m.seq, 'amount', m.amount, 'method', m.method) ORDER BY m.seq), '[]'::jsonb)
    FROM (SELECT gp.method::text AS method,
                 sum(gp.amount) AS amount,
                 row_number() OVER (ORDER BY min(coalesce(t.line_no, 1) * 1000 + gp.seq)) AS seq
            FROM pc49.gold_txn t
            JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
           WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
             AND t.voided_at IS NULL
           GROUP BY gp.method) m
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_sold_by(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'code', s.sales_person_code, 'sharePct', s.share_pct)
         ORDER BY s.share_pct DESC, s.sales_person_code), '[]'::jsonb)
    FROM pc49.gold_txn_sales_person s
   WHERE s.txn_id = (SELECT l.txn_id FROM pc49.receipt_live_lines(p_key) l
                      ORDER BY l.line_no LIMIT 1)
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_ledger(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_gold   text DEFAULT NULL,
  p_staff  text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_query  text DEFAULT NULL,
  p_limit  int  DEFAULT 50,
  p_offset int  DEFAULT 0)
RETURNS TABLE (
  receipt_key uuid, receipt_id uuid, txn_date date, doc_no text, txn_type text,
  partner_code text, partner_phone text, sales_person_code text, remarks text,
  revision int, blocked_code text, amount numeric, line_count int,
  lines jsonb, payments jsonb, sold_by jsonb, total_count bigint)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  -- Receipts are chosen and paged first, so the work below is done for fifty
  -- receipts, not all of them.
  WITH hit AS (
    SELECT coalesce(t.receipt_id, t.id) AS k,
           max(t.txn_date) AS txn_date,
           max(t.doc_no) AS doc_no,
           max(t.created_at) AS created_at
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
     GROUP BY coalesce(t.receipt_id, t.id)
  ),
  page AS (
    SELECT h.*, count(*) OVER () AS matched
      FROM hit h
     ORDER BY h.txn_date DESC, h.doc_no DESC NULLS LAST, h.created_at DESC, h.k
     LIMIT p_limit OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT p.k, r.id, p.txn_date, p.doc_no, f.txn_type::text, f.partner_code, pa.phone,
         f.sales_person_code, f.remarks, coalesce(r.revision, f.revision),
         (SELECT x ->> 'blockedCode' FROM jsonb_array_elements(ln.lines) x
           WHERE x ->> 'blockedCode' IS NOT NULL
           ORDER BY (x ->> 'lineNo')::int LIMIT 1),
         (SELECT coalesce(sum((x ->> 'amount')::numeric), 0)
            FROM jsonb_array_elements(ln.lines) x),
         jsonb_array_length(ln.lines),
         ln.lines,
         pc49.gold_receipt_payments(p.k),
         pc49.gold_receipt_sold_by(p.k),
         p.matched
    FROM page p
    CROSS JOIN LATERAL (SELECT pc49.gold_receipt_lines(p.k) AS lines) ln
    JOIN LATERAL (SELECT t.* FROM pc49.gold_txn t
                   WHERE (t.receipt_id = p.k OR (t.id = p.k AND t.receipt_id IS NULL))
                     AND t.voided_at IS NULL
                   ORDER BY coalesce(t.line_no, 1) LIMIT 1) f ON true
    LEFT JOIN pc49.gold_receipt r ON r.id = p.k
    LEFT JOIN pc49.partner pa ON pa.code = f.partner_code
   ORDER BY p.txn_date DESC, p.doc_no DESC NULLS LAST, p.created_at DESC, p.k
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_ledger_totals(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_gold   text DEFAULT NULL,
  p_staff  text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_query  text DEFAULT NULL)
RETURNS TABLE (receipt_count bigint, purchases numeric, sales numeric, grams_by_gold jsonb)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH matched AS (
    SELECT coalesce(t.receipt_id, t.id) AS k, t.txn_type, t.amount, t.gold_type_code, t.qty_gram
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
  )
  -- Purchases are stored negative and sales positive (0012); both are reported
  -- as the money that changed hands.
  SELECT (SELECT count(DISTINCT k) FROM matched),
         coalesce((SELECT -sum(amount) FROM matched WHERE txn_type IN ('PO', 'PO_VENDOR')), 0),
         coalesce((SELECT sum(amount) FROM matched WHERE txn_type IN ('SALE', 'PICKUP')), 0),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, g.grams)
                     FROM (SELECT gold_type_code, sum(qty_gram) AS grams FROM matched
                            GROUP BY gold_type_code HAVING sum(qty_gram) <> 0) g), '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION pc49.gold_receipt_locked(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger_match(
  pc49.gold_txn, date, date, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_payments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_sold_by(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger_totals(
  date, date, text, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0076_the_ledger_lists_receipts')
ON CONFLICT (version) DO NOTHING;
