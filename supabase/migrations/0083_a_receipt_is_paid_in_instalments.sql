-- 0083_a_receipt_is_paid_in_instalments.sql
-- What is still owed on a receipt is paid later, a payment at a time.
--
--   "Thực tế vẫn sẽ có đơn thanh toán 1 phần, còn nợ lại khách đợt sau thanh
--    toán tiếp" (entry screen, 17-09-2026)
--
-- A payment made later is not a change to the receipt. The receipt says what
-- was bought or sold and what was handed over at the counter that day; a later
-- payment happens on its own day, in its own period, and is booked there. So it
-- is a row of its own, beside the receipt, and posts its own entry:
--
--   a purchase   331 against the money paid out   (0082 put the debt there)
--   a sale       the money taken against 131      (0015 always has)
--
--   gold_receipt_settlement    the payments made after the receipt
--   settlement_side            which side of the books a receipt settles
--   gold_receipt_owed          what is still owed on a receipt
--   gold_receipt_settlements   its later payments, for the ledger
--   save_receipt_settlement    records and posts one, safely retried
--   void_receipt_settlement    reverses one
--
-- A receipt is found by the ledger's key: gold_receipt.id, or the id of a
-- transaction saved before receipts, which is a receipt of one item (0075).
--
-- The refusals begin with a code the screen translates:
--
--   SETTLEMENT_KIND         not a purchase or a sale: a deposit, a memo, a conversion
--   SETTLEMENT_AMOUNT       nothing paid
--   SETTLEMENT_DATE         paid before the receipt was written
--   SETTLEMENT_PERIOD       paid in a closed month
--   SETTLEMENT_OVER         more than is owed
--   SETTLEMENT_OLD_POSTING  a purchase posted before 0082, short and with nothing
--                           against 331: paying it would put 331 below nothing.
--                           Correcting the receipt once posts it again, properly.
--   SETTLEMENT_VOIDED       cancelling a payment twice
--   RECEIPT_HAS_SETTLEMENTS cancelling a receipt later payments still stand on,
--                           or correcting it from a purchase into a sale
--
-- Correcting a receipt takes its later payments along to the replacement: they
-- were paid on the purchase, not on the version of it that had a typing error.

CREATE TABLE IF NOT EXISTS pc49.gold_receipt_settlement (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The ledger's key, which is either of two tables' ids, so it is not a
  -- foreign key. save_receipt_settlement checks it names a live receipt.
  receipt_key        uuid NOT NULL,
  pay_date           date NOT NULL,
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),
  method             pc49.payment_method NOT NULL,
  note               text CHECK (note IS NULL OR length(note) <= 500),
  journal_entry_id   uuid REFERENCES pc49.journal_entry (id),
  voided_at          timestamptz,
  void_reason        text,
  reversal_entry_id  uuid REFERENCES pc49.journal_entry (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  CONSTRAINT gold_receipt_settlement_void_needs_reason CHECK (
    voided_at IS NULL OR btrim(coalesce(void_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS gold_receipt_settlement_key_idx
  ON pc49.gold_receipt_settlement (receipt_key);

DROP TRIGGER IF EXISTS audit_gold_receipt_settlement ON pc49.gold_receipt_settlement;
CREATE TRIGGER audit_gold_receipt_settlement
  AFTER INSERT OR UPDATE OR DELETE ON pc49.gold_receipt_settlement
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

-- Read by anyone signed in, written by accounting: a receipt's rule (0073).
ALTER TABLE pc49.gold_receipt_settlement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gold_receipt_settlement_read ON pc49.gold_receipt_settlement;
CREATE POLICY gold_receipt_settlement_read ON pc49.gold_receipt_settlement
  FOR SELECT USING ((SELECT pc49.effective_role()) IS NOT NULL);

DROP POLICY IF EXISTS gold_receipt_settlement_write ON pc49.gold_receipt_settlement;
CREATE POLICY gold_receipt_settlement_write ON pc49.gold_receipt_settlement
  FOR ALL USING ((SELECT pc49.effective_role()) IN ('KT', 'ADMIN'))
  WITH CHECK ((SELECT pc49.effective_role()) IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.gold_receipt_settlement TO authenticated;

/** AP for a purchase, AR for a sale, null for anything nothing is owed on. */
CREATE OR REPLACE FUNCTION pc49.settlement_side(p_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_type IN ('PO', 'PO_VENDOR') THEN 'AP'
              WHEN p_type IN ('SALE', 'PICKUP') THEN 'AR' END
$$;

/**
 * What is still owed on a receipt: what its live items come to, less what was
 * paid at the counter and every later payment still standing. Never below
 * nothing — paying over is recorded as it happened, not as a debt the other
 * way. Nothing is owed on a cancelled receipt, a conversion, or a kind of
 * receipt nothing is paid on.
 */
CREATE OR REPLACE FUNCTION pc49.gold_receipt_owed(p_key uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH lines AS (
    SELECT t.id, t.txn_type::text AS txn_type, t.amount, t.conversion_id
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
      - coalesce((SELECT sum(s.amount) FROM pc49.gold_receipt_settlement s
                   WHERE s.receipt_key = p_key AND s.voided_at IS NULL), 0), 2), 0)
  END
$$;

/** A receipt's later payments still standing, in the order they were made. */
CREATE OR REPLACE FUNCTION pc49.gold_receipt_settlements(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'payDate', s.pay_date, 'amount', s.amount,
           'method', s.method, 'note', s.note)
         ORDER BY s.pay_date, s.created_at, s.id), '[]'::jsonb)
    FROM pc49.gold_receipt_settlement s
   WHERE s.receipt_key = p_key AND s.voided_at IS NULL
$$;

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

  v_side := pc49.settlement_side(v_first.txn_type::text);
  IF v_side IS NULL OR v_first.conversion_id IS NOT NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_KIND: only a purchase or a sale is paid later, not a %',
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

  v_owed := pc49.gold_receipt_owed(p_receipt_key);
  IF v_amount > v_owed THEN
    RAISE EXCEPTION 'SETTLEMENT_OVER: owed % paid %', v_owed, v_amount;
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
          'Later payment ' || coalesce(v_doc, '') || coalesce(' · ' || v_note, ''))
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

CREATE OR REPLACE FUNCTION pc49.void_receipt_settlement(
  p_id      uuid,
  p_reason  text,
  -- Where the reversal is dated: the payment's own day unless said otherwise,
  -- which is right for a payment typed in error.
  p_on_date date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  s          pc49.gold_receipt_settlement;
  v_reversal uuid;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'cancelling a payment needs a reason';
  END IF;

  SELECT * INTO s FROM pc49.gold_receipt_settlement WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'there is no such payment'; END IF;
  IF s.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_VOIDED: this payment has already been cancelled';
  END IF;

  IF s.journal_entry_id IS NOT NULL THEN
    -- reverse_entry refuses a closed month itself.
    v_reversal := pc49.reverse_entry(s.journal_entry_id, coalesce(p_on_date, s.pay_date));
  END IF;

  UPDATE pc49.gold_receipt_settlement
     SET voided_at = now(), void_reason = p_reason, reversal_entry_id = v_reversal,
         updated_at = now(), updated_by = auth.uid()
   WHERE id = p_id;

  RETURN v_reversal;
END $$;

-- 0075's bodies. A receipt later payments stand on is not cancelled until they
-- are; a correction takes them along, and may not turn a purchase into a sale.
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
  v_later    int;
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

  -- A later payment settled one side of the books; the replacement must owe on
  -- the same side for it to still mean anything.
  SELECT count(*) INTO v_later FROM pc49.gold_receipt_settlement
   WHERE receipt_key = p_original AND voided_at IS NULL;
  IF v_later > 0
     AND pc49.settlement_side(p_payload ->> 'txnType') IS DISTINCT FROM pc49.settlement_side(
           (SELECT t.txn_type::text FROM pc49.gold_txn t WHERE t.id = v_ids[1])) THEN
    RAISE EXCEPTION 'RECEIPT_HAS_SETTLEMENTS: % later payment(s) stand on this receipt; a purchase cannot become a sale while they do',
      v_later;
  END IF;

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

  -- What was paid later was paid on this purchase, whichever version of it.
  UPDATE pc49.gold_receipt_settlement
     SET receipt_key = (v_made ->> 'receiptId')::uuid, updated_at = now(), updated_by = v_actor
   WHERE receipt_key = p_original;

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
  v_later   int;
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

  -- Money paid later against a receipt that never happened would be money
  -- paid against nothing.
  SELECT count(*) INTO v_later FROM pc49.gold_receipt_settlement
   WHERE receipt_key = p_original AND voided_at IS NULL;
  IF v_later > 0 THEN
    RAISE EXCEPTION 'RECEIPT_HAS_SETTLEMENTS: % later payment(s) stand on this receipt; cancel them first',
      v_later;
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

GRANT EXECUTE ON FUNCTION pc49.settlement_side(text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_owed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_settlements(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.save_receipt_settlement(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.void_receipt_settlement(uuid, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0083_a_receipt_is_paid_in_instalments')
ON CONFLICT (version) DO NOTHING;
