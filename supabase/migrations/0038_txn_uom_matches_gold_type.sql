-- 0038_txn_uom_matches_gold_type.sql
-- A transaction is measured in the unit its gold type is traded in.
--
-- Every gold type names the unit it trades in — Rong Phung and 9999 by luong,
-- the coins by ounce, scrap and grain by gram — and `gold_price_daily` holds
-- the price in that same unit. Valuation multiplies the two, so a row measured
-- in some other unit is priced against a number that means something else.
--
-- The screen never gets this wrong: it takes the unit from the gold type and
-- offers no way to change it. Nothing else was holding to that.
--
--   * The importer writes `coalesce(p ->> 'uom', 'GRAM')`, so a spreadsheet
--     column left blank makes every row grams. A luong of Rong Phung read as
--     one gram is then valued at the luong price — 37.5 times over — and the
--     books balance, the report prints, and nobody is told. The 2026 history
--     arrives down that path.
--
--   * A script writing rows directly hits the same thing from the other side.
--     A fortnight of demo trading entered in grams valued the coin sales at
--     one gram each, turning a 1.4 per cent margin into 52 per cent.
--
-- Refused rather than corrected: a quantity written in the wrong unit is a
-- number nobody can safely reinterpret. Ten could be ten grams the writer meant
-- or ten luong they meant; silently choosing one is how a wrong figure gets a
-- signature on it. Stopping the load is cheap. A wrong closing stock is not.

CREATE OR REPLACE FUNCTION pc49.gold_txn_check_uom()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_native pc49.uom;
BEGIN
  SELECT native_uom INTO v_native FROM pc49.gold_type WHERE code = NEW.gold_type_code;
  IF v_native IS NOT NULL AND NEW.uom IS DISTINCT FROM v_native THEN
    RAISE EXCEPTION
      '% is traded in % but this row is in %; the price for % is per %, so the two do not multiply',
      NEW.gold_type_code, v_native, NEW.uom, NEW.gold_type_code, v_native;
  END IF;
  RETURN NEW;
END $$;

-- Before the row is written, and before the trigger that fills the gram figure
-- from it, so nothing downstream ever sees a mismatched pair.
DROP TRIGGER IF EXISTS gold_txn_check_uom ON pc49.gold_txn;
CREATE TRIGGER gold_txn_check_uom
  BEFORE INSERT OR UPDATE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_check_uom();

-- And the importer stops assuming grams. The guard above would catch it, but
-- a load that fails on every coin row is a poor way to learn that the unit
-- column was blank — the type already knows what it trades in.

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
        INSERT INTO pc49.gold_txn
          (txn_date, doc_no, txn_type, partner_code, sales_person_code, gold_type_code,
           scrap_detail, gold_pct, uom, qty, unit_price, amount, remarks)
        VALUES ((p ->> 'txn_date')::date, p ->> 'doc_no',
                (p ->> 'txn_type')::pc49.txn_type, p ->> 'partner_code',
                p ->> 'sales_person_code', p ->> 'gold_type_code',
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

INSERT INTO pc49.schema_migrations (version) VALUES ('0038_txn_uom_matches_gold_type')
ON CONFLICT (version) DO NOTHING;
