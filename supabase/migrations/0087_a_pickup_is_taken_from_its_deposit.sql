-- 0087_a_pickup_is_taken_from_its_deposit.sql
-- The customer comes back for the gold: the pickup is written from its deposit.
--
--   "Khi pickup không chỉnh sửa được trạng thái từ deposit sang pickup, cũng
--    chưa có trường dữ liệu để phân biệt ngày nào đặt cọc, ngày nào pickup.
--    Chị có thử tạo đơn pickup riêng nhưng không lưu được" (17-09-2026)
--
-- A pickup has always had to name its deposit (0013), and the entry screen
-- offered PICKUP with nowhere to name one, so it could only fail. A pickup is
-- now made from the deposit's row: the same customer, gold, quantity, agreed
-- price and people, on the day it happens, under a number of its own, with
-- whatever was handed over then. Its amount is the whole order, as the loader
-- writes one and as 0015 posts it; what was put down at the deposit is taken
-- off what it owes (0086).
--
--   write_gold_transaction  0073's body, also taking the deposit a pickup settles
--   save_gold_pickup        the pickup, safely retried
--   gold_receipt_deposit    on a deposit's row, whether and when it was picked
--                           up; on a pickup's, when the deposit was taken
--   gold_receipt_ledger     returns that, after what is owed
--
-- The refusals begin with a code the screen translates:
--
--   PICKUP_NOT_DEPOSIT  what was named is not a deposit
--   PICKUP_TAKEN        the deposit was already picked up or cancelled, on that day
--   PICKUP_DATE         picked up before the deposit was taken
--   PICKUP_NO_PRICE     nobody recorded what the order comes to, and it was not given

CREATE OR REPLACE FUNCTION pc49.write_gold_transaction(
  p_payload jsonb,
  p_corrects uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_txn_id  uuid;
  v_qty     numeric := (p_payload ->> 'qty')::numeric;
  v_price   numeric := nullif(p_payload ->> 'unitPrice', '')::numeric;
  v_amount  numeric;
  v_claimed numeric := nullif(p_payload ->> 'amount', '')::numeric;
  v_pay     jsonb := coalesce(p_payload -> 'payments', '[]'::jsonb);
  v_who     jsonb := coalesce(p_payload -> 'salesPeople', '[]'::jsonb);
  v_shares  numeric;
  v_entry   uuid;
  v_line    jsonb;
  v_seq     int := 0;
BEGIN
  IF v_price IS NOT NULL THEN
    v_amount := round(-v_qty * v_price, 2);
    IF v_claimed IS NOT NULL AND abs(v_claimed - v_amount) > 0.005 THEN
      RAISE EXCEPTION 'the amount sent (%) is not what the quantity and price come to (%)',
        v_claimed, v_amount;
    END IF;
  ELSE
    v_amount := v_claimed;
  END IF;

  IF jsonb_array_length(v_who) > 1 THEN
    SELECT sum((x ->> 'sharePct')::numeric) INTO v_shares
      FROM jsonb_array_elements(v_who) x;
    IF v_shares IS NULL OR abs(v_shares - 100) > 0.005 THEN
      RAISE EXCEPTION 'the shares on an order must come to 100 percent, these come to %',
        coalesce(v_shares, 0);
    END IF;
  END IF;

  INSERT INTO pc49.gold_txn
    (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount,
     partner_code, scrap_detail, gold_pct, remarks, created_by, corrects_txn_id,
     doc_no, receipt_id, line_no, item_desc, deposit_ref_id)
  VALUES (
    (p_payload ->> 'txnDate')::date,
    (p_payload ->> 'txnType')::pc49.txn_type,
    p_payload ->> 'goldTypeCode',
    (p_payload ->> 'uom')::pc49.uom,
    v_qty, v_price, v_amount,
    nullif(p_payload ->> 'partnerCode', ''),
    nullif(p_payload ->> 'scrapDetail', ''),
    nullif(p_payload ->> 'goldPct', '')::numeric,
    nullif(p_payload ->> 'remarks', ''),
    v_actor, p_corrects,
    nullif(p_payload ->> 'docNo', ''),
    nullif(p_payload ->> 'receiptId', '')::uuid,
    nullif(p_payload ->> 'lineNo', '')::int,
    nullif(btrim(coalesce(p_payload ->> 'itemDesc', '')), ''),
    nullif(p_payload ->> 'depositRefId', '')::uuid)
  RETURNING id INTO v_txn_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_who) LOOP
    INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct)
    VALUES (v_txn_id, v_line ->> 'code', coalesce((v_line ->> 'sharePct')::numeric, 100));
  END LOOP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_pay) LOOP
    v_seq := v_seq + 1;
    INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
    VALUES (v_txn_id, v_seq,
            CASE WHEN v_amount >= 0 THEN 'AR' ELSE 'AP' END::pc49.payment_direction,
            (v_line ->> 'amount')::numeric,
            (v_line ->> 'method')::pc49.payment_method);
  END LOOP;

  v_entry := pc49.post_gold_txn(v_txn_id);

  RETURN jsonb_build_object('txnId', v_txn_id, 'entryId', v_entry, 'amount', v_amount);
END $$;

CREATE OR REPLACE FUNCTION pc49.save_gold_pickup(
  p_request_key text,
  p_deposit     uuid,
  p_payload     jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_hash    text := md5(p_deposit::text || p_payload::text);
  v_seen    pc49.request_outcome;
  d         pc49.gold_txn;
  v_settled pc49.gold_txn;
  v_date    date := nullif(p_payload ->> 'pickupDate', '')::date;
  v_order   numeric;
  v_who     jsonb;
  v_doc     text;
  v_receipt uuid;
  v_made    jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  IF btrim(coalesce(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'a pickup needs a request key so that retrying it is safe';
  END IF;

  SELECT * INTO v_seen FROM pc49.request_outcome
   WHERE actor = v_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_seen.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'REQUEST_KEY_REUSED: this request key was already used for different data';
    END IF;
    RETURN pc49.receipt_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  -- The deposit, by the ledger's key, locked so two people cannot both hand
  -- the same order over.
  SELECT t.* INTO d FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_deposit OR (t.id = p_deposit AND t.receipt_id IS NULL))
     AND t.voided_at IS NULL
   ORDER BY coalesce(t.line_no, 1)
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM pc49.gold_receipt WHERE id = p_deposit)
       OR EXISTS (SELECT 1 FROM pc49.gold_txn WHERE id = p_deposit) THEN
      RAISE EXCEPTION 'RECEIPT_VOIDED: this receipt has already been cancelled';
    END IF;
    RAISE EXCEPTION 'there is no such deposit';
  END IF;

  IF d.txn_type <> 'DEPOSIT' THEN
    RAISE EXCEPTION 'PICKUP_NOT_DEPOSIT: only a deposit is picked up, not a %', d.txn_type;
  END IF;

  SELECT * INTO v_settled FROM pc49.gold_txn
   WHERE deposit_ref_id = d.id AND voided_at IS NULL LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'PICKUP_TAKEN: %; this deposit was already settled by a %',
      v_settled.txn_date, v_settled.txn_type;
  END IF;

  IF v_date IS NULL THEN RAISE EXCEPTION 'a pickup needs the day it happened'; END IF;
  IF v_date < d.txn_date THEN
    RAISE EXCEPTION 'PICKUP_DATE: deposit %, picked up %; a pickup cannot come before its deposit',
      d.txn_date, v_date;
  END IF;

  v_order := coalesce(pc49.deposit_order_value(d.id),
                      round(nullif(p_payload ->> 'orderValue', '')::numeric, 2));
  IF v_order IS NULL OR v_order <= 0 THEN
    RAISE EXCEPTION 'PICKUP_NO_PRICE: nobody recorded what this order comes to; say what it does';
  END IF;

  -- The people credited with the deposit are credited with its collection.
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', s.sales_person_code, 'sharePct', s.share_pct)),
                  '[]'::jsonb)
    INTO v_who
    FROM pc49.gold_txn_sales_person s WHERE s.txn_id = d.id;

  v_doc := pc49.next_doc_no(v_date);

  INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type, partner_code, remarks, created_by, updated_by)
  VALUES (v_doc, v_date, 'PICKUP', d.partner_code, nullif(p_payload ->> 'remarks', ''), v_actor, v_actor)
  RETURNING id INTO v_receipt;

  v_made := pc49.write_gold_transaction(jsonb_build_object(
    'txnDate',      v_date,
    'txnType',      'PICKUP',
    'goldTypeCode', d.gold_type_code,
    'uom',          d.uom,
    'qty',          -abs(d.qty),
    -- The agreed price only where it is what the order comes to; a deposit with
    -- no price is collected at the value given, with no price.
    'unitPrice',    CASE WHEN d.unit_price IS NOT NULL
                          AND round(abs(d.qty) * d.unit_price, 2) = v_order THEN d.unit_price END,
    'amount',       v_order,
    'scrapDetail',  d.scrap_detail,
    'goldPct',      d.gold_pct,
    'itemDesc',     d.item_desc,
    'partnerCode',  d.partner_code,
    'remarks',      p_payload -> 'remarks',
    'salesPeople',  v_who,
    'payments',     coalesce(p_payload -> 'payments', '[]'::jsonb),
    'docNo',        v_doc,
    'receiptId',    v_receipt,
    'lineNo',       1,
    'depositRefId', d.id));

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_pickup', v_hash, (v_made ->> 'txnId')::uuid);

  RETURN jsonb_build_object('receiptId', v_receipt, 'docNo', v_doc, 'repeated', false);
END $$;

/**
 * A deposit's order and its collection, for the ledger row of either.
 *
 * On a deposit: what the order comes to, what was put down, and — once it is
 * settled — by what, on which day, under which number. On a pickup: the same
 * order, and when and under which number the deposit was taken. Null on
 * anything else.
 */
CREATE OR REPLACE FUNCTION pc49.gold_receipt_deposit(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN f.txn_type = 'DEPOSIT' THEN jsonb_build_object(
      'role', 'deposit',
      'orderValue', pc49.deposit_order_value(f.id),
      'paid', pc49.txn_paid(f.id),
      'settledBy', s.txn_type,
      'pickupDate', s.txn_date,
      'pickupDoc', s.doc_no)
    WHEN f.txn_type = 'PICKUP' AND d.id IS NOT NULL THEN jsonb_build_object(
      'role', 'pickup',
      'orderValue', abs(f.amount),
      'paid', pc49.txn_paid(d.id),
      'depositDate', d.txn_date,
      'depositDoc', d.doc_no)
  END
    FROM (SELECT t.* FROM pc49.gold_txn t
           WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
             AND t.voided_at IS NULL
           ORDER BY coalesce(t.line_no, 1)
           LIMIT 1) f
    LEFT JOIN pc49.gold_txn s ON f.txn_type = 'DEPOSIT' AND s.deposit_ref_id = f.id AND s.voided_at IS NULL
    LEFT JOIN pc49.gold_txn d ON d.id = f.deposit_ref_id
$$;

-- The row gains a column, and a function's result cannot be changed in place.
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
  settlements jsonb, owed numeric, deposit jsonb,
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
         pc49.gold_receipt_deposit(p.k),
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

GRANT EXECUTE ON FUNCTION pc49.save_gold_pickup(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_deposit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0087_a_pickup_is_taken_from_its_deposit')
ON CONFLICT (version) DO NOTHING;
