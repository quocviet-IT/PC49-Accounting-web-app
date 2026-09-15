-- 0071_a_refusal_to_correct_is_a_code.sql
-- Why a transaction cannot be corrected comes back as a code, and the screen
-- says it in the reader's language.
--
-- 0055 answered with an English sentence and the ledger showed it as it came,
-- so an accountant working in Vietnamese who pointed at a greyed-out Sửa read
-- "this is one leg of a conversion; correct the conversion instead". The import
-- screen's reason codes already work the other way round: the database names
-- the case, and the screen puts it into words.
--
--   correction_blocked_code     NOT_FOUND, VOIDED, CONVERSION_LEG, DEPOSIT_PICKUP,
--                               DEPOSIT_PICKED_UP, REFINING_RECEIPT,
--                               REFINING_SOURCE, CASH_LINK, or null when the row
--                               can be corrected: 0055's checks, in 0055's order
--   correction_blocked_reason   the same English sentences as before, now read
--                               off the code, for the refusal
--                               correct_gold_transaction raises and for
--                               v_gold_txn_correctable
--   gold_txn_ledger_match       filters on the code
--   gold_txn_ledger             returns blocked_code where it returned
--                               blocked_reason

CREATE OR REPLACE FUNCTION pc49.correction_blocked_code(p_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  t pc49.gold_txn;
BEGIN
  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF t.voided_at IS NOT NULL THEN RETURN 'VOIDED'; END IF;

  IF t.conversion_id IS NOT NULL THEN RETURN 'CONVERSION_LEG'; END IF;
  IF t.deposit_ref_id IS NOT NULL THEN RETURN 'DEPOSIT_PICKUP'; END IF;
  IF EXISTS (SELECT 1 FROM pc49.gold_txn p WHERE p.deposit_ref_id = p_id
              AND p.voided_at IS NULL) THEN
    RETURN 'DEPOSIT_PICKED_UP';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_receipt r WHERE r.gold_txn_id = p_id) THEN
    RETURN 'REFINING_RECEIPT';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_lot_source s WHERE s.txn_id = p_id) THEN
    RETURN 'REFINING_SOURCE';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.cash_txn c WHERE c.gold_txn_id = p_id) THEN
    RETURN 'CASH_LINK';
  END IF;

  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION pc49.correction_blocked_code(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION pc49.correction_blocked_reason(p_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
  SELECT CASE pc49.correction_blocked_code(p_id)
    WHEN 'NOT_FOUND'         THEN 'there is no such transaction'
    WHEN 'VOIDED'            THEN 'this transaction has already been cancelled'
    WHEN 'CONVERSION_LEG'    THEN 'this is one leg of a conversion; correct the conversion instead'
    WHEN 'DEPOSIT_PICKUP'    THEN 'this is the pickup for a deposit; the two are corrected together'
    WHEN 'DEPOSIT_PICKED_UP' THEN 'a pickup has already been recorded against this deposit'
    WHEN 'REFINING_RECEIPT'  THEN 'this row came back from a refining lot'
    WHEN 'REFINING_SOURCE'   THEN 'this purchase has been picked into a refining lot'
    WHEN 'CASH_LINK'         THEN 'this is tied to a cash movement'
  END
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
          OR (p_status = 'correctable' AND pc49.correction_blocked_code(t.id) IS NULL)
          OR (p_status = 'locked' AND pc49.correction_blocked_code(t.id) IS NOT NULL))
     AND (p_query IS NULL
          OR pc49.fold_search(p_query) = ''
          OR pc49.fold_search(t.doc_no) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.partner_code) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.remarks) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.partner_phone_matches(t.partner_code, p_query))
$$;

-- A column changes name and meaning, and CREATE OR REPLACE cannot change what a
-- function returns, so the page reader is dropped and made again.
DROP FUNCTION pc49.gold_txn_ledger(date, date, text, text, text, text, text, text, int, int);

CREATE FUNCTION pc49.gold_txn_ledger(
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
  amount numeric, remarks text, revision int, blocked_code text,
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
         r.revision, pc49.correction_blocked_code(r.id),
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

GRANT EXECUTE ON FUNCTION pc49.gold_txn_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0071_a_refusal_to_correct_is_a_code')
ON CONFLICT (version) DO NOTHING;
