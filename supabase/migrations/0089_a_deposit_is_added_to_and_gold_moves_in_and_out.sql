-- 0089_a_deposit_is_added_to_and_gold_moves_in_and_out.sql
-- A customer adds to a deposit before collecting the gold; and the ledger says
-- how much gold came in and how much went out, not only the difference.
--
--   "Đơn đặt cọc chưa có tính năng khách chỉ trả thêm tiền chứ chưa pickup"
--   "Vàng vào / ra kho đang thể hiện chung, chưa tách ra nhập bao nhiêu, xuất
--    bao nhiêu. Và đang tính chung là gr, cần có thêm đvt gốc" (18-09-2026)
--
-- A later payment (0083) was for a purchase or a sale. Money added to a
-- deposit is the same kind of thing — cash against 131, on its own day — so it
-- is a later payment on the deposit, capped at what is left of the order.
-- Everything that says what was put down on a deposit now counts it:
--
--   deposit_paid           put down with the order, and added since
--   save_receipt_settlement  takes a deposit nobody has collected
--   gold_receipt_owed      a pickup owes the order less all of that
--   gold_receipt_deposit   the rows' "put down"
--   v_deposit_status       the deposits report
--
-- A deposit itself owes nothing (gold_receipt_owed stays 0): what is left is
-- paid when the gold is collected, and the deposit is not a debt until then.
--
-- The ledger's totals gain moves_by_gold: for each gold, how much came in and
-- how much went out, in its own unit and in grams. Gold leaves the shop when a
-- customer collects it, so a deposit and a cancelled deposit move nothing here;
-- the pickup is the gold going out. Counting both was counting one luong twice.
-- grams_by_gold is kept as it was for the screen still being served until the
-- code that reads moves_by_gold is deployed.

CREATE OR REPLACE FUNCTION pc49.deposit_paid(p_deposit uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT pc49.txn_paid(d.id)
       + coalesce((SELECT sum(s.amount) FROM pc49.gold_receipt_settlement s
                    WHERE s.receipt_key = coalesce(d.receipt_id, d.id)
                      AND s.voided_at IS NULL), 0)
    FROM pc49.gold_txn d WHERE d.id = p_deposit
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_owed(p_key uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH lines AS (
    SELECT t.id, t.txn_type::text AS txn_type, t.amount, t.conversion_id, t.deposit_ref_id
      FROM pc49.gold_txn t
     WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
            OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
       AND t.voided_at IS NULL
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM lines)
      OR EXISTS (SELECT 1 FROM lines WHERE conversion_id IS NOT NULL)
      OR pc49.settlement_side((SELECT min(txn_type) FROM lines)) IS NULL
      THEN 0::numeric
    ELSE greatest(round(
        abs(coalesce((SELECT sum(amount) FROM lines), 0))
      - coalesce((SELECT sum(gp.amount) FROM pc49.gold_txn_payment gp
                    JOIN lines l ON l.id = gp.txn_id), 0)
      - coalesce((SELECT sum(pc49.deposit_paid(l.deposit_ref_id)) FROM lines l
                   WHERE l.deposit_ref_id IS NOT NULL), 0)
      - coalesce((SELECT sum(s.amount) FROM pc49.gold_receipt_settlement s
                   WHERE s.receipt_key = p_key AND s.voided_at IS NULL), 0), 2), 0)
  END
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_deposit(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN f.txn_type = 'DEPOSIT' THEN jsonb_build_object(
      'role', 'deposit',
      'orderValue', pc49.deposit_order_value(f.id),
      'paid', pc49.deposit_paid(f.id),
      'settledBy', s.txn_type,
      'pickupDate', s.txn_date,
      'pickupDoc', s.doc_no)
    WHEN f.txn_type = 'PICKUP' AND d.id IS NOT NULL THEN jsonb_build_object(
      'role', 'pickup',
      'orderValue', abs(f.amount),
      'paid', pc49.deposit_paid(d.id),
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

CREATE OR REPLACE VIEW pc49.v_deposit_status AS
  SELECT d.id,
         d.txn_date,
         d.partner_code,
         d.gold_type_code,
         d.uom,
         d.qty,
         d.qty_gram,
         dep.paid AS deposit_amount,
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
         END AS status,
         o.value AS order_amount,
         dep.paid + coalesce(pick.paid, 0) AS paid_amount,
         CASE
           WHEN s.txn_type = 'CANCEL' THEN 0
           WHEN o.value IS NULL THEN NULL
           ELSE greatest(o.value - dep.paid - coalesce(pick.paid, 0), 0)
         END AS remaining_amount
    FROM pc49.gold_txn d
    LEFT JOIN pc49.gold_txn s ON s.deposit_ref_id = d.id AND s.voided_at IS NULL
    CROSS JOIN LATERAL (SELECT pc49.deposit_paid(d.id) AS paid) dep
    LEFT JOIN LATERAL (
      SELECT pc49.txn_paid(s.id)
             + coalesce((SELECT sum(x.amount) FROM pc49.gold_receipt_settlement x
                          WHERE x.receipt_key = coalesce(s.receipt_id, s.id)
                            AND x.voided_at IS NULL), 0) AS paid
       WHERE s.txn_type = 'PICKUP'
    ) pick ON true
    CROSS JOIN LATERAL (
      SELECT coalesce(pc49.deposit_order_value(d.id),
                      CASE WHEN s.txn_type = 'PICKUP' THEN nullif(s.amount, 0) END) AS value
    ) o
   WHERE d.txn_type = 'DEPOSIT' AND d.voided_at IS NULL;

-- 0083's body, taking a deposit nobody has collected as well.
CREATE OR REPLACE FUNCTION pc49.save_receipt_settlement(
  p_request_key text,
  p_receipt_key uuid,
  p_payload     jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_hash    text := md5(p_receipt_key::text || p_payload::text);
  v_seen    pc49.request_outcome;
  v_receipt pc49.gold_receipt;
  v_first   pc49.gold_txn;
  v_settled pc49.gold_txn;
  v_deposit boolean;
  v_side    text;
  v_date    date := nullif(p_payload ->> 'payDate', '')::date;
  v_amount  numeric := round(coalesce(nullif(p_payload ->> 'amount', '')::numeric, 0), 2);
  v_method  pc49.payment_method := (p_payload ->> 'method')::pc49.payment_method;
  v_note    text := nullif(btrim(coalesce(p_payload ->> 'note', '')), '');
  v_period  text;
  v_owed    numeric;
  v_doc     text;
  v_entry   uuid;
  v_id      uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  IF btrim(coalesce(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'a payment needs a request key so that retrying it is safe';
  END IF;

  SELECT * INTO v_seen FROM pc49.request_outcome
   WHERE actor = v_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_seen.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'REQUEST_KEY_REUSED: this request key was already used for different data';
    END IF;
    RETURN jsonb_build_object('settlementId', v_seen.txn_id,
                              'owed', pc49.gold_receipt_owed(p_receipt_key), 'repeated', true);
  END IF;

  -- Locked first, so two payments typed at once cannot both fit in what is owed.
  SELECT * INTO v_receipt FROM pc49.gold_receipt WHERE id = p_receipt_key FOR UPDATE;
  PERFORM 1 FROM pc49.gold_txn t
   WHERE t.receipt_id = p_receipt_key OR t.id = p_receipt_key FOR UPDATE;

  SELECT t.* INTO v_first
    FROM pc49.receipt_live_lines(p_receipt_key) l
    JOIN pc49.gold_txn t ON t.id = l.txn_id
   ORDER BY l.line_no LIMIT 1;

  IF v_first.id IS NULL OR v_receipt.voided_at IS NOT NULL THEN
    IF v_receipt.id IS NULL
       AND NOT EXISTS (SELECT 1 FROM pc49.gold_txn WHERE id = p_receipt_key) THEN
      RAISE EXCEPTION 'there is no such receipt';
    END IF;
    RAISE EXCEPTION 'RECEIPT_VOIDED: this receipt has already been cancelled';
  END IF;

  -- Money added to a deposit is taken as the deposit was: cash against 131.
  v_deposit := v_first.txn_type = 'DEPOSIT';
  v_side := CASE WHEN v_deposit THEN 'AR' ELSE pc49.settlement_side(v_first.txn_type::text) END;
  IF v_side IS NULL OR v_first.conversion_id IS NOT NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_KIND: only a purchase, a sale or a deposit is paid later, not a %',
      v_first.txn_type;
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'SETTLEMENT_AMOUNT: a payment is more than nothing';
  END IF;
  IF v_date IS NULL THEN
    RAISE EXCEPTION 'a payment needs the day it was made';
  END IF;
  IF v_date < coalesce(v_receipt.txn_date, v_first.txn_date) THEN
    RAISE EXCEPTION 'SETTLEMENT_DATE: receipt %, paid %; a payment cannot come before the receipt',
      coalesce(v_receipt.txn_date, v_first.txn_date), v_date;
  END IF;
  v_period := to_char(v_date, 'YYYY-MM');
  IF pc49.period_status(v_period) = 'CLOSED' THEN
    RAISE EXCEPTION 'SETTLEMENT_PERIOD: % is closed; date the payment in an open month', v_period;
  END IF;

  IF v_deposit THEN
    -- Once the gold is collected, what is left is the pickup's to pay.
    SELECT * INTO v_settled FROM pc49.gold_txn
     WHERE deposit_ref_id = v_first.id AND voided_at IS NULL LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'PICKUP_TAKEN: %; this deposit was already settled by a %',
        v_settled.txn_date, v_settled.txn_type;
    END IF;
    -- No more than is left of the order; not capped when nobody recorded it.
    v_owed := pc49.deposit_order_value(v_first.id) - pc49.deposit_paid(v_first.id);
    IF v_owed IS NOT NULL AND v_amount > v_owed THEN
      RAISE EXCEPTION 'SETTLEMENT_OVER: owed % paid %', greatest(v_owed, 0), v_amount;
    END IF;
  ELSE
    v_owed := pc49.gold_receipt_owed(p_receipt_key);
    IF v_amount > v_owed THEN
      RAISE EXCEPTION 'SETTLEMENT_OVER: owed % paid %', v_owed, v_amount;
    END IF;
  END IF;

  IF v_side = 'AP' AND EXISTS (
    SELECT 1
      FROM pc49.receipt_live_lines(p_receipt_key) l
      JOIN pc49.gold_txn t ON t.id = l.txn_id
     WHERE t.journal_entry_id IS NOT NULL
       AND -coalesce(t.amount, 0) > coalesce((SELECT sum(gp.amount) FROM pc49.gold_txn_payment gp
                                               WHERE gp.txn_id = t.id), 0)
       AND NOT EXISTS (SELECT 1 FROM pc49.journal_line jl
                        WHERE jl.entry_id = t.journal_entry_id
                          AND '331' IN (jl.debit_account, jl.credit_account))
  ) THEN
    RAISE EXCEPTION 'SETTLEMENT_OLD_POSTING: this purchase was posted before what is owed was booked; correct and save it once, then pay';
  END IF;

  v_doc := coalesce(v_receipt.doc_no, v_first.doc_no);

  INSERT INTO pc49.gold_receipt_settlement
    (receipt_key, pay_date, amount, method, note, created_by, updated_by)
  VALUES (p_receipt_key, v_date, v_amount, v_method, v_note, v_actor, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO pc49.journal_entry (entry_date, period, doc_no_hp, partner_code, txn_kind, memo)
  VALUES (v_date, v_period, v_doc, coalesce(v_receipt.partner_code, v_first.partner_code),
          CASE WHEN v_side = 'AP' THEN 'PO' ELSE 'SO' END::pc49.txn_kind,
          CASE WHEN v_deposit THEN 'Added to deposit ' ELSE 'Later payment ' END
            || coalesce(v_doc, '') || coalesce(' · ' || v_note, ''))
  RETURNING id INTO v_entry;

  INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
  VALUES (v_entry, 1,
          CASE WHEN v_side = 'AP' THEN '331' ELSE pc49.cash_account_for(v_method) END,
          CASE WHEN v_side = 'AP' THEN pc49.cash_account_for(v_method) ELSE '131' END,
          v_amount);

  UPDATE pc49.journal_entry SET posted_at = now(), posted_by = v_actor WHERE id = v_entry;
  UPDATE pc49.gold_receipt_settlement SET journal_entry_id = v_entry WHERE id = v_id;

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_receipt_settlement', v_hash, v_id);

  RETURN jsonb_build_object('settlementId', v_id, 'owed', v_owed - v_amount, 'repeated', false);
END $$;

-- The totals gain a column, and a function's result cannot be changed in place.
DROP FUNCTION IF EXISTS pc49.gold_receipt_ledger_totals(date, date, text, text, text, text, text, text);

CREATE FUNCTION pc49.gold_receipt_ledger_totals(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_gold   text DEFAULT NULL,
  p_staff  text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_query  text DEFAULT NULL)
RETURNS TABLE (receipt_count bigint, purchases numeric, sales numeric, grams_by_gold jsonb,
               moves_by_gold jsonb)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH matched AS (
    SELECT coalesce(t.receipt_id, t.conversion_id, t.id) AS k,
           t.txn_type, t.amount, t.gold_type_code, t.qty, t.qty_gram
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
  ),
  -- Gold that came into or left the shop. A deposit's gold stays until it is
  -- collected, and a cancelled deposit's never left.
  moved AS (
    SELECT * FROM matched WHERE txn_type NOT IN ('DEPOSIT', 'CANCEL')
  )
  SELECT (SELECT count(DISTINCT k) FROM matched),
         coalesce((SELECT -sum(amount) FROM matched WHERE txn_type IN ('PO', 'PO_VENDOR')), 0),
         coalesce((SELECT sum(amount) FROM matched WHERE txn_type IN ('SALE', 'PICKUP')), 0),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, g.grams)
                     FROM (SELECT gold_type_code, sum(qty_gram) AS grams FROM matched
                            GROUP BY gold_type_code HAVING sum(qty_gram) <> 0) g), '{}'::jsonb),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, jsonb_build_object(
                            'in', g.qty_in, 'inGrams', g.gram_in,
                            'out', g.qty_out, 'outGrams', g.gram_out))
                     FROM (SELECT gold_type_code,
                                  coalesce(sum(qty) FILTER (WHERE qty > 0), 0) AS qty_in,
                                  coalesce(sum(qty_gram) FILTER (WHERE qty > 0), 0) AS gram_in,
                                  coalesce(-sum(qty) FILTER (WHERE qty < 0), 0) AS qty_out,
                                  coalesce(-sum(qty_gram) FILTER (WHERE qty < 0), 0) AS gram_out
                             FROM moved
                            GROUP BY gold_type_code
                           HAVING sum(abs(qty)) <> 0) g), '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION pc49.deposit_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger_totals(
  date, date, text, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0089_a_deposit_is_added_to_and_gold_moves_in_and_out')
ON CONFLICT (version) DO NOTHING;
