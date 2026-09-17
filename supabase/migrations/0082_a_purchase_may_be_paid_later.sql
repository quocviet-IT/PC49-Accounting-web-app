-- 0082_a_purchase_may_be_paid_later.sql
-- A purchase paid in part, or not yet at all, is saved, and what is still owed
-- on it is booked against the seller.
--
-- Reported from the entry screen on 17-09-2026:
--
--   "Không lưu được đối với đơn chưa thanh toán hết. Thực tế vẫn sẽ có đơn
--    thanh toán 1 phần, còn nợ lại khách đợt sau thanh toán tiếp"
--
-- post_gold_txn (0015) booked a purchase from its payments: stock in and money
-- out, a line per payment. A purchase with no payment made no line and was
-- refused, and write_gold_receipt (0074) refused a receipt whose payments ran
-- out before its last item, for that reason. A purchase paid in part did save,
-- but put the stock on the books at what had been paid, and what was still
-- owed to the seller was nowhere.
--
-- Now the part not paid is a line of its own, stock in against 331, settled
-- later payment by payment (0083). Only the part that is short: a purchase
-- paid in full posts exactly the lines it always did, so nothing already in the
-- books, and no report, reads differently. Paying more than the receipt comes
-- to is left as it was; what to do with it has not been decided.
--
-- A sale already posted this way round (131), and is unchanged. A deposit still
-- needs its deposit: taking one without money is not a deposit.

CREATE OR REPLACE FUNCTION pc49.post_gold_txn(p_txn_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  t          pc49.gold_txn;
  g          pc49.gold_type;
  v_entry_id uuid;
  v_seq      int := 0;
  v_cost     numeric;
  v_price    numeric;
  pay        record;
  v_first    boolean := true;
  v_paid     numeric := 0;
BEGIN
  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_txn_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction % does not exist', p_txn_id;
  END IF;
  IF t.journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'transaction % is already posted as entry %', p_txn_id, t.journal_entry_id;
  END IF;

  SELECT * INTO g FROM pc49.gold_type WHERE code = t.gold_type_code;

  INSERT INTO pc49.journal_entry
    (entry_date, period, doc_no_hp, partner_code, txn_kind, memo)
  VALUES
    (t.txn_date, to_char(t.txn_date, 'YYYY-MM'), t.doc_no, t.partner_code,
     CASE WHEN t.txn_type IN ('PO', 'PO_VENDOR') THEN 'PO'::pc49.txn_kind
          ELSE 'SO'::pc49.txn_kind END,
     coalesce(t.remarks, t.txn_type::text || ' ' || g.name_en))
  RETURNING id INTO v_entry_id;

  IF t.txn_type IN ('SALE', 'PICKUP') THEN
    -- Revenue, carrying the weight.
    v_seq := v_seq + 1;
    INSERT INTO pc49.journal_line
      (entry_id, seq, debit_account, credit_account, amount_usd,
       gold_type_code, uom, qty_native, unit_price)
    VALUES (v_entry_id, v_seq, '131', '511', t.amount,
            t.gold_type_code, t.uom, t.qty, t.unit_price);

    -- Cost of what was sold, at the day's price for that gold type. This is the
    -- provisional figure; the definitive one follows when the gold is priced.
    v_price := pc49.cogs_price(t.txn_date, t.gold_type_code);
    IF v_price IS NOT NULL THEN
      v_cost := round(abs(t.qty) * v_price, 2);
      v_seq := v_seq + 1;
      INSERT INTO pc49.journal_line
        (entry_id, seq, debit_account, credit_account, amount_usd,
         gold_type_code, uom, qty_native, cogs_unit)
      VALUES (v_entry_id, v_seq, g.cogs_account, g.inventory_account, v_cost,
              t.gold_type_code, t.uom, t.qty, v_price);
    END IF;

    -- What the customer actually handed over, per method.
    FOR pay IN SELECT * FROM pc49.gold_txn_payment WHERE txn_id = p_txn_id ORDER BY seq LOOP
      v_seq := v_seq + 1;
      INSERT INTO pc49.journal_line
        (entry_id, seq, debit_account, credit_account, amount_usd)
      VALUES (v_entry_id, v_seq, pc49.cash_account_for(pay.method), '131', pay.amount);
    END LOOP;

  ELSIF t.txn_type IN ('PO', 'PO_VENDOR') THEN
    -- Stock in, money out, one line per payment method. The weight rides on the
    -- first line only so a split payment does not count it twice.
    FOR pay IN SELECT * FROM pc49.gold_txn_payment WHERE txn_id = p_txn_id ORDER BY seq LOOP
      v_seq := v_seq + 1;
      INSERT INTO pc49.journal_line
        (entry_id, seq, debit_account, credit_account, amount_usd,
         gold_type_code, uom, qty_native, unit_price)
      VALUES (v_entry_id, v_seq, g.inventory_account, pc49.cash_account_for(pay.method), pay.amount,
              CASE WHEN v_first THEN t.gold_type_code END,
              CASE WHEN v_first THEN t.uom END,
              CASE WHEN v_first THEN t.qty END,
              CASE WHEN v_first THEN t.unit_price END);
      v_first := false;
      v_paid := v_paid + pay.amount;
    END LOOP;

    -- What has not been paid yet is owed to the seller: stock in against 331.
    -- With nothing paid this is the first line, and carries the weight.
    IF coalesce(-t.amount, 0) > v_paid THEN
      v_seq := v_seq + 1;
      INSERT INTO pc49.journal_line
        (entry_id, seq, debit_account, credit_account, amount_usd,
         gold_type_code, uom, qty_native, unit_price)
      VALUES (v_entry_id, v_seq, g.inventory_account, '331', -t.amount - v_paid,
              CASE WHEN v_first THEN t.gold_type_code END,
              CASE WHEN v_first THEN t.uom END,
              CASE WHEN v_first THEN t.qty END,
              CASE WHEN v_first THEN t.unit_price END);
      v_first := false;
    END IF;

  ELSIF t.txn_type = 'DEPOSIT' THEN
    -- Money taken, nothing recognised as revenue and no cost until pickup. The
    -- gold is still in the shop, which is why book and physical inventory differ.
    FOR pay IN SELECT * FROM pc49.gold_txn_payment WHERE txn_id = p_txn_id ORDER BY seq LOOP
      v_seq := v_seq + 1;
      INSERT INTO pc49.journal_line
        (entry_id, seq, debit_account, credit_account, amount_usd)
      VALUES (v_entry_id, v_seq, pc49.cash_account_for(pay.method), '131', pay.amount);
    END LOOP;

  ELSE
    -- Transfers, Ra RP, memos and refining legs move weight between inventory
    -- accounts without money changing hands.
    v_seq := v_seq + 1;
    INSERT INTO pc49.journal_line
      (entry_id, seq, debit_account, credit_account, amount_usd,
       gold_type_code, uom, qty_native)
    VALUES (v_entry_id, v_seq,
            CASE WHEN t.qty > 0 THEN g.inventory_account ELSE g.in_transit_account END,
            CASE WHEN t.qty > 0 THEN g.in_transit_account ELSE g.inventory_account END,
            abs(t.amount), t.gold_type_code, t.uom, t.qty);
  END IF;

  IF v_seq = 0 THEN
    RAISE EXCEPTION 'transaction % produced no journal lines; it has no payments recorded',
      p_txn_id;
  END IF;

  UPDATE pc49.journal_entry SET posted_at = now() WHERE id = v_entry_id;
  UPDATE pc49.gold_txn SET journal_entry_id = v_entry_id WHERE id = p_txn_id;

  RETURN v_entry_id;
END $$;

-- 0074's body. The one change is the payment check: only a deposit is refused
-- for having no money on it.
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

  -- A deposit is money taken against an order: without the money there is no
  -- deposit. A purchase or a sale may be paid later (0082, 0083).
  IF v_type = 'DEPOSIT' AND jsonb_array_length(v_alloc -> 0) = 0 THEN
    RAISE EXCEPTION 'PAYMENT_SHORT: item 1 is left with no payment; a deposit needs its deposit';
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

-- 0064's body, kept as strict as it was for a loaded purchase with no payment
-- at all. The entry screen now saves one as owed on purpose; a sheet leaves the
-- payment cells blank by mistake as often as on purpose, and nobody is there to
-- ask. So the loader still names the row for somebody to look at, rather than
-- turning a blank cell into a debt to the seller.
CREATE OR REPLACE FUNCTION pc49.post_import_batch(p_batch_id uuid)
RETURNS TABLE (row_no int, txn_id uuid, error text)
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.row_no AS rn, t.id AS tid, t.txn_type
      FROM pc49.import_row i
      JOIN pc49.gold_txn t ON t.id = i.committed_ref
     WHERE i.batch_id = p_batch_id
       AND i.status = 'COMMITTED'
       AND t.journal_entry_id IS NULL
       AND t.voided_at IS NULL
     ORDER BY t.txn_date, i.row_no
  LOOP
    BEGIN
      IF r.txn_type IN ('PO', 'PO_VENDOR')
         AND NOT EXISTS (SELECT 1 FROM pc49.gold_txn_payment gp WHERE gp.txn_id = r.tid) THEN
        RAISE EXCEPTION 'transaction % has no payments recorded; a loaded purchase is not booked as owed without one',
          r.tid;
      END IF;
      PERFORM pc49.post_gold_txn(r.tid);
    EXCEPTION WHEN others THEN
      row_no := r.rn; txn_id := r.tid; error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0082_a_purchase_may_be_paid_later')
ON CONFLICT (version) DO NOTHING;
