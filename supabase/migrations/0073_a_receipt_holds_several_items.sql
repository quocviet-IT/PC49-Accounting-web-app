-- 0073_a_receipt_holds_several_items.sql
-- One paper receipt, several items on it.
--
-- From the counter on 17-09, with a photo of the receipt: a customer sold six
-- pieces at once (24K scrap, a Royal Canadian Mint bar, a Suisse coin, a 14K
-- pendant) and the screen made them type six transactions, six numbers, the
-- customer six times and the payment six times.
--
-- A transaction keeps meaning one gold type. What is added is the receipt that
-- holds them: one number, one date, one direction, one customer. The lines
-- beneath it are ordinary gold_txn rows, so posting, stock, reports and the
-- import loader are untouched. A row written by anything that does not know
-- about receipts (the loader, a refining lot, a conversion) has no receipt_id,
-- and is read everywhere as a receipt of one line: coalesce(receipt_id, id).
--
--   gold_receipt                  the receipt
--   gold_txn.receipt_id, line_no, item_desc
--   write_gold_transaction        also writes docNo, receiptId, lineNo, itemDesc
--   allocate_receipt_payments     what the customer paid, divided between the lines

CREATE TABLE IF NOT EXISTS pc49.gold_receipt (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no               text NOT NULL,
  txn_date             date NOT NULL,
  txn_type             pc49.txn_type NOT NULL,
  partner_code         text,
  remarks              text,
  revision             int NOT NULL DEFAULT 1,
  voided_at            timestamptz,
  void_reason          text,
  corrects_receipt_id  uuid REFERENCES pc49.gold_receipt (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid,
  CONSTRAINT gold_receipt_void_needs_reason CHECK (
    voided_at IS NULL OR btrim(coalesce(void_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS gold_receipt_date_idx ON pc49.gold_receipt (txn_date);

ALTER TABLE pc49.gold_txn
  ADD COLUMN IF NOT EXISTS receipt_id uuid REFERENCES pc49.gold_receipt (id),
  ADD COLUMN IF NOT EXISTS line_no    int,
  ADD COLUMN IF NOT EXISTS item_desc  text;

CREATE INDEX IF NOT EXISTS gold_txn_receipt_idx ON pc49.gold_txn (receipt_id);

-- The revision rule of a transaction (0055): any change moves it, whether the
-- writer remembers or not.
DROP TRIGGER IF EXISTS gold_receipt_revision ON pc49.gold_receipt;
CREATE TRIGGER gold_receipt_revision
  BEFORE UPDATE ON pc49.gold_receipt
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_bump_revision();

DROP TRIGGER IF EXISTS audit_gold_receipt ON pc49.gold_receipt;
CREATE TRIGGER audit_gold_receipt
  AFTER INSERT OR UPDATE OR DELETE ON pc49.gold_receipt
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

-- Read by anyone signed in, written by accounting: gold_txn's rule (0012), in
-- the once-per-query form 0070 gave every policy.
ALTER TABLE pc49.gold_receipt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gold_receipt_read ON pc49.gold_receipt;
CREATE POLICY gold_receipt_read ON pc49.gold_receipt
  FOR SELECT USING ((SELECT pc49.effective_role()) IS NOT NULL);

DROP POLICY IF EXISTS gold_receipt_write ON pc49.gold_receipt;
CREATE POLICY gold_receipt_write ON pc49.gold_receipt
  FOR ALL USING ((SELECT pc49.effective_role()) IN ('KT', 'ADMIN'))
  WITH CHECK ((SELECT pc49.effective_role()) IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.gold_receipt TO authenticated;

-- 0055's body, with the four receipt fields added to the insert. Every one is
-- optional, so a caller that knows nothing of receipts writes what it wrote.
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
     doc_no, receipt_id, line_no, item_desc)
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
    nullif(btrim(coalesce(p_payload ->> 'itemDesc', '')), ''))
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

/**
 * What the customer paid, divided between the lines of a receipt.
 *
 * The payments in the order they were typed, poured into the lines in line
 * order, each line taking up to its own amount (unsigned: a purchase stores
 * its amount negative) before the next begins. Whatever is left once the last
 * line has its share stays on the last line, and a receipt paid short leaves
 * its last lines short: both as a single transaction paid over or under is
 * recorded today. Nothing is rounded, so every method and every line adds up
 * to the cent.
 *
 *   amounts   [-950, -825, -1900, -4125, -525, -36]
 *   payments  [5000 CASH, 3361 BANKWIRE]
 *   result    [[950 CASH], [825 CASH], [1900 CASH],
 *              [1325 CASH, 2800 BANKWIRE], [525 BANKWIRE], [36 BANKWIRE]]
 */
CREATE OR REPLACE FUNCTION pc49.allocate_receipt_payments(p_amounts numeric[], p_payments jsonb)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_n    int := coalesce(array_length(p_amounts, 1), 0);
  v_out  jsonb[];
  v_line int := 1;
  v_room numeric;
  v_pay  jsonb;
  v_left numeric;
  v_take numeric;
BEGIN
  IF v_n = 0 THEN RETURN '[]'::jsonb; END IF;
  v_out := array_fill('[]'::jsonb, ARRAY[v_n]);
  v_room := abs(p_amounts[1]);

  FOR v_pay IN SELECT * FROM jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) LOOP
    v_left := (v_pay ->> 'amount')::numeric;
    WHILE v_left > 0 LOOP
      -- A full line hands on to the next; the last line never does.
      WHILE v_room <= 0 AND v_line < v_n LOOP
        v_line := v_line + 1;
        v_room := abs(p_amounts[v_line]);
      END LOOP;
      v_take := CASE WHEN v_line = v_n THEN v_left ELSE least(v_left, v_room) END;
      v_out[v_line] := v_out[v_line] || jsonb_build_array(
        jsonb_build_object('amount', v_take, 'method', v_pay ->> 'method'));
      v_left := v_left - v_take;
      v_room := v_room - v_take;
    END LOOP;
  END LOOP;

  RETURN to_jsonb(v_out);
END $$;

GRANT EXECUTE ON FUNCTION pc49.allocate_receipt_payments(numeric[], jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0073_a_receipt_holds_several_items')
ON CONFLICT (version) DO NOTHING;
