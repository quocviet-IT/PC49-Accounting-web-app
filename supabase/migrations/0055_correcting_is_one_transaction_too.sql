-- 0055_correcting_is_one_transaction_too.sql
-- Correcting a posted transaction without ever leaving the books half-undone.
--
-- PC49-01 in the interface handoff of 05-09-2026. Pressing Sửa asked for a
-- reason and immediately called `void_gold_txn`, which reverses the journal
-- entry and gives the stock back. Only then did a draft row appear on screen,
-- holding the old values, waiting to be typed and saved.
--
-- Everything between those two moments is a hole. Close the tab, lose the
-- connection, change your mind, fail validation on the replacement — the
-- original is reversed and nothing has taken its place. The comment in the
-- component said the draft was opened first; the code did the opposite.
--
-- So opening a correction now writes nothing at all. The screen holds a draft,
-- the original stays live and posted, and only on confirmation does one
-- database function reverse the old row and write and post the new one — in
-- one transaction, whole or not at all.

-- ---- Knowing the row has not moved under you ----------------------------------
--
-- The handoff is explicit that `updated_at` may only be used as a concurrency
-- token once every writer maintains it. Only `void_gold_txn` does, so it
-- cannot be trusted; this is the revision column it asks for instead, and a
-- trigger keeps it true whether a writer remembers it or not.

ALTER TABLE pc49.gold_txn
  ADD COLUMN IF NOT EXISTS revision int NOT NULL DEFAULT 1;

ALTER TABLE pc49.gold_txn
  ADD COLUMN IF NOT EXISTS corrects_txn_id uuid REFERENCES pc49.gold_txn (id);

COMMENT ON COLUMN pc49.gold_txn.corrects_txn_id IS
  'The transaction this one replaces. Set only by correct_gold_transaction.';

CREATE OR REPLACE FUNCTION pc49.gold_txn_bump_revision()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_txn_revision ON pc49.gold_txn;
CREATE TRIGGER gold_txn_revision
  BEFORE UPDATE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_bump_revision();

-- ---- Auditing what happens to a transaction -----------------------------------
--
-- 0011 says what the log is for and who may write it: "readable by an
-- administrator, writable by nobody. Only the SECURITY DEFINER trigger
-- inserts." Journal entries, journal lines and accounting periods were given
-- that trigger and gold transactions never were, so the row that starts it all
-- was the one change with no record of who made it.
--
-- Correcting needs that record — which transaction replaced which, and on
-- whose say-so — and the honest way to get it is the mechanism already there,
-- not an insert from a function that would have to be granted the right to
-- write a log nobody is supposed to be able to write.

DROP TRIGGER IF EXISTS audit_gold_txn ON pc49.gold_txn;
CREATE TRIGGER audit_gold_txn
  AFTER INSERT OR UPDATE OR DELETE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

-- ---- What must not be corrected this way --------------------------------------

/**
 * Why this transaction cannot be corrected, or null if it can.
 *
 * A gold transaction can be the far end of somebody else's record: a deposit
 * that a pickup points at, a leg of a conversion, the receipt of a refining
 * lot, the gold side of a cash movement, or scrap already picked into a lot on
 * its way to the refinery. Reversing one of those and writing a fresh row
 * leaves the other record pointing at something that has been cancelled.
 *
 * The screen does not carry those relations, so it cannot judge this. It asks,
 * and shows the sentence it gets back — which is better than a disabled button
 * with no reason, and far better than a correction that quietly breaks a
 * refining lot.
 */
CREATE OR REPLACE FUNCTION pc49.correction_blocked_reason(p_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  t pc49.gold_txn;
BEGIN
  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'there is no such transaction'; END IF;
  IF t.voided_at IS NOT NULL THEN RETURN 'this transaction has already been cancelled'; END IF;

  IF t.conversion_id IS NOT NULL THEN
    RETURN 'this is one leg of a conversion; correct the conversion instead';
  END IF;
  IF t.deposit_ref_id IS NOT NULL THEN
    RETURN 'this is the pickup for a deposit; the two are corrected together';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.gold_txn p WHERE p.deposit_ref_id = p_id
              AND p.voided_at IS NULL) THEN
    RETURN 'a pickup has already been recorded against this deposit';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_receipt r WHERE r.gold_txn_id = p_id) THEN
    RETURN 'this row came back from a refining lot';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_lot_source s WHERE s.txn_id = p_id) THEN
    RETURN 'this purchase has been picked into a refining lot';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.cash_txn c WHERE c.gold_txn_id = p_id) THEN
    RETURN 'this is tied to a cash movement';
  END IF;

  RETURN NULL;
END $$;

GRANT EXECUTE ON FUNCTION pc49.correction_blocked_reason(uuid) TO authenticated;

/**
 * The same answer for a whole day at once.
 *
 * So the screen can grey out Sửa and say why, instead of offering a button
 * that turns out to be refused. Filtered by date by the caller, because
 * evaluating this over every transaction ever recorded to draw one day would
 * be a strange way to spend an afternoon.
 */
CREATE OR REPLACE VIEW pc49.v_gold_txn_correctable AS
  SELECT id, txn_date, revision,
         pc49.correction_blocked_reason(id) AS blocked_reason
    FROM pc49.gold_txn
   WHERE voided_at IS NULL;

GRANT SELECT ON pc49.v_gold_txn_correctable TO authenticated;

-- ---- Writing a transaction, shared by saving and correcting --------------------

/**
 * The body of a save, without the request key or the retry check.
 *
 * Pulled out so that a correction writes its replacement through exactly the
 * same code a fresh save does. Two implementations of "what a transaction is"
 * would drift, and the one used less often would drift unnoticed.
 */
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
     partner_code, scrap_detail, gold_pct, remarks, created_by, corrects_txn_id)
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
    v_actor, p_corrects)
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

GRANT EXECUTE ON FUNCTION pc49.write_gold_transaction(jsonb, uuid) TO authenticated;

-- Saving now goes through the shared body, so the two can never disagree about
-- what a transaction is.
CREATE OR REPLACE FUNCTION pc49.save_gold_transaction(
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
    RETURN jsonb_build_object('txnId', v_seen.txn_id, 'repeated', true);
  END IF;

  v_made := pc49.write_gold_transaction(p_payload, NULL);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_transaction', v_hash,
          (v_made ->> 'txnId')::uuid);

  RETURN v_made || jsonb_build_object('repeated', false);
END $$;

-- ---- Correcting ----------------------------------------------------------------

/**
 * Reverses one transaction and puts its replacement in the same breath.
 *
 * The original is locked before anything is read from it, so two people
 * correcting the same row cannot both win: the second waits, then finds the
 * revision has moved and is told to look again rather than overwriting work it
 * never saw.
 *
 * Order inside matters less than the boundary around it. The reversal and the
 * replacement are in one transaction, so no state where one exists without the
 * other is ever visible outside this function — which is the whole of the
 * fault being fixed.
 */
CREATE OR REPLACE FUNCTION pc49.correct_gold_transaction(
  p_request_key       text,
  p_original_id       uuid,
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
  v_original pc49.gold_txn;
  v_blocked  text;
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
    RETURN jsonb_build_object('txnId', v_seen.txn_id, 'repeated', true);
  END IF;

  -- Locked first. Everything read after this is read from a row nobody else
  -- can move until this transaction ends.
  SELECT * INTO v_original FROM pc49.gold_txn WHERE id = p_original_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'there is no such transaction'; END IF;

  IF v_original.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'CONFLICT: somebody else changed this transaction; look again before correcting it';
  END IF;

  v_blocked := pc49.correction_blocked_reason(p_original_id);
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'this transaction cannot be corrected here: %', v_blocked;
  END IF;

  PERFORM pc49.void_gold_txn(p_original_id, p_reason, p_reversal_date);
  v_made := pc49.write_gold_transaction(p_payload, p_original_id);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'correct_gold_transaction', v_hash,
          (v_made ->> 'txnId')::uuid);

  RETURN v_made || jsonb_build_object('repeated', false,
                                      'replacedTxnId', p_original_id);
END $$;

GRANT EXECUTE ON FUNCTION
  pc49.correct_gold_transaction(text, uuid, int, text, jsonb, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0055_correcting_is_one_transaction_too')
ON CONFLICT (version) DO NOTHING;
