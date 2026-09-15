-- 0068_the_ledger_reads_every_day.sql
-- The gold transaction screen stops being one day at a time.
--
-- It read one date and filtered that day in the browser. On 14-09 the ask was
-- the whole ledger, newest first, filtered by a date range and by everything
-- the day view could filter by — on the database, so opening the screen does
-- not ship every transaction ever recorded to the browser, and a year from now
-- it is no slower than today.
--
-- One predicate, three readers, so the page, its totals and the Excel file
-- cannot disagree about which rows a filter means:
--
--   gold_txn_ledger_match   the predicate, one transaction at a time
--   gold_txn_ledger         one page, newest first, with the count of all
--   gold_txn_ledger_totals  count, purchases, sales and grams per gold type
--
-- All of them run as the caller, so the read policies on gold_txn, its
-- payments, its sales shares and partner still decide who sees what.

-- Search that forgives accents, case, spaces and punctuation: the rule the
-- screen's search box has used (normalizeTransactionSearch). "khanh" finds
-- "KHÁNH", "0901234567" finds "090 123 4567". translate() rather than the
-- unaccent extension, which the test database does not have; the capitals are
-- listed too because lower() only folds ASCII under the C locale.
CREATE OR REPLACE FUNCTION pc49.fold_search(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(lower(translate(coalesce(p_text, ''),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ'
      || 'ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ',
    repeat(repeat('a', 17) || repeat('e', 11) || repeat('i', 5) || repeat('o', 17)
           || repeat('u', 11) || repeat('y', 5) || 'd', 2))),
    '[^a-z0-9]+', '', 'g')
$$;

CREATE OR REPLACE FUNCTION pc49.gold_txn_ledger_match(
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
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT t.voided_at IS NULL
     AND (p_from IS NULL OR t.txn_date >= p_from)
     AND (p_to IS NULL OR t.txn_date <= p_to)
     AND (p_type IS NULL OR t.txn_type::text = p_type)
     AND (p_gold IS NULL OR t.gold_type_code = p_gold)
     -- The lead name, or anybody holding a share of the order.
     AND (p_staff IS NULL
          OR t.sales_person_code = p_staff
          OR EXISTS (SELECT 1 FROM pc49.gold_txn_sales_person s
                      WHERE s.txn_id = t.id AND s.sales_person_code = p_staff))
     AND (p_method IS NULL
          OR EXISTS (SELECT 1 FROM pc49.gold_txn_payment gp
                      WHERE gp.txn_id = t.id AND gp.method::text = p_method))
     AND (p_status IS NULL
          OR (p_status = 'correctable' AND pc49.correction_blocked_reason(t.id) IS NULL)
          OR (p_status = 'locked' AND pc49.correction_blocked_reason(t.id) IS NOT NULL))
     AND (pc49.fold_search(p_query) = ''
          OR pc49.fold_search(t.doc_no) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.partner_code) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.remarks) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR EXISTS (SELECT 1 FROM pc49.partner p
                      WHERE p.code = t.partner_code
                        AND pc49.fold_search(p.phone) LIKE '%' || pc49.fold_search(p_query) || '%'))
$$;

CREATE OR REPLACE FUNCTION pc49.gold_txn_ledger(
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
  id uuid, txn_date date, doc_no text, txn_type text, partner_code text,
  partner_phone text, sales_person_code text, gold_type_code text,
  scrap_detail text, gold_pct numeric, uom text, qty numeric, unit_price numeric,
  amount numeric, remarks text, revision int, blocked_reason text,
  payments jsonb, sold_by jsonb, total_count bigint)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  -- The page is chosen first, so the per-row work below — why a row cannot be
  -- corrected, its payments, its shares — is done for fifty rows, not all.
  WITH page AS (
    SELECT t.*, count(*) OVER () AS matched
      FROM pc49.gold_txn t
     WHERE pc49.gold_txn_ledger_match(t, p_from, p_to, p_type, p_gold,
                                      p_staff, p_method, p_status, p_query)
     ORDER BY t.txn_date DESC, t.doc_no DESC NULLS LAST, t.created_at DESC, t.id
     LIMIT p_limit OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT r.id, r.txn_date, r.doc_no, r.txn_type::text, r.partner_code,
         pa.phone, r.sales_person_code, r.gold_type_code, r.scrap_detail,
         r.gold_pct, r.uom::text, r.qty, r.unit_price, r.amount, r.remarks,
         r.revision, pc49.correction_blocked_reason(r.id),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                             'seq', gp.seq, 'amount', gp.amount, 'method', gp.method)
                           ORDER BY gp.seq)
                     FROM pc49.gold_txn_payment gp WHERE gp.txn_id = r.id), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(jsonb_build_object(
                             'code', s.sales_person_code, 'sharePct', s.share_pct)
                           ORDER BY s.share_pct DESC, s.sales_person_code)
                     FROM pc49.gold_txn_sales_person s WHERE s.txn_id = r.id), '[]'::jsonb),
         r.matched
    FROM page r
    LEFT JOIN pc49.partner pa ON pa.code = r.partner_code
   ORDER BY r.txn_date DESC, r.doc_no DESC NULLS LAST, r.created_at DESC, r.id
$$;

CREATE OR REPLACE FUNCTION pc49.gold_txn_ledger_totals(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_gold   text DEFAULT NULL,
  p_staff  text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_query  text DEFAULT NULL)
RETURNS TABLE (transaction_count bigint, purchases numeric, sales numeric, grams_by_gold jsonb)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH matched AS (
    SELECT t.txn_type, t.amount, t.gold_type_code, t.qty_gram
      FROM pc49.gold_txn t
     WHERE pc49.gold_txn_ledger_match(t, p_from, p_to, p_type, p_gold,
                                      p_staff, p_method, p_status, p_query)
  )
  -- Purchases are stored negative and sales positive (0012); both are reported
  -- as the money that changed hands.
  SELECT (SELECT count(*) FROM matched),
         coalesce((SELECT -sum(amount) FROM matched WHERE txn_type IN ('PO', 'PO_VENDOR')), 0),
         coalesce((SELECT sum(amount) FROM matched WHERE txn_type IN ('SALE', 'PICKUP')), 0),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, g.grams)
                     FROM (SELECT gold_type_code, sum(qty_gram) AS grams FROM matched
                            GROUP BY gold_type_code HAVING sum(qty_gram) <> 0) g), '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION pc49.fold_search(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_txn_ledger_match(
  pc49.gold_txn, date, date, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_txn_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_txn_ledger_totals(
  date, date, text, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0068_the_ledger_reads_every_day')
ON CONFLICT (version) DO NOTHING;
