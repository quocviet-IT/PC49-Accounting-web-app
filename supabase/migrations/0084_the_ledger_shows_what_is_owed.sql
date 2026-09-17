-- 0084_the_ledger_shows_what_is_owed.sql
-- The gold ledger says what was paid on a receipt later, and what is still owed.
--
--   gold_receipt_ledger_match  the payment filter also takes OWED, the receipts
--                              something is still owed on; and a way of paying
--                              finds a receipt paid that way later, not only at
--                              the counter
--   gold_receipt_ledger        returns the later payments still standing and
--                              what is owed (0083), after the conversion columns
--   gold_receipt_paid_later_with  a later payment still standing was made this
--                              way. Its own function, as gold_txn_paid_with is:
--                              a sub-select written into the match itself would
--                              stop the match being folded into the query (0069)

CREATE OR REPLACE FUNCTION pc49.gold_receipt_paid_later_with(p_key uuid, p_method text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pc49.gold_receipt_settlement s
                  WHERE s.receipt_key = p_key AND s.voided_at IS NULL
                    AND s.method::text = p_method)
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
     AND (p_method IS NULL
          OR (p_method = 'OWED'
              AND pc49.gold_receipt_owed(coalesce(t.receipt_id, t.conversion_id, t.id)) > 0)
          OR pc49.gold_txn_paid_with(t.id, p_method)
          OR pc49.gold_receipt_paid_later_with(coalesce(t.receipt_id, t.conversion_id, t.id), p_method))
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

-- The row gains two columns, and a function's result cannot be changed in place.
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
  settlements jsonb, owed numeric,
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
         pc49.gold_receipt_settlements(p.k),
         pc49.gold_receipt_owed(p.k),
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

GRANT EXECUTE ON FUNCTION pc49.gold_receipt_paid_later_with(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0084_the_ledger_shows_what_is_owed')
ON CONFLICT (version) DO NOTHING;
