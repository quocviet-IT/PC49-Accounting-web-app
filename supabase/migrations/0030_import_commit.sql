-- 0030_import_commit.sql
-- Turning a reviewed batch into records, and taking it back out again.
--
-- Two rules hold this together. A batch with rejected rows in it does not commit
-- unless somebody says so out loud, because a partial load that nobody notices
-- is how a set of books ends up quietly short. And a committed batch can be
-- withdrawn whole, but only while nothing downstream has been built on top of
-- it - once an imported transaction is posted to the ledger, the way back is a
-- reversing entry, the same road everyone else takes.

ALTER TABLE pc49.import_batch
  ADD COLUMN IF NOT EXISTS committed_partial boolean NOT NULL DEFAULT false;

-- Commits every VALID row in the batch. Returns what it wrote and what it left.
CREATE OR REPLACE FUNCTION pc49.commit_import_batch(
  p_batch_id uuid, p_allow_partial boolean DEFAULT false)
RETURNS TABLE (committed int, left_rejected int)
LANGUAGE plpgsql SET search_path = pc49, public AS $$
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
        INSERT INTO pc49.gold_txn
          (txn_date, doc_no, txn_type, partner_code, sales_person_code, gold_type_code,
           scrap_detail, gold_pct, uom, qty, unit_price, amount, remarks)
        VALUES ((p ->> 'txn_date')::date, p ->> 'doc_no',
                (p ->> 'txn_type')::pc49.txn_type, p ->> 'partner_code',
                p ->> 'sales_person_code', p ->> 'gold_type_code',
                p ->> 'scrap_detail', (p ->> 'gold_pct')::numeric,
                coalesce(p ->> 'uom', 'GRAM')::pc49.uom, (p ->> 'qty')::numeric,
                (p ->> 'unit_price')::numeric, coalesce((p ->> 'amount')::numeric, 0),
                p ->> 'remarks')
        RETURNING id INTO v_ref;

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
END $$;

-- Takes a committed batch back out. Only the rows this batch created, and only
-- while nothing has been built on top of them.
CREATE OR REPLACE FUNCTION pc49.withdraw_import_batch(p_batch_id uuid)
RETURNS int
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_source  pc49.import_source;
  v_n       int := 0;
  v_blocked int;
  r         record;
BEGIN
  SELECT source INTO v_source FROM pc49.import_batch
   WHERE id = p_batch_id AND committed_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch % is not committed, so there is nothing to withdraw', p_batch_id;
  END IF;

  IF v_source = 'GOLD_TXN' THEN
    SELECT count(*) INTO v_blocked
      FROM pc49.import_row i JOIN pc49.gold_txn t ON t.id = i.committed_ref
     WHERE i.batch_id = p_batch_id AND t.journal_entry_id IS NOT NULL;
    IF v_blocked > 0 THEN
      RAISE EXCEPTION
        '% of these transactions have already been posted to the ledger; '
        'correct them with a reversing entry rather than withdrawing the batch', v_blocked;
    END IF;
  END IF;

  IF v_source = 'JOURNAL' THEN
    SELECT count(DISTINCT i.committed_ref) INTO v_blocked
      FROM pc49.import_row i JOIN pc49.journal_entry e ON e.id = i.committed_ref
     WHERE i.batch_id = p_batch_id AND e.posted_at IS NOT NULL;
    IF v_blocked > 0 THEN
      RAISE EXCEPTION
        '% of these entries have already been posted; correct them with a '
        'reversing entry rather than withdrawing the batch', v_blocked;
    END IF;
  END IF;

  -- The price and opening-balance loads write by key rather than by id, so an
  -- earlier figure they overwrote cannot be handed back. Say so instead of
  -- pretending the withdrawal was complete.
  IF v_source IN ('GOLD_PRICE', 'SPOT_PRICE', 'OPENING_CASH') THEN
    RAISE EXCEPTION
      'a % batch overwrites by date and key, so withdrawing it cannot restore what '
      'it replaced; stage the correct figures and commit again instead', v_source;
  END IF;

  FOR r IN SELECT * FROM pc49.import_row
            WHERE batch_id = p_batch_id AND status = 'COMMITTED' AND committed_ref IS NOT NULL
  LOOP
    CASE v_source
      WHEN 'OPENING_INVENTORY' THEN
        DELETE FROM pc49.inventory_movement WHERE id = r.committed_ref;
      WHEN 'GOLD_TXN' THEN
        DELETE FROM pc49.gold_txn WHERE id = r.committed_ref;
      WHEN 'JOURNAL' THEN
        DELETE FROM pc49.journal_line WHERE entry_id = r.committed_ref;
        DELETE FROM pc49.journal_entry WHERE id = r.committed_ref;
      WHEN 'REFINING_LOT' THEN
        DELETE FROM pc49.refining_lot WHERE id = r.committed_ref;
      ELSE NULL;
    END CASE;
    v_n := v_n + 1;
  END LOOP;

  UPDATE pc49.import_row SET status = 'VALID', committed_ref = NULL
   WHERE batch_id = p_batch_id AND status = 'COMMITTED';
  UPDATE pc49.import_batch
     SET committed_at = NULL, committed_by = NULL, committed_partial = false
   WHERE id = p_batch_id;

  RETURN v_n;
END $$;

INSERT INTO pc49.schema_migrations (version) VALUES ('0030_import_commit')
ON CONFLICT (version) DO NOTHING;
