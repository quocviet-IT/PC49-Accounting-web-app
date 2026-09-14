-- 0066_an_empty_cell_is_not_a_number.sql
-- Ô trống trong tệp nạp là không có giá trị, không phải một con số hỏng.
--
-- Màn hình Nạp dữ liệu đọc CSV bằng parseRecords, và mọi dòng mang đủ các cột
-- của dòng tiêu đề: ô trống thành chuỗi rỗng. Bộ nạp thì ép kiểu thẳng —
-- `(p ->> 'gold_pct')::numeric` — nên ô `gold_pct` trống đầu tiên làm cả lô
-- dừng với "invalid input syntax for type numeric", SAU KHI bước stage đã báo
-- mọi dòng hợp lệ. Trong sheet 2026 cột % vàng trống ở hơn một nghìn dòng, nên
-- không lô nào của đợt đổ dữ liệu đi qua được.
--
-- Các test của 0062–0065 không bắt được vì payload viết tay bỏ hẳn khoá trống
-- thay vì để chuỗi rỗng. Test mới trong import-gold và import-refining đọc dòng
-- đúng như màn hình đọc.
--
-- Sửa một chỗ thay vì bốn mươi: bỏ khoá rỗng khi commit, trước mọi phép ép kiểu.
-- Nó cũng chặn những chỗ không ép kiểu mà vẫn hỏng — `doc_no` rỗng sẽ không để
-- trigger tự đánh số, `partner_code` và `sales_person_code` rỗng sẽ vi phạm
-- khoá ngoại.

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
  v_convs     jsonb := '{}'::jsonb;
  v_deps      jsonb := '{}'::jsonb;
  v_conv_id   uuid;
  v_lot_id    uuid;
  v_dep_id    uuid;
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
    -- Một ô trống trong tệp là "không có giá trị", đúng như một khoá vắng mặt.
    -- parseRecords giữ mọi cột của dòng tiêu đề, nên ô trống tới đây thành
    -- chuỗi rỗng, và `''::numeric` làm hỏng cả lô ngay sau khi bước stage đã
    -- báo hợp lệ. Bỏ khoá rỗng ở đây là cho ô trống đi đúng con đường mà các
    -- payload không có khoá đó vẫn đi. Bước stage vẫn phán xét trên payload
    -- gốc, nên dòng thiếu giá trị bắt buộc vẫn bị trả lại chứ không được nhận.
    p := coalesce((SELECT jsonb_object_agg(e.key, e.value)
                     FROM jsonb_each(r.payload) e
                    WHERE e.value <> to_jsonb(''::text)), '{}'::jsonb);
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

        v_conv_id := NULL; v_lot_id := NULL; v_dep_id := NULL;

        -- Các dòng cùng khoá thành một phiên quy đổi. Khoá do bộ phiên dịch
        -- đặt, và chỉ đặt cho ngày cân bằng được trọng lượng.
        IF coalesce(p ->> 'conv_key', '') <> '' THEN
          v_conv_id := nullif(v_convs ->> (p ->> 'conv_key'), '')::uuid;
          IF v_conv_id IS NULL THEN
            INSERT INTO pc49.gold_conversion (conv_date, kind, note)
            VALUES ((p ->> 'txn_date')::date,
                    CASE WHEN (p ->> 'txn_type') = 'RA_RP'
                         THEN 'RA_RP' ELSE 'TRANSFER' END::pc49.conversion_kind,
                    p ->> 'conv_key')
            RETURNING id INTO v_conv_id;
            v_convs := v_convs || jsonb_build_object(p ->> 'conv_key', v_conv_id);
          END IF;
        END IF;

        IF coalesce(p ->> 'lot_code', '') <> '' THEN
          SELECT id INTO v_lot_id FROM pc49.refining_lot
           WHERE lot_code = p ->> 'lot_code';
          IF v_lot_id IS NULL THEN
            RAISE EXCEPTION
              'row % names lot %, which does not exist; load the lots before the transactions',
              r.row_no, p ->> 'lot_code';
          END IF;
        END IF;

        -- Phiếu cọc đứng trước phiếu giao hàng trong cùng lô nạp; bộ phiên dịch
        -- xuất theo thứ tự đó, và vòng lặp này đi theo số dòng.
        IF coalesce(p ->> 'deposit_key', '') <> ''
           AND (p ->> 'txn_type') IN ('PICKUP', 'CANCEL') THEN
          v_dep_id := nullif(v_deps ->> (p ->> 'deposit_key'), '')::uuid;
        END IF;

        INSERT INTO pc49.gold_txn
          (txn_date, doc_no, txn_type, partner_code, sales_person_code, gold_type_code,
           scrap_detail, gold_pct, uom, qty, unit_price, amount, remarks,
           conversion_id, refining_lot_id, deposit_ref_id)
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
                p ->> 'remarks',
                v_conv_id, v_lot_id, v_dep_id)
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

        IF coalesce(p ->> 'deposit_key', '') <> '' AND (p ->> 'txn_type') = 'DEPOSIT' THEN
          v_deps := v_deps || jsonb_build_object(p ->> 'deposit_key', v_ref);
        END IF;

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
        -- Một dòng là một túi, đúng như sheet 3.2 viết. Lô dựng một lần, ở đúng
        -- trạng thái cuối của nó: trigger sinh chân chuyển kho chỉ chạy khi
        -- CẬP NHẬT trạng thái, nên sổ giữ đúng một bộ chân — bộ mà kế toán đã
        -- ghi thành các dòng Transfer trong sheet giao dịch.
        SELECT id INTO v_lot_id FROM pc49.refining_lot
         WHERE lot_code = p ->> 'lot_code';
        IF v_lot_id IS NULL THEN
          INSERT INTO pc49.refining_lot
            (lot_code, status, refinery_name, sent_date, assay_date, received_date,
             spot_gold_per_oz_sent, spot_pt_per_oz_sent,
             spot_gold_per_oz_assay, spot_pt_per_oz_assay,
             fee_pct_gold, fee_pct_pt, note)
          VALUES (p ->> 'lot_code',
                  coalesce(p ->> 'status', 'DRAFT')::pc49.refining_status,
                  p ->> 'refinery_name',
                  (p ->> 'sent_date')::date, (p ->> 'assay_date')::date,
                  (p ->> 'received_date')::date,
                  (p ->> 'spot_gold_per_oz_sent')::numeric,
                  (p ->> 'spot_pt_per_oz_sent')::numeric,
                  (p ->> 'spot_gold_per_oz_assay')::numeric,
                  (p ->> 'spot_pt_per_oz_assay')::numeric,
                  (p ->> 'fee_pct_gold')::numeric, (p ->> 'fee_pct_pt')::numeric,
                  p ->> 'note')
          RETURNING id INTO v_lot_id;
        END IF;

        INSERT INTO pc49.refining_lot_line
          (lot_id, seq, owner_code, metal, gold_type_code, source_desc,
           gross_weight_gram, gold_pct, assay_weight_gram, assay_pct)
        VALUES (v_lot_id, (p ->> 'seq')::int,
                coalesce(p ->> 'owner_code', 'PC49'),
                (p ->> 'metal')::pc49.metal, p ->> 'gold_type_code',
                p ->> 'source_desc',
                (p ->> 'gross_weight_gram')::numeric, (p ->> 'gold_pct')::numeric,
                (p ->> 'assay_weight_gram')::numeric, (p ->> 'assay_pct')::numeric)
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

INSERT INTO pc49.schema_migrations (version) VALUES ('0066_an_empty_cell_is_not_a_number')
ON CONFLICT (version) DO NOTHING;
