-- 0075_a_receipt_is_corrected_whole.sql
-- Correcting and cancelling a receipt, every item at once.
--
-- Both take the receipt's key as the ledger lists it: coalesce(receipt_id, id).
-- A row written before receipts existed, or by the loader, a refining lot or a
-- conversion, is a receipt of one line, and is corrected and cancelled the
-- same way.
--
--   receipt_live_lines     the live lines behind a key, in item order
--   refuse_blocked_lines   stops at the first item something else points at
--   correct_gold_receipt   reverses every line and writes the corrected receipt
--                          in one transaction, keeping its number
--   void_gold_receipt      reverses every line
--
-- An item that something else points at (0071's codes) stops the whole
-- receipt, and the refusal names the item: LINE_BLOCKED: item 3 REFINING_SOURCE.
-- Cancelling makes one exception. A pickup is cancelled before its deposit
-- (void_gold_txn itself says so), so DEPOSIT_PICKUP does not stop a void.

CREATE OR REPLACE FUNCTION pc49.receipt_live_lines(p_key uuid)
RETURNS TABLE (txn_id uuid, line_no int)
LANGUAGE sql STABLE AS $$
  SELECT t.id, coalesce(t.line_no, 1)
    FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
     AND t.voided_at IS NULL
   ORDER BY coalesce(t.line_no, 1)
$$;

CREATE OR REPLACE FUNCTION pc49.refuse_blocked_lines(p_key uuid, p_allow text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_line record;
  v_code text;
BEGIN
  FOR v_line IN SELECT l.txn_id, l.line_no FROM pc49.receipt_live_lines(p_key) l ORDER BY l.line_no LOOP
    v_code := pc49.correction_blocked_code(v_line.txn_id);
    IF v_code IS NOT NULL AND NOT v_code = ANY (p_allow) THEN
      RAISE EXCEPTION 'LINE_BLOCKED: item % % cannot be changed here', v_line.line_no, v_code;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION pc49.correct_gold_receipt(
  p_request_key       text,
  p_original          uuid,
  p_expected_revision int,
  p_reason            text,
  p_payload           jsonb,
  p_reversal_date     date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_hash     text := md5(p_payload::text);
  v_seen     pc49.request_outcome;
  v_receipt  pc49.gold_receipt;
  v_lone     pc49.gold_txn;
  v_revision int;
  v_doc      text;
  v_ids      uuid[];
  v_id       uuid;
  v_made     jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  IF btrim(coalesce(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'a correction needs a request key so that retrying it is safe';
  END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'a correction needs a reason the next reader can understand';
  END IF;

  SELECT * INTO v_seen FROM pc49.request_outcome
   WHERE actor = v_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_seen.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'REQUEST_KEY_REUSED: this request key was already used for different data';
    END IF;
    RETURN pc49.receipt_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  -- Locked first, the receipt and its lines, so two people correcting the same
  -- receipt cannot both win: the second waits, then finds the revision moved.
  SELECT * INTO v_receipt FROM pc49.gold_receipt WHERE id = p_original FOR UPDATE;
  IF FOUND THEN
    v_revision := v_receipt.revision;
    v_doc := v_receipt.doc_no;
  ELSE
    SELECT * INTO v_lone FROM pc49.gold_txn
     WHERE id = p_original AND receipt_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'there is no such transaction'; END IF;
    v_revision := v_lone.revision;
    v_doc := v_lone.doc_no;
  END IF;
  PERFORM 1 FROM pc49.gold_txn t WHERE t.receipt_id = p_original FOR UPDATE;

  IF v_revision <> p_expected_revision THEN
    RAISE EXCEPTION 'CONFLICT: somebody else changed this transaction; look again before correcting it';
  END IF;

  SELECT array_agg(l.txn_id ORDER BY l.line_no) INTO v_ids
    FROM pc49.receipt_live_lines(p_original) l;
  IF v_receipt.voided_at IS NOT NULL OR v_ids IS NULL THEN
    RAISE EXCEPTION 'RECEIPT_VOIDED: this receipt has already been cancelled';
  END IF;

  PERFORM pc49.refuse_blocked_lines(p_original);

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pc49.void_gold_txn(v_id, p_reason, p_reversal_date);
  END LOOP;
  IF v_receipt.id IS NOT NULL THEN
    UPDATE pc49.gold_receipt
       SET voided_at = now(), void_reason = p_reason, updated_by = v_actor
     WHERE id = p_original;
  END IF;

  v_made := pc49.write_gold_receipt(p_payload, v_doc, v_receipt.id,
                                    CASE WHEN v_receipt.id IS NULL THEN p_original END);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'correct_gold_receipt', v_hash,
          (v_made ->> 'firstTxnId')::uuid);

  RETURN jsonb_build_object('receiptId', v_made -> 'receiptId', 'docNo', v_made -> 'docNo',
                            'repeated', false, 'replaced', p_original);
END $$;

CREATE OR REPLACE FUNCTION pc49.void_gold_receipt(
  p_original uuid,
  p_reason   text,
  p_on_date  date DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_receipt pc49.gold_receipt;
  v_ids     uuid[];
  v_id      uuid;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'voiding a transaction needs a reason';
  END IF;

  SELECT * INTO v_receipt FROM pc49.gold_receipt WHERE id = p_original FOR UPDATE;
  PERFORM 1 FROM pc49.gold_txn t
   WHERE t.receipt_id = p_original OR (t.id = p_original AND t.receipt_id IS NULL)
     FOR UPDATE;

  SELECT array_agg(l.txn_id ORDER BY l.line_no) INTO v_ids
    FROM pc49.receipt_live_lines(p_original) l;
  IF v_ids IS NULL THEN
    IF v_receipt.id IS NULL
       AND NOT EXISTS (SELECT 1 FROM pc49.gold_txn WHERE id = p_original) THEN
      RAISE EXCEPTION 'there is no such transaction';
    END IF;
    RAISE EXCEPTION 'RECEIPT_VOIDED: this receipt has already been cancelled';
  END IF;

  PERFORM pc49.refuse_blocked_lines(p_original, ARRAY['DEPOSIT_PICKUP']);

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pc49.void_gold_txn(v_id, p_reason, p_on_date);
  END LOOP;

  IF v_receipt.id IS NOT NULL THEN
    UPDATE pc49.gold_receipt
       SET voided_at = now(), void_reason = p_reason, updated_by = auth.uid()
     WHERE id = p_original;
  END IF;

  RETURN array_length(v_ids, 1);
END $$;

GRANT EXECUTE ON FUNCTION pc49.receipt_live_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.refuse_blocked_lines(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION
  pc49.correct_gold_receipt(text, uuid, int, text, jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.void_gold_receipt(uuid, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0075_a_receipt_is_corrected_whole')
ON CONFLICT (version) DO NOTHING;
