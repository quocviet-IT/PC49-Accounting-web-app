-- 0078_a_conversion_is_saved_whole.sql
-- Saving a conversion: gold out, gold in, weighed, numbered and posted in one call.
--
--   conversion_line_grams   a line's weight in grams, by its unit
--   write_gold_conversion   the body: checks, the conversion row, its legs, the
--                           posting, and completion so 0014's trigger weighs it
--   conversion_answer       what a repeated request is answered with
--   save_gold_conversion    the request key around the body (0054)
--
-- Refusals start with a code the screen translates:
--
--   CONVERSION_KIND         a kind this screen does not write
--   CONVERSION_SIDES        a side with no lines, or more than 30
--   CONVERSION_QTY          a line with no quantity: "out 2", "in 1"
--   CONVERSION_RA_RP        Ra RP with anything but Grain out and Rong Phung in
--   CONVERSION_UNBALANCED   grams out and in further apart than
--                           CONVERSION_WEIGHT_TOLERANCE_PCT allows, with no
--                           reason given; carries both weights, the percent and
--                           the tolerance so the screen can say them
--
-- Legs carry no money and no price, as the 81 loaded legs do, and post as
-- weight only (0015). A leg's sign comes from its side, never from what was typed.

CREATE OR REPLACE FUNCTION pc49.conversion_line_grams(p_line jsonb)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT abs((p_line ->> 'qty')::numeric) * f.gram_per_unit
    FROM pc49.uom_factor f
   WHERE f.uom = (p_line ->> 'uom')::pc49.uom
$$;

CREATE OR REPLACE FUNCTION pc49.write_gold_conversion(
  p_payload  jsonb,
  p_doc_no   text DEFAULT NULL,
  p_corrects uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_kind   text := p_payload ->> 'kind';
  v_date   date := (p_payload ->> 'convDate')::date;
  v_out    jsonb := coalesce(p_payload -> 'out', '[]'::jsonb);
  v_in     jsonb := coalesce(p_payload -> 'in', '[]'::jsonb);
  v_no     int;
  v_ni     int;
  v_out_g  numeric;
  v_in_g   numeric;
  v_pct    numeric;
  v_tol    numeric;
  v_doc    text;
  v_conv   uuid;
  v_line   jsonb;
  v_txn    uuid;
  v_first  uuid;
  v_i      int;
BEGIN
  IF v_kind IS NULL OR v_kind NOT IN ('TRANSFER', 'RA_RP') THEN
    RAISE EXCEPTION 'CONVERSION_KIND: a conversion entered here is TRANSFER or RA_RP, not %', v_kind;
  END IF;
  IF jsonb_typeof(v_out) <> 'array' OR jsonb_typeof(v_in) <> 'array' THEN
    RAISE EXCEPTION 'CONVERSION_SIDES: a conversion has lines out and lines in';
  END IF;
  v_no := jsonb_array_length(v_out);
  v_ni := jsonb_array_length(v_in);
  IF v_no < 1 OR v_ni < 1 OR v_no > 30 OR v_ni > 30 THEN
    RAISE EXCEPTION 'CONVERSION_SIDES: each side holds 1 to 30 lines; this one has % out and % in', v_no, v_ni;
  END IF;
  FOR v_i IN 1..v_no LOOP
    IF coalesce(nullif(v_out -> (v_i - 1) ->> 'qty', '')::numeric, 0) = 0 THEN
      RAISE EXCEPTION 'CONVERSION_QTY: out % has no quantity', v_i;
    END IF;
  END LOOP;
  FOR v_i IN 1..v_ni LOOP
    IF coalesce(nullif(v_in -> (v_i - 1) ->> 'qty', '')::numeric, 0) = 0 THEN
      RAISE EXCEPTION 'CONVERSION_QTY: in % has no quantity', v_i;
    END IF;
  END LOOP;
  IF v_kind = 'RA_RP'
     AND (EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) l WHERE l ->> 'goldTypeCode' <> 'GRAIN')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_in) l WHERE l ->> 'goldTypeCode' <> 'RP')) THEN
    RAISE EXCEPTION 'CONVERSION_RA_RP: Ra RP turns Grain into Rong Phung and nothing else';
  END IF;

  SELECT coalesce(sum(pc49.conversion_line_grams(l)), 0) INTO v_out_g
    FROM jsonb_array_elements(v_out) l;
  SELECT coalesce(sum(pc49.conversion_line_grams(l)), 0) INTO v_in_g
    FROM jsonb_array_elements(v_in) l;
  SELECT value INTO v_tol FROM pc49.system_param WHERE key = 'CONVERSION_WEIGHT_TOLERANCE_PCT';
  v_pct := abs(v_in_g - v_out_g) / v_out_g * 100;
  IF v_pct > coalesce(v_tol, 0)
     AND btrim(coalesce(p_payload ->> 'varianceReason', '')) = '' THEN
    RAISE EXCEPTION 'CONVERSION_UNBALANCED: out % in % pct % tolerance %',
      round(v_out_g, 4), round(v_in_g, 4), round(v_pct, 4), v_tol;
  END IF;

  -- A correction keeps the number of what it corrects (0057).
  v_doc := coalesce(nullif(btrim(p_doc_no), ''), pc49.next_doc_no(v_date));

  INSERT INTO pc49.gold_conversion
    (conv_date, kind, note, doc_no, partner_code, variance_reason,
     corrects_conversion_id, created_by, updated_by)
  VALUES (v_date, v_kind::pc49.conversion_kind,
          nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
          v_doc,
          nullif(btrim(coalesce(p_payload ->> 'partnerCode', '')), ''),
          nullif(btrim(coalesce(p_payload ->> 'varianceReason', '')), ''),
          p_corrects, v_actor, v_actor)
  RETURNING id INTO v_conv;

  FOR v_i IN 1..v_no LOOP
    v_line := v_out -> (v_i - 1);
    INSERT INTO pc49.gold_txn
      (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code, remarks,
       conversion_id, doc_no, line_no, created_by)
    VALUES (v_date,
            (CASE WHEN v_kind = 'RA_RP' THEN 'RA_RP' ELSE 'TRANSFER_OUT' END)::pc49.txn_type,
            v_line ->> 'goldTypeCode', (v_line ->> 'uom')::pc49.uom,
            -abs((v_line ->> 'qty')::numeric), 0,
            nullif(btrim(coalesce(p_payload ->> 'partnerCode', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
            v_conv, v_doc, v_i, v_actor)
    RETURNING id INTO v_txn;
    PERFORM pc49.post_gold_txn(v_txn);
    IF v_i = 1 THEN v_first := v_txn; END IF;
  END LOOP;

  FOR v_i IN 1..v_ni LOOP
    v_line := v_in -> (v_i - 1);
    INSERT INTO pc49.gold_txn
      (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code, remarks,
       conversion_id, doc_no, line_no, created_by)
    VALUES (v_date,
            (CASE WHEN v_kind = 'RA_RP' THEN 'RA_RP' ELSE 'TRANSFER_IN' END)::pc49.txn_type,
            v_line ->> 'goldTypeCode', (v_line ->> 'uom')::pc49.uom,
            abs((v_line ->> 'qty')::numeric), 0,
            nullif(btrim(coalesce(p_payload ->> 'partnerCode', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
            v_conv, v_doc, v_i, v_actor)
    RETURNING id INTO v_txn;
    PERFORM pc49.post_gold_txn(v_txn);
  END LOOP;

  -- Completed once every leg is in, which is when 0014's trigger weighs it and
  -- writes variance_note if the two sides are further apart than the tolerance.
  UPDATE pc49.gold_conversion SET completed_at = now(), updated_by = v_actor WHERE id = v_conv;

  RETURN jsonb_build_object('conversionId', v_conv, 'docNo', v_doc, 'firstTxnId', v_first);
END $$;

/** What a repeated request is answered with: the conversion its first leg belongs to. */
CREATE OR REPLACE FUNCTION pc49.conversion_answer(p_first_txn uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('conversionId', t.conversion_id, 'docNo', t.doc_no)
    FROM pc49.gold_txn t WHERE t.id = p_first_txn
$$;

CREATE OR REPLACE FUNCTION pc49.save_gold_conversion(
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
    RETURN pc49.conversion_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  v_made := pc49.write_gold_conversion(p_payload);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_conversion', v_hash,
          (v_made ->> 'firstTxnId')::uuid);

  RETURN jsonb_build_object('conversionId', v_made -> 'conversionId', 'docNo', v_made -> 'docNo',
                            'repeated', false);
END $$;

GRANT EXECUTE ON FUNCTION pc49.conversion_line_grams(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.write_gold_conversion(jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.conversion_answer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.save_gold_conversion(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0078_a_conversion_is_saved_whole')
ON CONFLICT (version) DO NOTHING;
