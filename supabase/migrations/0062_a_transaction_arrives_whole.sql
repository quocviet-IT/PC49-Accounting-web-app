-- 0062_a_transaction_arrives_whole.sql
-- Một giao dịch đi vào hệ thống cùng với tiền và người của nó.
--
-- Bộ nạp cho tới nay chỉ dựng được thân giao dịch. Nhưng post_gold_txn từ chối
-- ghi sổ một giao dịch không có dòng thanh toán nào — "produced no journal
-- lines" — nên 1.126 dòng của năm 2026 sẽ vào cơ sở dữ liệu rồi nằm im ngoài
-- sổ, và không màn hình nào nói cho biết tại sao.
--
-- Nên payload nhận thêm hai ô. `payments` viết gọn theo dạng
-- `AP:CASH:400|AP:CHECK:250`; chọn dạng này thay vì JSON vì màn hình Nạp dữ
-- liệu bày payload thô ra cho kế toán đọc, và một chuỗi ngắn đọc được bằng mắt.
-- `sales` chép nguyên ô của sheet — `L.Thanh`, hoặc `N.Ý/T.Quỳnh` — rồi tỷ lệ
-- suy ra từ số người, đúng ba hình kế toán đã trả lời: 100, rồi 80-20, rồi
-- 60-20-20, theo thứ tự viết.

-- Đọc ô thanh toán. Ép thẳng sang enum, để một hình thức trả tiền hệ thống
-- chưa biết tự ném lỗi ở đây chứ không lặng lẽ thành NULL.
CREATE OR REPLACE FUNCTION pc49.parse_payments(p_spec text)
RETURNS TABLE (seq int, direction pc49.payment_direction,
               method pc49.payment_method, amount numeric)
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT row_number() OVER (ORDER BY ord)::int,
         btrim(split_part(part, ':', 1))::pc49.payment_direction,
         btrim(split_part(part, ':', 2))::pc49.payment_method,
         abs(btrim(split_part(part, ':', 3))::numeric)
    FROM unnest(string_to_array(coalesce(p_spec, ''), '|'))
         WITH ORDINALITY AS t(part, ord)
   WHERE btrim(part) <> ''
$fn$;

-- Đọc ô sales. Bốn tên trở lên trả về không dòng nào: chỗ gọi phải đã chặn
-- trước, và im lặng chia sai còn tệ hơn không chia.
CREATE OR REPLACE FUNCTION pc49.sales_shares(p_names text)
RETURNS TABLE (seq int, code text, share_pct numeric)
LANGUAGE sql IMMUTABLE AS $fn$
  WITH parts AS (
    SELECT btrim(part) AS code, ord
      FROM unnest(string_to_array(replace(coalesce(p_names, ''), ',', '/'), '/'))
           WITH ORDINALITY AS t(part, ord)
     WHERE btrim(part) <> ''
  ), counted AS (
    SELECT code, row_number() OVER (ORDER BY ord)::int AS seq,
           count(*) OVER ()::int AS n
      FROM parts
  )
  SELECT seq, code,
         CASE WHEN n = 1 THEN 100
              WHEN n = 2 THEN (ARRAY[80, 20])[seq]
              WHEN n = 3 THEN (ARRAY[60, 20, 20])[seq]
         END::numeric
    FROM counted
   WHERE n <= 3
$fn$;

GRANT EXECUTE ON FUNCTION pc49.parse_payments(text), pc49.sales_shares(text)
  TO authenticated;

CREATE OR REPLACE FUNCTION pc49.stage_import_row(
  p_batch_id uuid, p_row_no int, p_payload jsonb)
RETURNS pc49.import_row_status
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_source  pc49.import_source;
  v_code    text;
  v_value   text;
  v_reason  text;
  v_status  pc49.import_row_status := 'VALID';
BEGIN
  SELECT source INTO v_source FROM pc49.import_batch WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import batch % does not exist', p_batch_id;
  END IF;

  v_value := pc49.spreadsheet_error_in(p_payload);
  IF v_value IS NOT NULL THEN
    v_code := 'SHEET_ERROR';
  END IF;

  -- Referential checks, so a row naming something the system has never heard of
  -- is caught here rather than at insert time with a foreign key message the
  -- accountant cannot act on.
  IF v_code IS NULL AND p_payload ? 'gold_type_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.gold_type
                      WHERE code = p_payload ->> 'gold_type_code') THEN
    v_code := 'UNKNOWN_GOLD_TYPE'; v_value := p_payload ->> 'gold_type_code';
  END IF;

  IF v_code IS NULL AND p_payload ? 'account_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.account
                      WHERE code = p_payload ->> 'account_code') THEN
    v_code := 'UNKNOWN_ACCOUNT'; v_value := p_payload ->> 'account_code';
  END IF;

  IF v_code IS NULL AND p_payload ? 'cash_account_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.cash_account
                      WHERE code = p_payload ->> 'cash_account_code') THEN
    v_code := 'UNKNOWN_CASH_ACCOUNT'; v_value := p_payload ->> 'cash_account_code';
  END IF;

  IF v_code IS NULL AND v_source = 'GOLD_TXN'
     AND coalesce(p_payload ->> 'qty', '') = '' THEN
    v_code := 'MISSING_QTY'; v_value := NULL;
  END IF;

  -- Kế toán chốt: nhiều nhất ba người trên một đơn. Tên thứ tư là lỗi gõ, và
  -- đoán tỷ lệ cho nó là tự bịa ra một cách chia hoa hồng chưa ai đồng ý.
  IF v_code IS NULL AND coalesce(p_payload ->> 'sales', '') <> ''
     AND array_length(string_to_array(
           replace(p_payload ->> 'sales', ',', '/'), '/'), 1) > 3 THEN
    v_code := 'TOO_MANY_SALES'; v_value := p_payload ->> 'sales';
  END IF;

  IF v_code IS NULL AND coalesce(p_payload ->> 'payments', '') <> '' THEN
    BEGIN
      PERFORM pc49.parse_payments(p_payload ->> 'payments');
    EXCEPTION WHEN others THEN
      v_code := 'BAD_PAYMENT'; v_value := p_payload ->> 'payments';
    END;
  END IF;

  IF v_code IS NOT NULL THEN
    v_status := 'REJECTED';
    v_reason := CASE v_code
      WHEN 'SHEET_ERROR' THEN
        format('the sheet holds %s in this row; it did not know the answer either', v_value)
      WHEN 'UNKNOWN_GOLD_TYPE'    THEN format('no gold type called %s', v_value)
      WHEN 'UNKNOWN_ACCOUNT'      THEN format('no account called %s', v_value)
      WHEN 'UNKNOWN_CASH_ACCOUNT' THEN format('no cash account called %s', v_value)
      WHEN 'MISSING_QTY'          THEN 'a gold transaction with no quantity'
      WHEN 'TOO_MANY_SALES'       THEN format('%s names more than three sales people', v_value)
      WHEN 'BAD_PAYMENT'          THEN format('cannot read the payment %s', v_value)
    END;
  END IF;

  INSERT INTO pc49.import_row
    (batch_id, row_no, payload, status, reason, reason_code, reason_value)
  VALUES (p_batch_id, p_row_no, p_payload, v_status, v_reason, v_code, v_value)
  ON CONFLICT (batch_id, row_no) DO UPDATE
    SET payload = excluded.payload, status = excluded.status, reason = excluded.reason,
        reason_code = excluded.reason_code, reason_value = excluded.reason_value;

  RETURN v_status;
END $$;

CREATE OR REPLACE FUNCTION pc49.commit_import_batch(p_batch_id uuid, p_allow_partial boolean DEFAULT false)
 RETURNS TABLE(committed integer, left_rejected integer)
 LANGUAGE plpgsql
 SET search_path TO 'pc49', 'public'
AS $function$
DECLARE
  v_source    pc49.import_source;
  v_done      timestamptz;
  v_rejected  int;
  v_n         int := 0;
  v_ref       uuid;
  v_entry     uuid;
  v_key       text;
  v_entries   jsonb := '{}'::jsonb;
  r           record;
  p           jsonb;
BEGIN
  SELECT source, committed_at INTO v_source, v_done
    FROM pc49.import_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import batch % does not exist', p_batch_id;
  END IF;
  IF v_done IS NOT NULL THEN
    RAISE EXCEPTION 'batch % was already committed at %; withdraw it first if it was wrong',
      p_batch_id, v_done;
  END IF;

  SELECT count(*) INTO v_rejected
    FROM pc49.import_row WHERE batch_id = p_batch_id AND status = 'REJECTED';

  IF v_rejected > 0 AND NOT p_allow_partial THEN
    RAISE EXCEPTION
      '% of the rows in this batch are still rejected; fix them and stage again, '
      'or commit again saying partial is intended', v_rejected;
  END IF;

  FOR r IN SELECT * FROM pc49.import_row
            WHERE batch_id = p_batch_id AND status = 'VALID' ORDER BY row_no
  LOOP
    p := r.payload;
    v_ref := NULL;

    CASE v_source
      WHEN 'GOLD_PRICE' THEN
        INSERT INTO pc49.gold_price_daily
          (price_date, gold_type_code, market_price, avg_purchase_price, source)
        VALUES ((p ->> 'price_date')::date, p ->> 'gold_type_code',
                (p ->> 'market_price')::numeric, (p ->> 'avg_purchase_price')::numeric,
                coalesce(p ->> 'source', 'import'))
        ON CONFLICT (price_date, gold_type_code) DO UPDATE
          SET market_price = excluded.market_price,
              avg_purchase_price = excluded.avg_purchase_price,
              updated_at = now();

      WHEN 'SPOT_PRICE' THEN
        INSERT INTO pc49.spot_price_daily (price_date, metal, spot_per_oz, source)
        VALUES ((p ->> 'price_date')::date, (p ->> 'metal')::pc49.metal,
                (p ->> 'spot_per_oz')::numeric, coalesce(p ->> 'source', 'import'))
        ON CONFLICT (price_date, metal) DO UPDATE
          SET spot_per_oz = excluded.spot_per_oz, updated_at = now();

      WHEN 'OPENING_CASH' THEN
        INSERT INTO pc49.cash_opening_balance (cash_account_code, as_of, amount, note)
        VALUES (p ->> 'cash_account_code', (p ->> 'as_of')::date,
                (p ->> 'amount')::numeric, p ->> 'note')
        ON CONFLICT (cash_account_code, as_of) DO UPDATE
          SET amount = excluded.amount, note = excluded.note;

      WHEN 'OPENING_INVENTORY' THEN
        INSERT INTO pc49.inventory_movement
          (move_date, gold_type_code, owner_code, bucket, qty_gram, qty_native, uom,
           unit_cost, provisional_value, source_type, note)
        VALUES ((p ->> 'as_of')::date, p ->> 'gold_type_code',
                coalesce(p ->> 'owner_code', 'PC49'),
                coalesce(p ->> 'bucket', 'ON_HAND')::pc49.inventory_bucket,
                -- A weight quoted in ounces or luong is converted here rather
                -- than by whoever typed the sheet.
                (p ->> 'qty')::numeric * coalesce(
                  (SELECT f.gram_per_unit FROM pc49.uom_factor f
                    WHERE f.uom = (p ->> 'uom')::pc49.uom), 1),
                (p ->> 'qty')::numeric, (p ->> 'uom')::pc49.uom,
                (p ->> 'unit_cost')::numeric, (p ->> 'value')::numeric,
                'OPENING', p ->> 'note')
        RETURNING id INTO v_ref;

      WHEN 'GOLD_TXN' THEN
        -- Sáu trăm năm mươi sáu cái tên trong sổ, bốn trăm năm mươi hai cái chỉ
        -- xuất hiện đúng một lần: khách vãng lai của một tiệm vàng. Chờ khai
        -- báo tay từng người là không nạp được dòng nào.
        IF coalesce(p ->> 'partner_code', '') <> '' THEN
          INSERT INTO pc49.partner (code) VALUES (p ->> 'partner_code')
          ON CONFLICT (code) DO NOTHING;
        END IF;
        INSERT INTO pc49.sales_person (code, full_name)
        SELECT s.code, s.code FROM pc49.sales_shares(p ->> 'sales') s
        ON CONFLICT (code) DO NOTHING;

        INSERT INTO pc49.gold_txn
          (txn_date, doc_no, txn_type, partner_code, sales_person_code, gold_type_code,
           scrap_detail, gold_pct, uom, qty, unit_price, amount, remarks)
        VALUES ((p ->> 'txn_date')::date, p ->> 'doc_no',
                (p ->> 'txn_type')::pc49.txn_type, p ->> 'partner_code',
                coalesce(p ->> 'sales_person_code',
                         (SELECT code FROM pc49.sales_shares(p ->> 'sales') WHERE seq = 1)),
                p ->> 'gold_type_code',
                p ->> 'scrap_detail', (p ->> 'gold_pct')::numeric,
                -- The type's own unit, not grams. A blank column in the
                -- spreadsheet used to make every row grams, which for a
                -- luong or an ounce type is a quantity in one unit
                -- valued at the price of another.
                coalesce((p ->> 'uom')::pc49.uom,
                         (SELECT native_uom FROM pc49.gold_type
                           WHERE code = p ->> 'gold_type_code'),
                         'GRAM'), (p ->> 'qty')::numeric,
                (p ->> 'unit_price')::numeric, coalesce((p ->> 'amount')::numeric, 0),
                p ->> 'remarks')
        RETURNING id INTO v_ref;

        INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, method, amount, paid_at)
        SELECT v_ref, x.seq, x.direction, x.method, x.amount, (p ->> 'txn_date')::date
          FROM pc49.parse_payments(p ->> 'payments') x;

        -- Trigger gold_txn_seed_sales_share (0048) đã ghi sẵn một dòng 100%
        -- cho tên dẫn đầu. Đây là câu nói lại tỷ lệ thật; kiểm tra "tổng phải
        -- bằng 100" là trigger hoãn tới cuối giao dịch nên trạng thái giữa
        -- chừng 100 + 20 không bị chặn.
        INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct)
        SELECT v_ref, s.code, s.share_pct
          FROM pc49.sales_shares(p ->> 'sales') s
        ON CONFLICT (txn_id, sales_person_code) DO UPDATE
          SET share_pct = excluded.share_pct;

      WHEN 'JOURNAL' THEN
        -- Rows carrying the same entry_key become one entry, so a document
        -- spread over several rows arrives balanced rather than as several half
        -- entries. The grouping key is held here for the length of this load
        -- only - doc_no_hp cannot do the job, because on 2026-01-01 the number
        -- 9001 spans three unrelated transactions. A row with no entry_key
        -- stands alone.
        v_key := coalesce(p ->> 'entry_key', 'row:' || r.row_no::text);
        v_entry := nullif(v_entries ->> v_key, '')::uuid;
        IF v_entry IS NULL THEN
          INSERT INTO pc49.journal_entry
            (entry_date, period, doc_no_hp, memo, txn_kind, partner_code)
          VALUES ((p ->> 'entry_date')::date,
                  to_char((p ->> 'entry_date')::date, 'YYYY-MM'),
                  p ->> 'doc_no', p ->> 'memo', 'MANUAL', p ->> 'partner_code')
          RETURNING id INTO v_entry;
          v_entries := v_entries || jsonb_build_object(v_key, v_entry);
        END IF;
        -- Left unposted. Posting is a decision somebody makes after reading the
        -- reconciliation, not a side effect of loading a spreadsheet.
        INSERT INTO pc49.journal_line
          (entry_id, seq, debit_account, credit_account, amount_usd,
           gold_type_code, uom, qty_native)
        VALUES (v_entry,
                (SELECT coalesce(max(seq), 0) + 1 FROM pc49.journal_line
                  WHERE entry_id = v_entry),
                p ->> 'debit_account', p ->> 'credit_account',
                (p ->> 'amount')::numeric, p ->> 'gold_type_code',
                (p ->> 'uom')::pc49.uom, (p ->> 'qty')::numeric);
        v_ref := v_entry;

      WHEN 'REFINING_LOT' THEN
        INSERT INTO pc49.refining_lot
          (lot_code, refinery_name, sent_date, spot_gold_per_oz_sent,
           spot_pt_per_oz_sent, assay_date, note)
        VALUES (p ->> 'lot_code', p ->> 'refinery_name', (p ->> 'sent_date')::date,
                (p ->> 'spot_gold_per_oz_sent')::numeric,
                (p ->> 'spot_pt_per_oz_sent')::numeric,
                (p ->> 'assay_date')::date, p ->> 'note')
        ON CONFLICT (lot_code) DO NOTHING
        RETURNING id INTO v_ref;

      ELSE
        RAISE EXCEPTION 'no loader has been written for % yet', v_source;
    END CASE;

    UPDATE pc49.import_row SET status = 'COMMITTED', committed_ref = v_ref
     WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;

  UPDATE pc49.import_batch
     SET committed_at = now(), committed_by = auth.uid(),
         committed_partial = (v_rejected > 0)
   WHERE id = p_batch_id;

  committed := v_n;
  left_rejected := v_rejected;
  RETURN NEXT;
END $function$;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0062_a_transaction_arrives_whole')
ON CONFLICT (version) DO NOTHING;
