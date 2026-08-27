-- 0015_txn_to_journal.sql
-- Derives the ledger from the transaction the accountant entered.
--
-- The accounting lives here, in one database function, rather than in whichever
-- screen or import happened to create the row. The same transaction therefore
-- always produces the same entries, and a bug is fixed in one place.
--
-- Money on a receipt is not money in the bank: a Zelle, wire or check payment
-- goes to its clearing account (1121ZL / 1121BW / 1121CK) and only reaches a
-- real bank account when the statement confirms it. Those accounts are allowed
-- to run negative, which is exactly what the source shows at the end of January.

CREATE OR REPLACE FUNCTION pc49.cash_account_for(p_method pc49.payment_method)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_method
    WHEN 'CASH'     THEN '1111'
    WHEN 'BANKWIRE' THEN '1121BW'
    WHEN 'ZELLE'    THEN '1121ZL'
    WHEN 'CHECK'    THEN '1121CK'
  END
$$;

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
    END LOOP;

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

INSERT INTO pc49.schema_migrations (version) VALUES ('0015_txn_to_journal')
ON CONFLICT (version) DO NOTHING;
