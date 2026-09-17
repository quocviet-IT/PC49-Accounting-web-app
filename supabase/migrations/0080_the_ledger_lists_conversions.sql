-- 0080_the_ledger_lists_conversions.sql
-- A conversion is one row of the gold ledger, as a receipt is.
--
-- The ledger's key becomes coalesce(receipt_id, conversion_id, id) in every
-- function 0075 and 0076 wrote around it. A refining lot's leg has no
-- conversion and stays a row of its own, locked by REFINING_LEG (0077).
--
--   receipt_live_lines          the live lines behind a key, a conversion's legs
--                               too, so a receipt function handed a conversion's
--                               key refuses it: every leg is CONVERSION_LEG
--   gold_receipt_blocked_code   why a row may not be corrected: a receipt's first
--                               blocked item, as 0076 read it; for a conversion,
--                               its legs' codes other than CONVERSION_LEG, and
--                               REFINING_LEG for a refining lot's conversion
--   gold_receipt_locked         that code, not null
--   gold_receipt_lines          each line also says its side of a conversion
--                               ("out", "in"), numbered within the side
--   gold_receipt_ledger         also returns the conversion, its kind and its
--                               variance. A conversion row shows the conversion's
--                               number, partner, note and revision. A loaded
--                               conversion has no number of its own and shows the
--                               smallest of its legs'; its note is the loader's
--                               key, so its first leg's remarks show instead
--   gold_receipt_ledger_totals  counts a conversion once

CREATE OR REPLACE FUNCTION pc49.receipt_live_lines(p_key uuid)
RETURNS TABLE (txn_id uuid, line_no int)
LANGUAGE sql STABLE AS $$
  SELECT t.id, coalesce(t.line_no, 1)
    FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
          OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
     AND t.voided_at IS NULL
   ORDER BY CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END,
            coalesce(t.line_no, 1), t.created_at, t.id
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_blocked_code(p_key uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN c.kind IN ('REFINING_SEND', 'REFINING_RECEIVE') THEN 'REFINING_LEG'
    ELSE (SELECT x.code
            FROM (SELECT pc49.correction_blocked_code(t.id) AS code,
                         CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END AS side_rank,
                         coalesce(t.line_no, 1) AS line_no, t.created_at, t.id
                    FROM pc49.gold_txn t
                   WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
                          OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
                     AND t.voided_at IS NULL) x
           WHERE x.code IS NOT NULL
             AND NOT (c.id IS NOT NULL AND x.code = 'CONVERSION_LEG')
           ORDER BY x.side_rank, x.line_no, x.created_at, x.id
           LIMIT 1)
  END
    FROM (SELECT p_key AS k) q
    LEFT JOIN pc49.gold_conversion c ON c.id = q.k
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_locked(p_key uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pc49.gold_receipt_blocked_code(p_key) IS NOT NULL
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
              AND NOT pc49.gold_receipt_locked(coalesce(t.receipt_id, t.conversion_id, t.id)))
          OR (p_status = 'locked'
              AND pc49.gold_receipt_locked(coalesce(t.receipt_id, t.conversion_id, t.id))))
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
           'id', x.id, 'lineNo', x.n, 'side', x.side, 'itemDesc', x.item_desc,
           'goldTypeCode', x.gold_type_code, 'scrapDetail', x.scrap_detail,
           'goldPct', x.gold_pct, 'uom', x.uom, 'qty', x.qty,
           'unitPrice', x.unit_price, 'amount', x.amount,
           'blockedCode', pc49.correction_blocked_code(x.id))
         ORDER BY x.side_rank, x.n), '[]'::jsonb)
    FROM (SELECT t.id, t.item_desc, t.gold_type_code, t.scrap_detail, t.gold_pct, t.uom,
                 t.qty, t.unit_price, t.amount,
                 CASE WHEN t.conversion_id IS NULL THEN NULL
                      WHEN t.qty < 0 THEN 'out' ELSE 'in' END AS side,
                 CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END AS side_rank,
                 row_number() OVER (
                   PARTITION BY (t.conversion_id IS NOT NULL AND t.qty > 0)
                   ORDER BY coalesce(t.line_no, 1), t.created_at, t.id) AS n
            FROM pc49.gold_txn t
           WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
                  OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
             AND t.voided_at IS NULL) x
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_payments(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'seq', m.seq, 'amount', m.amount, 'method', m.method) ORDER BY m.seq), '[]'::jsonb)
    FROM (SELECT gp.method::text AS method,
                 sum(gp.amount) AS amount,
                 row_number() OVER (ORDER BY min(coalesce(t.line_no, 1) * 1000 + gp.seq)) AS seq
            FROM pc49.gold_txn t
            JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
           WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
                  OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
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

-- The row gains four columns, and a function's result cannot be changed in place.
DROP FUNCTION IF EXISTS pc49.gold_receipt_ledger(date, date, text, text, text, text, text, text, int, int);

CREATE FUNCTION pc49.gold_receipt_ledger(
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
  lines jsonb, payments jsonb, sold_by jsonb,
  conversion_id uuid, conversion_kind text, variance_note text, variance_reason text,
  total_count bigint)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH hit AS (
    SELECT coalesce(t.receipt_id, t.conversion_id, t.id) AS k,
           max(t.txn_date) AS txn_date,
           min(t.doc_no) AS doc_no,
           max(t.created_at) AS created_at
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
     GROUP BY coalesce(t.receipt_id, t.conversion_id, t.id)
  ),
  page AS (
    SELECT h.*, count(*) OVER () AS matched
      FROM hit h
     ORDER BY h.txn_date DESC, h.doc_no DESC NULLS LAST, h.created_at DESC, h.k
     LIMIT p_limit OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT p.k, r.id, p.txn_date, coalesce(r.doc_no, c.doc_no, p.doc_no), f.txn_type::text,
         CASE WHEN c.doc_no IS NOT NULL THEN c.partner_code ELSE f.partner_code END,
         pa.phone, f.sales_person_code,
         CASE WHEN c.doc_no IS NOT NULL THEN c.note ELSE f.remarks END,
         coalesce(r.revision, c.revision, f.revision),
         pc49.gold_receipt_blocked_code(p.k),
         (SELECT coalesce(sum((x ->> 'amount')::numeric), 0)
            FROM jsonb_array_elements(ln.lines) x),
         jsonb_array_length(ln.lines),
         ln.lines,
         pc49.gold_receipt_payments(p.k),
         pc49.gold_receipt_sold_by(p.k),
         c.id, c.kind::text, c.variance_note, c.variance_reason,
         p.matched
    FROM page p
    CROSS JOIN LATERAL (SELECT pc49.gold_receipt_lines(p.k) AS lines) ln
    JOIN LATERAL (SELECT t.* FROM pc49.gold_txn t
                   WHERE (t.receipt_id = p.k OR t.conversion_id = p.k
                          OR (t.id = p.k AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
                     AND t.voided_at IS NULL
                   ORDER BY CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END,
                            coalesce(t.line_no, 1), t.created_at, t.id
                   LIMIT 1) f ON true
    LEFT JOIN pc49.gold_receipt r ON r.id = p.k
    LEFT JOIN pc49.gold_conversion c ON c.id = p.k
    LEFT JOIN pc49.partner pa
      ON pa.code = CASE WHEN c.doc_no IS NOT NULL THEN c.partner_code ELSE f.partner_code END
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
    SELECT coalesce(t.receipt_id, t.conversion_id, t.id) AS k,
           t.txn_type, t.amount, t.gold_type_code, t.qty_gram
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
  )
  SELECT (SELECT count(DISTINCT k) FROM matched),
         coalesce((SELECT -sum(amount) FROM matched WHERE txn_type IN ('PO', 'PO_VENDOR')), 0),
         coalesce((SELECT sum(amount) FROM matched WHERE txn_type IN ('SALE', 'PICKUP')), 0),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, g.grams)
                     FROM (SELECT gold_type_code, sum(qty_gram) AS grams FROM matched
                            GROUP BY gold_type_code HAVING sum(qty_gram) <> 0) g), '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION pc49.gold_receipt_blocked_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0080_the_ledger_lists_conversions')
ON CONFLICT (version) DO NOTHING;
