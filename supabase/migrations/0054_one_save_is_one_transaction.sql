-- 0054_one_save_is_one_transaction.sql
-- Saving a gold transaction, all of it or none of it.
--
-- PC49-06 in the interface handoff of 05-09-2026, and the finding is fair.
-- `saveTransaction` grew into five separate requests: insert the transaction,
-- file the customer, insert the sales split, insert the payments, post to the
-- ledger. Each one commits on its own. A failure at the fourth leaves a
-- transaction on the books with no payments and no journal entry, the screen
-- says "could not save", and pressing the button again writes a second one.
--
-- Two of those five requests were added on 05-09-2026 for the split and the
-- customer catalogue, so this got worse before it got better.
--
-- Everything financial now happens inside one database function, which means
-- inside one transaction: it commits whole or it rolls back whole. The
-- customer's telephone number is deliberately NOT in here — see below.
--
-- SECURITY INVOKER, so row-level security still decides who may write what.
-- The function is a way to make five statements atomic, not a way around the
-- permissions on them.

-- ---- Not writing the same transaction twice ----------------------------------

/**
 * What a request already did, so that asking again does not do it twice.
 *
 * A save is three round trips over a network somebody's phone hotspot may drop
 * halfway. When the answer is lost the caller does not know whether the money
 * was recorded, and the only safe thing they can do is ask again — which,
 * without this, writes the day twice.
 *
 * The key belongs to the person as well as the request: two people cannot
 * collide, and one person retrying always meets their own earlier answer.
 */
CREATE TABLE IF NOT EXISTS pc49.request_outcome (
  actor        uuid NOT NULL,
  request_key  text NOT NULL,
  operation    text NOT NULL,
  payload_hash text NOT NULL,
  txn_id       uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor, request_key)
);

ALTER TABLE pc49.request_outcome ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS request_outcome_own ON pc49.request_outcome;
CREATE POLICY request_outcome_own ON pc49.request_outcome
  FOR ALL USING (actor = auth.uid())
  WITH CHECK (actor = auth.uid());

GRANT SELECT, INSERT ON pc49.request_outcome TO authenticated;

-- ---- Saving -------------------------------------------------------------------

/**
 * Writes one gold transaction and everything that belongs to it.
 *
 * The amount is worked out here and not taken from the caller. It is the
 * number that reaches the ledger, and a screen that can choose it is a screen
 * that can be made to choose something else. Where a unit price is given the
 * amount follows from it by the sign convention the whole system rests on; the
 * caller's own figure is compared and a disagreement is refused rather than
 * quietly corrected, because a disagreement means one of the two is wrong and
 * silently picking a winner hides which.
 *
 * The payload is jsonb rather than fifteen parameters. Fifteen parameters is
 * fifteen chances to pass them in the wrong order, and the hash below needs
 * one canonical value anyway.
 */
CREATE OR REPLACE FUNCTION pc49.save_gold_transaction(
  p_request_key text,
  p_payload     jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_hash     text := md5(p_payload::text);
  v_seen     pc49.request_outcome;
  v_txn_id   uuid;
  v_qty      numeric := (p_payload ->> 'qty')::numeric;
  v_price    numeric := nullif(p_payload ->> 'unitPrice', '')::numeric;
  v_amount   numeric;
  v_claimed  numeric := nullif(p_payload ->> 'amount', '')::numeric;
  v_pay      jsonb := coalesce(p_payload -> 'payments', '[]'::jsonb);
  v_who      jsonb := coalesce(p_payload -> 'salesPeople', '[]'::jsonb);
  v_shares   numeric;
  v_entry    uuid;
  v_line     jsonb;
  v_seq      int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'nobody is signed in';
  END IF;
  IF btrim(coalesce(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'a save needs a request key so that retrying it is safe';
  END IF;

  -- Already done? Then this is a retry of an answer that was lost on its way
  -- back, and the honest reply is the one from last time.
  SELECT * INTO v_seen FROM pc49.request_outcome
   WHERE actor = v_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_seen.payload_hash <> v_hash THEN
      -- The same key with different contents is not a retry, it is a bug or a
      -- reused key. Doing either thing silently would be wrong.
      RAISE EXCEPTION 'REQUEST_KEY_REUSED: this request key was already used for different data';
    END IF;
    RETURN jsonb_build_object('txnId', v_seen.txn_id, 'repeated', true);
  END IF;

  -- The amount the books will carry.
  IF v_price IS NOT NULL THEN
    v_amount := round(-v_qty * v_price, 2);
    IF v_claimed IS NOT NULL AND abs(v_claimed - v_amount) > 0.005 THEN
      RAISE EXCEPTION 'the amount sent (%) is not what the quantity and price come to (%)',
        v_claimed, v_amount;
    END IF;
  ELSE
    -- No price to derive it from: rows loaded from the old workbooks carry an
    -- amount and nothing to recompute it from.
    v_amount := v_claimed;
  END IF;

  -- Everybody on the order must add up before anything is written, so that a
  -- half-shared order never exists even for the length of this function.
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
     partner_code, scrap_detail, gold_pct, remarks, created_by)
  VALUES (
    (p_payload ->> 'txnDate')::date,
    (p_payload ->> 'txnType')::pc49.txn_type,
    p_payload ->> 'goldTypeCode',
    (p_payload ->> 'uom')::pc49.uom,
    v_qty,
    v_price,
    v_amount,
    nullif(p_payload ->> 'partnerCode', ''),
    nullif(p_payload ->> 'scrapDetail', ''),
    nullif(p_payload ->> 'goldPct', '')::numeric,
    nullif(p_payload ->> 'remarks', ''),
    v_actor)
  RETURNING id INTO v_txn_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_who) LOOP
    INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct)
    VALUES (v_txn_id, v_line ->> 'code',
            coalesce((v_line ->> 'sharePct')::numeric, 100));
  END LOOP;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_pay) LOOP
    v_seq := v_seq + 1;
    INSERT INTO pc49.gold_txn_payment
      (txn_id, seq, direction, amount, method)
    VALUES (v_txn_id, v_seq,
            CASE WHEN v_amount >= 0 THEN 'AR' ELSE 'AP' END::pc49.payment_direction,
            (v_line ->> 'amount')::numeric,
            (v_line ->> 'method')::pc49.payment_method);
  END LOOP;

  v_entry := pc49.post_gold_txn(v_txn_id);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_transaction', v_hash, v_txn_id);

  RETURN jsonb_build_object('txnId', v_txn_id, 'entryId', v_entry,
                            'amount', v_amount, 'repeated', false);
END $$;

GRANT EXECUTE ON FUNCTION pc49.save_gold_transaction(text, jsonb) TO authenticated;

-- The customer's telephone number is not in here on purpose.
--
-- It is contact information, not money. Putting it inside this transaction
-- would mean a failure to file a phone number throws away a purchase that is
-- otherwise perfectly good — and the handoff says so plainly: do not report
-- "save failed" after the financial part has succeeded. It stays a separate
-- step whose failure is reported as a warning beside a saved row.

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0054_one_save_is_one_transaction')
ON CONFLICT (version) DO NOTHING;
