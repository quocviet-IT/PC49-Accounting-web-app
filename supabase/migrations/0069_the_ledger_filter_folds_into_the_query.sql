-- 0069_the_ledger_filter_folds_into_the_query.sql
-- The ledger checks its filter inside the query, not by calling a function once
-- for every transaction.
--
-- 0068 wrote the filter as one function, gold_txn_ledger_match, so the page, its
-- totals and the Excel file cannot disagree about what a filter means. That
-- stays. What changes is that PostgreSQL could not fold the function into the
-- query around it, for two reasons: it set its own search_path, and it held
-- sub-queries (EXISTS). A SQL function with either is called separately for
-- every row. Measured on the live database on 15-09, as a signed-in user, with
-- 1062 transactions and no filter at all: 104 ms for a page of the ledger and
-- 84 for its totals. With the same checks written into the query, 29 and 21.
--
-- So the predicate is now a plain expression, and its three sub-queries move
-- into small functions of their own, reached only when their filter is in use:
--
--   gold_txn_shared_by      somebody holds a share of the order
--   gold_txn_paid_with      part of the order was paid this way
--   partner_phone_matches   the customer's phone contains the search
--
-- None of the four sets search_path, for the reason fold_search never did:
-- everything they name is qualified with pc49., and they run as the caller, so
-- a caller's search_path can change nothing the caller could not already do. A
-- missing search is also recognised before anything is folded.

CREATE OR REPLACE FUNCTION pc49.gold_txn_shared_by(p_txn_id uuid, p_staff text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pc49.gold_txn_sales_person s
                  WHERE s.txn_id = p_txn_id AND s.sales_person_code = p_staff)
$$;

CREATE OR REPLACE FUNCTION pc49.gold_txn_paid_with(p_txn_id uuid, p_method text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pc49.gold_txn_payment gp
                  WHERE gp.txn_id = p_txn_id AND gp.method::text = p_method)
$$;

CREATE OR REPLACE FUNCTION pc49.partner_phone_matches(p_partner_code text, p_query text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pc49.partner p
                  WHERE p.code = p_partner_code
                    AND pc49.fold_search(p.phone) LIKE '%' || pc49.fold_search(p_query) || '%')
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
LANGUAGE sql STABLE AS $$
  SELECT t.voided_at IS NULL
     AND (p_from IS NULL OR t.txn_date >= p_from)
     AND (p_to IS NULL OR t.txn_date <= p_to)
     AND (p_type IS NULL OR t.txn_type::text = p_type)
     AND (p_gold IS NULL OR t.gold_type_code = p_gold)
     -- The lead name, or anybody holding a share of the order.
     AND (p_staff IS NULL
          OR t.sales_person_code = p_staff
          OR pc49.gold_txn_shared_by(t.id, p_staff))
     AND (p_method IS NULL OR pc49.gold_txn_paid_with(t.id, p_method))
     AND (p_status IS NULL
          OR (p_status = 'correctable' AND pc49.correction_blocked_reason(t.id) IS NULL)
          OR (p_status = 'locked' AND pc49.correction_blocked_reason(t.id) IS NOT NULL))
     AND (p_query IS NULL
          OR pc49.fold_search(p_query) = ''
          OR pc49.fold_search(t.doc_no) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.partner_code) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.remarks) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.partner_phone_matches(t.partner_code, p_query))
$$;

GRANT EXECUTE ON FUNCTION pc49.gold_txn_shared_by(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_txn_paid_with(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.partner_phone_matches(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0069_the_ledger_filter_folds_into_the_query')
ON CONFLICT (version) DO NOTHING;
