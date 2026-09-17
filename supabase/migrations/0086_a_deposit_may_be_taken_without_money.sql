-- 0086_a_deposit_may_be_taken_without_money.sql
-- A deposit is an order at an agreed price, with whatever money came with it,
-- none included; and the deposits report reads deposits as they are stored.
--
--   "Deposit gặp lỗi giống cái thứ 2 phải thanh toán" (17-09-2026)
--
-- How a deposit is stored, as the loader has always stored the client's sheet
-- (0063, tests/sql/import-gold) and as 0015 posts it:
--
--   the deposit   the gold, at the agreed price; the money handed over is its
--                 payments, posted cash against 131
--   the pickup    the whole order as its amount, posted 131 against revenue;
--                 the balance handed over is its payments, cash against 131
--
-- so 131 comes back to nothing once the order is collected and paid.
--
-- Three things did not fit that:
--
--   post_gold_txn       a deposit with no money made no line and was refused.
--                       It now puts nothing on the books and returns null, and
--                       sets the gold aside itself, since a movement otherwise
--                       follows a posting (0021)
--   write_gold_receipt  refused the same deposit up front (PAYMENT_SHORT)
--   v_deposit_status    (0045) read the deposit's amount as the money put down
--                       and added the pickup's amount to what was paid. For a
--                       loaded order that is 0 deposited and the order paid
--                       twice over. It now reads the payments
--
-- And gold_receipt_owed (0083) takes what was deposited off what a pickup owes.
--
--   txn_paid              what was paid on one transaction at the counter
--   deposit_order_value   what a deposit's order comes to, when anybody said

CREATE OR REPLACE FUNCTION pc49.txn_paid(p_txn uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(gp.amount), 0) FROM pc49.gold_txn_payment gp WHERE gp.txn_id = p_txn
$$;

/** The order's value: the deposit's amount, or its quantity at the agreed price; null if neither. */
CREATE OR REPLACE FUNCTION pc49.deposit_order_value(p_deposit uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(abs(d.amount), 0),
                  CASE WHEN d.unit_price IS NOT NULL THEN round(abs(d.qty) * d.unit_price, 2) END)
    FROM pc49.gold_txn d WHERE d.id = p_deposit
$$;

-- 0082's body, with a deposit taken without money left off the books.
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

  -- An order taken with no money down moves no money: nothing to post. The
  -- gold is set aside all the same. Movements otherwise follow a posting
  -- (0021), so it is recorded here; recording it twice records nothing.
  IF t.txn_type = 'DEPOSIT'
     AND NOT EXISTS (SELECT 1 FROM pc49.gold_txn_payment WHERE txn_id = p_txn_id) THEN
    PERFORM pc49.record_inventory_movement(p_txn_id);
    RETURN NULL;
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
    -- Revenue, carrying the weight. For a pickup, the whole order.
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

-- 0082's body without the payment check: nothing is refused for its money now.
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

-- 0083's reckoning, with what a pickup's customer put down at the deposit
-- taken off what the pickup owes.
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
      - coalesce((SELECT sum(gp.amount) FROM pc49.gold_txn_payment gp
                    JOIN lines l ON l.deposit_ref_id = gp.txn_id), 0)
      - coalesce((SELECT sum(s.amount) FROM pc49.gold_receipt_settlement s
                   WHERE s.receipt_key = p_key AND s.voided_at IS NULL), 0), 2), 0)
  END
$$;

-- The columns 0045 gave the report, read from what is stored. Dropped rather
-- than replaced: what was paid is now a sum, and a view's column cannot change
-- its type in place.
DROP VIEW IF EXISTS pc49.v_deposit_status;

CREATE VIEW pc49.v_deposit_status AS
  SELECT d.id,
         d.txn_date,
         d.partner_code,
         d.gold_type_code,
         d.uom,
         d.qty,
         d.qty_gram,
         -- The money put down with the order.
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
         -- The deposit's own figure, or the pickup's, which is the whole order.
         o.value AS order_amount,
         dep.paid + coalesce(pick.paid, 0) AS paid_amount,
         CASE
           WHEN s.txn_type = 'CANCEL' THEN 0
           WHEN o.value IS NULL THEN NULL
           ELSE greatest(o.value - dep.paid - coalesce(pick.paid, 0), 0)
         END AS remaining_amount
    FROM pc49.gold_txn d
    LEFT JOIN pc49.gold_txn s ON s.deposit_ref_id = d.id AND s.voided_at IS NULL
    CROSS JOIN LATERAL (SELECT pc49.txn_paid(d.id) AS paid) dep
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

GRANT SELECT ON pc49.v_deposit_status TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.txn_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.deposit_order_value(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0086_a_deposit_may_be_taken_without_money')
ON CONFLICT (version) DO NOTHING;
