-- 0074_a_receipt_is_saved_whole.sql
-- Saving a receipt of several items: one number, one call, whole or not at all.
--
--   write_gold_receipt   the body: the checks, the receipt row, each line
--                        through write_gold_transaction, the payments divided
--   receipt_answer       what a repeated request is answered with
--   save_gold_receipt    the request key and the retry check around the body,
--                        as save_gold_transaction has them (0054)
--
-- The refusals begin with a code the screen translates, and name the item
-- where there is one to name:
--
--   RECEIPT_SIZE       fewer than 1 or more than 30 items
--   RECEIPT_SINGLE     a deposit or a pickup with more than one item: the two
--                      are tied to each other one transaction at a time
--   RECEIPT_QTY        an item with no quantity
--   RECEIPT_DIRECTION  items moving both ways; an exchange is two receipts
--   PAYMENT_SHORT      a purchase or deposit item the payments never reach,
--                      which the books cannot post (0015 books a purchase
--                      from what was paid for it)

CREATE OR REPLACE FUNCTION pc49.write_gold_receipt(
  p_payload          jsonb,
  p_doc_no           text DEFAULT NULL,
  p_corrects_receipt uuid DEFAULT NULL,
  p_corrects_txn     uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_lines   jsonb := coalesce(p_payload -> 'lines', '[]'::jsonb);
  v_type    text := p_payload ->> 'txnType';
  v_date    date := (p_payload ->> 'txnDate')::date;
  v_n       int;
  v_amounts numeric[];
  v_alloc   jsonb;
  v_doc     text;
  v_receipt uuid;
  v_line    jsonb;
  v_made    jsonb;
  v_first   uuid;
  v_i       int;
BEGIN
  IF jsonb_typeof(v_lines) <> 'array' THEN
    RAISE EXCEPTION 'RECEIPT_SIZE: a receipt holds from 1 to 30 items; this one has none';
  END IF;
  v_n := jsonb_array_length(v_lines);
  IF v_n < 1 OR v_n > 30 THEN
    RAISE EXCEPTION 'RECEIPT_SIZE: a receipt holds from 1 to 30 items; this one has %', v_n;
  END IF;
  IF v_type IN ('DEPOSIT', 'PICKUP') AND v_n <> 1 THEN
    RAISE EXCEPTION 'RECEIPT_SINGLE: a deposit or a pickup is one item; this one has %', v_n;
  END IF;
  FOR v_i IN 1..v_n LOOP
    IF coalesce(nullif(v_lines -> (v_i - 1) ->> 'qty', '')::numeric, 0) = 0 THEN
      RAISE EXCEPTION 'RECEIPT_QTY: item % has no quantity', v_i;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT sign((l ->> 'qty')::numeric))
        FROM jsonb_array_elements(v_lines) l) > 1 THEN
    RAISE EXCEPTION 'RECEIPT_DIRECTION: every item on a receipt moves the same way; an exchange is two receipts';
  END IF;

  -- Each line's amount, worked out the way write_gold_transaction works it
  -- out, so the payments are divided against the figures that will be stored.
  SELECT array_agg(CASE
           WHEN nullif(l ->> 'unitPrice', '') IS NOT NULL
             THEN round(-(l ->> 'qty')::numeric * (l ->> 'unitPrice')::numeric, 2)
           ELSE coalesce(nullif(l ->> 'amount', '')::numeric, 0)
         END ORDER BY o)
    INTO v_amounts
    FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS x(l, o);

  v_alloc := pc49.allocate_receipt_payments(v_amounts, p_payload -> 'payments');

  IF v_type IN ('PO', 'PO_VENDOR', 'DEPOSIT') THEN
    FOR v_i IN 1..v_n LOOP
      IF jsonb_array_length(v_alloc -> (v_i - 1)) = 0 THEN
        RAISE EXCEPTION 'PAYMENT_SHORT: item % is left with no payment; the payments on this receipt do not reach it', v_i;
      END IF;
    END LOOP;
  END IF;

  -- A correction keeps the number of what it corrects (0057).
  v_doc := coalesce(nullif(btrim(p_doc_no), ''), pc49.next_doc_no(v_date));

  INSERT INTO pc49.gold_receipt
    (doc_no, txn_date, txn_type, partner_code, remarks, corrects_receipt_id,
     created_by, updated_by)
  VALUES (v_doc, v_date, v_type::pc49.txn_type,
          nullif(p_payload ->> 'partnerCode', ''), nullif(p_payload ->> 'remarks', ''),
          p_corrects_receipt, v_actor, v_actor)
  RETURNING id INTO v_receipt;

  FOR v_i IN 1..v_n LOOP
    v_line := v_lines -> (v_i - 1);
    v_made := pc49.write_gold_transaction(
      jsonb_build_object(
        'txnDate',      v_date,
        'txnType',      v_type,
        'goldTypeCode', v_line -> 'goldTypeCode',
        'uom',          v_line -> 'uom',
        'qty',          v_line -> 'qty',
        'unitPrice',    v_line -> 'unitPrice',
        'amount',       v_line -> 'amount',
        'scrapDetail',  v_line -> 'scrapDetail',
        'goldPct',      v_line -> 'goldPct',
        'itemDesc',     v_line -> 'itemDesc',
        'partnerCode',  p_payload -> 'partnerCode',
        'remarks',      p_payload -> 'remarks',
        'salesPeople',  coalesce(p_payload -> 'salesPeople', '[]'::jsonb),
        'payments',     v_alloc -> (v_i - 1),
        'docNo',        v_doc,
        'receiptId',    v_receipt,
        'lineNo',       v_i),
      -- A receipt replacing a transaction from before receipts says so on its
      -- first line, as a corrected transaction always has (0055).
      CASE WHEN v_i = 1 THEN p_corrects_txn END);
    IF v_i = 1 THEN v_first := (v_made ->> 'txnId')::uuid; END IF;
  END LOOP;

  RETURN jsonb_build_object('receiptId', v_receipt, 'docNo', v_doc, 'firstTxnId', v_first);
END $$;

/** What a repeated request is answered with: the receipt its first line belongs to. */
CREATE OR REPLACE FUNCTION pc49.receipt_answer(p_first_txn uuid)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('receiptId', coalesce(t.receipt_id, t.id), 'docNo', t.doc_no)
    FROM pc49.gold_txn t WHERE t.id = p_first_txn
$$;

CREATE OR REPLACE FUNCTION pc49.save_gold_receipt(
  p_request_key text,
  p_payload     jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hash  text := md5(p_payload::text);
  v_seen  pc49.request_outcome;
  v_made  jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  IF btrim(coalesce(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'a save needs a request key so that retrying it is safe';
  END IF;

  SELECT * INTO v_seen FROM pc49.request_outcome
   WHERE actor = v_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_seen.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'REQUEST_KEY_REUSED: this request key was already used for different data';
    END IF;
    RETURN pc49.receipt_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  v_made := pc49.write_gold_receipt(p_payload);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_receipt', v_hash,
          (v_made ->> 'firstTxnId')::uuid);

  RETURN jsonb_build_object('receiptId', v_made -> 'receiptId', 'docNo', v_made -> 'docNo',
                            'repeated', false);
END $$;

GRANT EXECUTE ON FUNCTION pc49.write_gold_receipt(jsonb, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.receipt_answer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.save_gold_receipt(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0074_a_receipt_is_saved_whole')
ON CONFLICT (version) DO NOTHING;
