-- 0079_a_conversion_is_corrected_whole.sql
-- Correcting and cancelling a conversion, every leg at once.
--
--   refuse_blocked_conversion_legs   stops at the first leg something else
--                                    points at, naming it "out 2" or "in 1".
--                                    CONVERSION_LEG is not such a thing: it is
--                                    the reason a single leg is corrected here,
--                                    as part of its conversion.
--   correct_gold_conversion          reverses every leg and writes the corrected
--                                    conversion in one transaction, keeping its
--                                    number; a loaded conversion has none of its
--                                    own and keeps the smallest its legs carry,
--                                    which is the one the ledger shows
--   void_gold_conversion             reverses every leg
--
-- A refining lot's conversion (REFINING_SEND, REFINING_RECEIVE) belongs to the
-- refining screen: CONVERSION_REFINING. One already cancelled: CONVERSION_VOIDED.

CREATE OR REPLACE FUNCTION pc49.refuse_blocked_conversion_legs(p_conv uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_leg  record;
  v_code text;
BEGIN
  FOR v_leg IN
    SELECT x.id, x.side, x.n
      FROM (SELECT t.id,
                   CASE WHEN t.qty < 0 THEN 'out' ELSE 'in' END AS side,
                   row_number() OVER (PARTITION BY t.qty < 0
                                      ORDER BY coalesce(t.line_no, 1), t.created_at, t.id) AS n
              FROM pc49.gold_txn t
             WHERE t.conversion_id = p_conv AND t.voided_at IS NULL) x
     ORDER BY x.side DESC, x.n
  LOOP
    v_code := pc49.correction_blocked_code(v_leg.id);
    IF v_code IS NOT NULL AND v_code <> 'CONVERSION_LEG' THEN
      RAISE EXCEPTION 'LINE_BLOCKED: % % % cannot be changed here', v_leg.side, v_leg.n, v_code;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION pc49.correct_gold_conversion(
  p_request_key       text,
  p_original          uuid,
  p_expected_revision int,
  p_reason            text,
  p_payload           jsonb,
  p_reversal_date     date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hash  text := md5(p_payload::text);
  v_seen  pc49.request_outcome;
  v_conv  pc49.gold_conversion;
  v_ids   uuid[];
  v_id    uuid;
  v_doc   text;
  v_made  jsonb;
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
    RETURN pc49.conversion_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  -- Locked first, the conversion and its legs, so two people correcting it
  -- cannot both win: the second waits, then finds the revision has moved.
  SELECT * INTO v_conv FROM pc49.gold_conversion WHERE id = p_original FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'there is no such conversion'; END IF;
  PERFORM 1 FROM pc49.gold_txn t WHERE t.conversion_id = p_original FOR UPDATE;

  IF v_conv.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'CONFLICT: somebody else changed this conversion; look again before correcting it';
  END IF;
  IF v_conv.kind IN ('REFINING_SEND', 'REFINING_RECEIVE') THEN
    RAISE EXCEPTION 'CONVERSION_REFINING: this conversion belongs to a refining lot; correct it on the refining screen';
  END IF;

  SELECT array_agg(t.id ORDER BY t.created_at, t.id) INTO v_ids
    FROM pc49.gold_txn t WHERE t.conversion_id = p_original AND t.voided_at IS NULL;
  IF v_conv.voided_at IS NOT NULL OR v_ids IS NULL THEN
    RAISE EXCEPTION 'CONVERSION_VOIDED: this conversion has already been cancelled';
  END IF;

  PERFORM pc49.refuse_blocked_conversion_legs(p_original);

  v_doc := coalesce(v_conv.doc_no,
                    (SELECT min(t.doc_no) FROM pc49.gold_txn t WHERE t.conversion_id = p_original));

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pc49.void_gold_txn(v_id, p_reason, p_reversal_date);
  END LOOP;
  UPDATE pc49.gold_conversion
     SET voided_at = now(), void_reason = p_reason, updated_by = v_actor
   WHERE id = p_original;

  v_made := pc49.write_gold_conversion(p_payload, v_doc, p_original);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'correct_gold_conversion', v_hash,
          (v_made ->> 'firstTxnId')::uuid);

  RETURN jsonb_build_object('conversionId', v_made -> 'conversionId', 'docNo', v_made -> 'docNo',
                            'repeated', false, 'replaced', p_original);
END $$;

CREATE OR REPLACE FUNCTION pc49.void_gold_conversion(
  p_original uuid,
  p_reason   text,
  p_on_date  date DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_conv pc49.gold_conversion;
  v_ids  uuid[];
  v_id   uuid;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'voiding a transaction needs a reason';
  END IF;

  SELECT * INTO v_conv FROM pc49.gold_conversion WHERE id = p_original FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'there is no such conversion'; END IF;
  IF v_conv.kind IN ('REFINING_SEND', 'REFINING_RECEIVE') THEN
    RAISE EXCEPTION 'CONVERSION_REFINING: this conversion belongs to a refining lot; correct it on the refining screen';
  END IF;
  PERFORM 1 FROM pc49.gold_txn t WHERE t.conversion_id = p_original FOR UPDATE;

  SELECT array_agg(t.id ORDER BY t.created_at, t.id) INTO v_ids
    FROM pc49.gold_txn t WHERE t.conversion_id = p_original AND t.voided_at IS NULL;
  IF v_conv.voided_at IS NOT NULL OR v_ids IS NULL THEN
    RAISE EXCEPTION 'CONVERSION_VOIDED: this conversion has already been cancelled';
  END IF;

  PERFORM pc49.refuse_blocked_conversion_legs(p_original);

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pc49.void_gold_txn(v_id, p_reason, p_on_date);
  END LOOP;
  UPDATE pc49.gold_conversion
     SET voided_at = now(), void_reason = p_reason, updated_by = auth.uid()
   WHERE id = p_original;

  RETURN array_length(v_ids, 1);
END $$;

GRANT EXECUTE ON FUNCTION pc49.refuse_blocked_conversion_legs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION
  pc49.correct_gold_conversion(text, uuid, int, text, jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.void_gold_conversion(uuid, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0079_a_conversion_is_corrected_whole')
ON CONFLICT (version) DO NOTHING;
