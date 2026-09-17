# Tên loại vàng, đặt cọc và lấy hàng — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tên loại vàng theo sheet Dashboard; đặt cọc lưu được từ 0 đồng với dấu tự đặt; lấy hàng từ nút trên dòng cọc, có ngày và số phiếu riêng; báo cáo đơn cọc đọc đúng dữ liệu thật.

**Architecture:** 0085 đổi tên. 0086 sửa ghi sổ đặt cọc không tiền, bỏ `PAYMENT_SHORT`, tính còn nợ của phiếu lấy trừ tiền cọc, dựng lại `v_deposit_status` theo dữ liệu nạp. 0087 thêm `save_gold_pickup`, `gold_receipt_deposit` và cột `deposit` của sổ. Màn hình: form phiếu (DEPOSIT tự dấu, bỏ PICKUP), hộp Lấy hàng, thẻ trạng thái trên sổ.

**Tech Stack:** PostgreSQL/PGlite + vitest; Next.js 16, React 19, antd 6, zod 4; Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-dat-coc-lay-hang-design.md`

## Global Constraints

- Không có chữ `cl[a]ude`, `cod[e]x` trong commit hay nội dung đẩy lên; grep trước khi đẩy phải in 0.
- `git push origin main` là lệnh riêng, ngoài 04:00–08:00 UTC trừ khi người dùng bảo.
- DB thật chỉ ghi bằng `npm run migrate`, sau đó `npm run verify:live`.
- Test SQL chạy một mình: `npx vitest run tests/sql --maxWorkers=4`.
- Mã từ chối: `PICKUP_NOT_DEPOSIT`, `PICKUP_TAKEN: YYYY-MM-DD`, `PICKUP_DATE: deposit YYYY-MM-DD`, `PICKUP_NO_PRICE`, `RECEIPT_VOIDED`.
- Tên vàng: Rong Phung, 9999, Maple Leaf, Credit Suisse, American Eagle, Other, Scrap Gold, Grain, PT.
- File mới tách bằng `node scripts/extract-plan-files.mjs docs/superpowers/plans/2026-09-17-dat-coc-lay-hang.md <path>…`.

---

### Task 1: Tên loại vàng (0085)

**Files:** Create `supabase/migrations/0085_gold_is_named_as_on_the_dashboard.sql`; Modify `tests/sql/reference-data.test.ts` (thay test "calls scrap gold Scrap Gold…"); Modify tên vàng trong `scripts/verify-conversion.mjs`, `scripts/verify-receipt.mjs`, `scripts/verify-settlement.mjs`, chữ gợi ý trong `src/lib/i18n/ui-gold.ts`.

- [ ] **Step 1: Test** — thay test SG trong `reference-data.test.ts` bằng:

```ts
  it('calls every gold type what the Dashboard calls it', async () => {
    // Renamed on 17-09-2026: Scrap Gold in 0081, the rest in 0085.
    const g = await db.query<{ name_vi: string }>(
      `SELECT name_vi FROM pc49.gold_type ORDER BY sort_order`)
    expect(g.rows.map((r) => r.name_vi)).toEqual([
      'Rong Phung', '9999', 'Maple Leaf', 'Credit Suisse', 'American Eagle', 'Other',
      'Scrap Gold', 'Grain', 'PT',
    ])
    const a = await db.query<{ code: string; name_vi: string }>(
      `SELECT code, name_vi FROM pc49.account
        WHERE gold_type_code IN ('RP', 'SG', 'PT') ORDER BY code`)
    expect(a.rows).toEqual([
      { code: '155PT', name_vi: 'NVL PT' },
      { code: '155SG', name_vi: 'NVL Scrap Gold' },
      { code: '156RP', name_vi: 'Hàng hoá Rong Phung' },
      { code: '157PT', name_vi: 'Hàng gửi đi PT' },
      { code: '157RP', name_vi: 'Hàng gửi đi Rong Phung' },
      { code: '157SG', name_vi: 'Hàng gửi đi Scrap Gold' },
      { code: '632PT', name_vi: 'Giá vốn PT' },
      { code: '632RP', name_vi: 'Giá vốn Rong Phung' },
      { code: '632SG', name_vi: 'Giá vốn Scrap Gold' },
    ])
  })
```

- [ ] **Step 2: Đỏ** — `npx vitest run tests/sql/reference-data.test.ts`

- [ ] **Step 3: Migration**

```sql path=supabase/migrations/0085_gold_is_named_as_on_the_dashboard.sql
-- 0085_gold_is_named_as_on_the_dashboard.sql
-- Every gold type is called what the shop calls it.
--
-- "Đổi tên các loại vàng theo quy ước hiện tại" (17-09-2026). The Vietnamese
-- names were written for this system: Rồng Phụng, Vàng 9999, Vàng khác, Vàng
-- Grain, Bạch kim. The shop's own sheet — the Description column of the
-- Dashboard, which the loader reads (scripts/lib/sheet-map.mjs) — calls them
-- Rong Phung, 9999, Other, Grain and PT, and so do the people typing. 0081 did
-- this for Scrap Gold; this does the rest, and the accounts named after each.
--
-- Only names. The codes stay, so nothing written against a type changes.

UPDATE pc49.gold_type g SET name_vi = v.name
  FROM (VALUES ('RP', 'Rong Phung'), ('9999', '9999'), ('ML', 'Maple Leaf'),
               ('CS', 'Credit Suisse'), ('AE', 'American Eagle'), ('OTH', 'Other'),
               ('SG', 'Scrap Gold'), ('GRAIN', 'Grain'), ('PT', 'PT')) AS v(code, name)
 WHERE g.code = v.code;

-- Cost of sales, raw material, goods and goods sent out, each after its gold.
UPDATE pc49.account a
   SET name_vi = CASE left(a.code, 3)
                   WHEN '632' THEN 'Giá vốn '
                   WHEN '155' THEN 'NVL '
                   WHEN '156' THEN 'Hàng hoá '
                   WHEN '157' THEN 'Hàng gửi đi '
                 END || g.name_vi
  FROM pc49.gold_type g
 WHERE a.gold_type_code = g.code
   AND left(a.code, 3) IN ('632', '155', '156', '157');

INSERT INTO pc49.schema_migrations (version) VALUES ('0085_gold_is_named_as_on_the_dashboard')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Tên trong script và gợi ý** — `verify-conversion.mjs`: `'Rồng Phụng'`→`'Rong Phung'`, `'Vàng khác'`→`'Other'`, `'Vàng Grain'`→`'Grain'`; `verify-receipt.mjs`, `verify-settlement.mjs`: `'Vàng Grain'`→`'Grain'`. `ui-gold.ts` vi: `'conversion.raRpHint': 'Ra RP: Grain ra, Rong Phung vào.'`, `'conversion.err.raRp': 'Ra RP chỉ có Grain ra và Rong Phung vào.'`.

- [ ] **Step 5: Xanh, commit** — `git commit -m "feat(reference): every gold type is named as on the Dashboard"`

---

### Task 2: Đặt cọc không cần tiền, báo cáo đơn cọc theo dữ liệu thật (0086)

**Files:** Create `supabase/migrations/0086_a_deposit_may_be_taken_without_money.sql`, `tests/sql/deposit-pickup.test.ts` (phần đặt cọc và báo cáo); Modify `tests/sql/receipt-owed.test.ts` (test "still refuses a deposit…").

**Interfaces:**
- Produces: `pc49.txn_paid(uuid) → numeric`, `pc49.deposit_order_value(uuid) → numeric|null`; `post_gold_txn` trả null cho phiếu cọc không tiền; `gold_receipt_owed` của PICKUP trừ tiền cọc; `v_deposit_status` cột cũ, nghĩa theo spec.

- [ ] **Step 1: `receipt-owed.test.ts`** — thay test `it('still refuses a deposit taken without its deposit', …)` bằng:

```ts
  it('saves a deposit taken without money, with nothing on the books', async () => {
    const saved = await save('deposit-unpaid', receiptPayload({
      partnerCode: 'DEP0', txnType: 'DEPOSIT', payments: [],
      lines: [{ itemDesc: 'RP', goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5000,
                amount: 5000, scrapDetail: null, goldPct: null }],
    }))
    const r = await db.query<{ entry: string | null }>(
      `SELECT journal_entry_id::text AS entry FROM pc49.gold_txn WHERE receipt_id = $1`,
      [saved.receiptId])
    expect(r.rows).toEqual([{ entry: null }])
  })
```

- [ ] **Step 2: Test đặt cọc** — tạo `tests/sql/deposit-pickup.test.ts` (toàn bộ file ở Task 3; Task 2 chỉ cần các describe `a deposit` chạy xanh).

- [ ] **Step 3: Migration**

```sql path=supabase/migrations/0086_a_deposit_may_be_taken_without_money.sql
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
```

- [ ] **Step 4: Xanh, commit** — `git commit -m "feat(deposit): a deposit is taken with any money or none, and the report reads deposits as stored"`

---

### Task 3: Lấy hàng từ phiếu cọc, và sổ biết cọc/lấy (0087)

**Files:** Create `supabase/migrations/0087_a_pickup_is_taken_from_its_deposit.sql`, `tests/sql/deposit-pickup.test.ts`.

**Interfaces:**
- Produces:
  - `pc49.save_gold_pickup(p_request_key text, p_deposit uuid, p_payload jsonb) → {receiptId, docNo, repeated}`, payload `{pickupDate, orderValue?, payments[{amount, method}], remarks}`
  - `pc49.gold_receipt_deposit(uuid) → jsonb|null`: `{role:'deposit', orderValue, paid, settledBy, pickupDate, pickupDoc}` hoặc `{role:'pickup', orderValue, paid, depositDate, depositDoc}`
  - `gold_receipt_ledger` thêm cột `deposit jsonb` (sau `owed`)
  - `write_gold_transaction` nhận `depositRefId`

- [ ] **Step 1: Test**

```ts path=tests/sql/deposit-pickup.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'
import { receiptPayload } from '../support/receipt'

// "Khi pickup không chỉnh sửa được trạng thái từ deposit sang pickup … Chị có
// thử tạo đơn pickup riêng nhưng không lưu được" (17-09-2026): a deposit is
// taken with any money or none (0086), and picked up from itself (0087).

let db: PGlite
const KT = '11111111-1111-1111-1111-111111111111'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'accountant@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
  `)
}, 60_000)

afterAll(async () => { await db?.close() })

type Saved = { receiptId: string; docNo: string; repeated?: boolean }

async function save(key: string, body: string): Promise<Saved> {
  const r = await asRole(db, KT, () => db.query<{ r: Saved }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

async function pickUp(key: string, deposit: string, payload: Record<string, unknown>): Promise<Saved> {
  const r = await asRole(db, KT, () => db.query<{ r: Saved }>(
    `SELECT pc49.save_gold_pickup($1, $2, $3::jsonb) AS r`,
    [key, deposit, JSON.stringify({ remarks: null, payments: [], ...payload })]))
  return r.rows[0].r
}

async function cancel(key: string) {
  await asRole(db, KT, () => db.query(`SELECT pc49.void_gold_receipt($1, 'nhap nham')`, [key]))
}

/** One luong of Rong Phung ordered at 5,300.00, with `paid` put down in cash. */
const depositOf = (partnerCode: string, paid: number, over: Record<string, unknown> = {}) =>
  receiptPayload({
    txnDate: '2026-06-02', txnType: 'DEPOSIT', partnerCode,
    lines: [{ itemDesc: 'RP 1 luong', goldTypeCode: 'RP', uom: 'LUONG', qty: -1,
              unitPrice: 5300, amount: 5300, scrapDetail: null, goldPct: null }],
    payments: paid > 0 ? [{ amount: paid, method: 'CASH' }] : [],
    ...over,
  })

async function lineOf(receiptId: string) {
  const r = await db.query<{
    id: string; txn_type: string; txn_date: string; qty: number; amount: number
    unit_price: number | null; entry: string | null; ref: string | null
  }>(
    `SELECT id::text, txn_type::text, txn_date::text, qty::float8 AS qty, amount::float8 AS amount,
            unit_price::float8 AS unit_price, journal_entry_id::text AS entry,
            deposit_ref_id::text AS ref
       FROM pc49.gold_txn WHERE receipt_id = $1`, [receiptId])
  return r.rows[0]
}

async function entryLines(entry: string) {
  const r = await db.query<{ dr: string | null; cr: string | null; amount: number }>(
    `SELECT debit_account AS dr, credit_account AS cr, amount_usd::float8 AS amount
       FROM pc49.journal_line WHERE entry_id = $1 ORDER BY seq`, [entry])
  return r.rows
}

async function held(txnId: string) {
  const r = await db.query<{ bucket: string; g: number }>(
    `SELECT bucket::text, sum(qty_gram)::float8 AS g FROM pc49.inventory_movement
      WHERE source_id = $1 GROUP BY bucket ORDER BY bucket`, [txnId])
  return Object.fromEntries(r.rows.map((x) => [x.bucket, x.g]))
}

async function report(depositTxn: string) {
  const r = await db.query<{
    deposit_amount: number; order_amount: number | null; paid_amount: number
    remaining_amount: number | null; settled_by: string | null; settled_date: string | null
  }>(
    `SELECT deposit_amount::float8, order_amount::float8, paid_amount::float8,
            remaining_amount::float8, settled_by, settled_date::text
       FROM pc49.v_deposit_status WHERE id = $1`, [depositTxn])
  return r.rows[0]
}

const owed = async (key: string) => Number((await db.query<{ o: string }>(
  `SELECT pc49.gold_receipt_owed($1)::text AS o`, [key])).rows[0].o)

const depositInfo = async (key: string) => (await db.query<{ d: Record<string, unknown> | null }>(
  `SELECT pc49.gold_receipt_deposit($1) AS d`, [key])).rows[0].d

describe('a deposit', () => {
  it('takes money against an order at the agreed price, and sets the gold aside', async () => {
    const saved = await save('dep-1', depositOf('DEP1', 1000))
    const line = await lineOf(saved.receiptId)
    expect(line).toMatchObject({ txn_type: 'DEPOSIT', qty: -1, amount: 5300, unit_price: 5300 })
    expect(await entryLines(line.entry!)).toEqual([{ dr: '1111', cr: '131', amount: 1000 }])
    expect(await held(line.id)).toEqual({ DEPOSIT_HELD: 37.5, ON_HAND: -37.5 })
  })

  it('is taken without money, with nothing on the books but the gold set aside', async () => {
    const saved = await save('dep-0', depositOf('DEP0', 0))
    const line = await lineOf(saved.receiptId)
    expect(line.entry).toBeNull()
    expect(await held(line.id)).toEqual({ DEPOSIT_HELD: 37.5, ON_HAND: -37.5 })
  })

  it('reads in the deposits report as the money down, the order and what is left', async () => {
    const saved = await save('dep-report', depositOf('DEPREPORT', 1000))
    expect(await report((await lineOf(saved.receiptId)).id)).toMatchObject({
      deposit_amount: 1000, order_amount: 5300, paid_amount: 1000, remaining_amount: 4300,
      settled_by: null,
    })
  })

  it('reads an order loaded from the sheet the same way', async () => {
    // As the loader writes one: the deposit at nothing with its money as a
    // payment, the pickup at the whole order with the balance as a payment.
    const d = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code)
       VALUES ('2026-01-10', 'DEPOSIT', 'RP', 'LUONG', -1, 0, 'Kelvin Tran') RETURNING id`)
    await db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                    VALUES ($1, 1, 'AR', 2000, 'CASH')`, [d.rows[0].id])
    const p = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code,
                                  deposit_ref_id)
       VALUES ('2026-01-28', 'PICKUP', 'RP', 'LUONG', -1, 5310, 'Kelvin Tran', $1) RETURNING id`,
      [d.rows[0].id])
    await db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                    VALUES ($1, 1, 'AR', 3310, 'CASH')`, [p.rows[0].id])
    expect(await report(d.rows[0].id)).toEqual({
      deposit_amount: 2000, order_amount: 5310, paid_amount: 5310, remaining_amount: 0,
      settled_by: 'PICKUP', settled_date: '2026-01-28',
    })
  })
})

describe('picking up a deposit', () => {
  let deposit: Saved
  let pickup: Saved

  beforeAll(async () => {
    deposit = await save('pick-dep', depositOf('PICK', 1000))
    pickup = await pickUp('pick-1', deposit.receiptId,
      { pickupDate: '2026-06-10', payments: [{ amount: 4300, method: 'CASH' }] })
  })

  it('records the pickup on its own day, under its own number, pointing at the deposit', async () => {
    const line = await lineOf(pickup.receiptId)
    const dep = await lineOf(deposit.receiptId)
    expect(line).toMatchObject({
      txn_type: 'PICKUP', txn_date: '2026-06-10', qty: -1, amount: 5300, unit_price: 5300, ref: dep.id,
    })
    expect(pickup.docNo).not.toBe(deposit.docNo)
    const who = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pc49.gold_txn_sales_person WHERE txn_id = $1`, [line.id])
    expect(who.rows[0].n).toBe(2)
  })

  it('books the whole order as revenue, and the customer owes nothing', async () => {
    const line = await lineOf(pickup.receiptId)
    expect(await entryLines(line.entry!)).toEqual([
      { dr: '131', cr: '511', amount: 5300 },
      { dr: '1111', cr: '131', amount: 4300 },
    ])
    expect(await owed(pickup.receiptId)).toBe(0)
    expect(await report((await lineOf(deposit.receiptId)).id)).toMatchObject({
      paid_amount: 5300, remaining_amount: 0, settled_by: 'PICKUP', settled_date: '2026-06-10',
    })
  })

  it('leaves what was not paid at pickup owed, to be paid later', async () => {
    const d = await save('short-dep', depositOf('SHORT', 1000))
    const p = await pickUp('short-1', d.receiptId,
      { pickupDate: '2026-06-11', payments: [{ amount: 2000, method: 'CASH' }] })
    expect(await owed(p.receiptId)).toBe(2300)
    await asRole(db, KT, () => db.query(
      `SELECT pc49.save_receipt_settlement('short-later', $1, $2::jsonb)`,
      [p.receiptId, JSON.stringify({ payDate: '2026-06-15', amount: 2300, method: 'ZELLE', note: null })]))
    expect(await owed(p.receiptId)).toBe(0)
  })

  it('picks up a deposit taken without money, the whole order paid then', async () => {
    const d = await save('free-dep', depositOf('FREE', 0))
    const p = await pickUp('free-1', d.receiptId,
      { pickupDate: '2026-06-12', payments: [{ amount: 5300, method: 'CASH' }] })
    expect(await owed(p.receiptId)).toBe(0)
  })

  it('is one pickup however many times it is sent', async () => {
    const d = await save('twice-dep', depositOf('TWICE', 500))
    const payload = { pickupDate: '2026-06-12', payments: [{ amount: 4800, method: 'CASH' }] }
    const first = await pickUp('twice-1', d.receiptId, payload)
    const again = await pickUp('twice-1', d.receiptId, payload)
    expect(again).toEqual({ receiptId: first.receiptId, docNo: first.docNo, repeated: true })
    await expect(pickUp('twice-1', d.receiptId, { ...payload, remarks: 'khac' }))
      .rejects.toThrow(/REQUEST_KEY_REUSED/)
  })

  it('is refused for a deposit already picked up, and says when', async () => {
    await expect(pickUp('again', deposit.receiptId, { pickupDate: '2026-06-20' }))
      .rejects.toThrow(/PICKUP_TAKEN: 2026-06-10/)
  })

  it('is refused on a day before the deposit', async () => {
    const d = await save('early-dep', depositOf('EARLY', 100))
    await expect(pickUp('early-1', d.receiptId, { pickupDate: '2026-06-01' }))
      .rejects.toThrow(/PICKUP_DATE: deposit 2026-06-02/)
  })

  it('is refused for something that is not a deposit', async () => {
    const sale = await save('a-sale', receiptPayload({
      txnType: 'SALE', partnerCode: 'SALE',
      lines: [{ itemDesc: 'RP', goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5300,
                amount: 5300, scrapDetail: null, goldPct: null }],
      payments: [{ amount: 5300, method: 'CASH' }],
    }))
    await expect(pickUp('sale-pick', sale.receiptId, { pickupDate: '2026-06-03' }))
      .rejects.toThrow(/PICKUP_NOT_DEPOSIT/)
  })

  it('is refused for a cancelled deposit', async () => {
    const d = await save('gone-dep', depositOf('GONE', 100))
    await cancel(d.receiptId)
    await expect(pickUp('gone-pick', d.receiptId, { pickupDate: '2026-06-03' }))
      .rejects.toThrow(/RECEIPT_VOIDED/)
  })

  it('asks for the order’s value when the deposit never had a price', async () => {
    const d = await save('no-price', depositOf('NOPRICE', 500, {
      lines: [{ itemDesc: 'RP', goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: null,
                amount: 0, scrapDetail: null, goldPct: null }],
    }))
    await expect(pickUp('no-price-1', d.receiptId, { pickupDate: '2026-06-03' }))
      .rejects.toThrow(/PICKUP_NO_PRICE/)
    const p = await pickUp('no-price-2', d.receiptId,
      { pickupDate: '2026-06-03', orderValue: 5000, payments: [{ amount: 4500, method: 'CASH' }] })
    expect(await lineOf(p.receiptId)).toMatchObject({ amount: 5000, unit_price: null })
    expect(await owed(p.receiptId)).toBe(0)
  })
})

describe('a deposit and its pickup together', () => {
  it('says on each the other’s day and number', async () => {
    const d = await save('pair-dep', depositOf('PAIR', 1000))
    const p = await pickUp('pair-1', d.receiptId,
      { pickupDate: '2026-06-09', payments: [{ amount: 4300, method: 'CASH' }] })
    expect(await depositInfo(d.receiptId)).toEqual({
      role: 'deposit', orderValue: 5300, paid: 1000,
      settledBy: 'PICKUP', pickupDate: '2026-06-09', pickupDoc: p.docNo,
    })
    expect(await depositInfo(p.receiptId)).toEqual({
      role: 'pickup', orderValue: 5300, paid: 1000, depositDate: '2026-06-02', depositDoc: d.docNo,
    })
    const row = await db.query<{ deposit: Record<string, unknown> }>(
      `SELECT deposit FROM pc49.gold_receipt_ledger(p_query => 'PAIR') WHERE receipt_key = $1`,
      [d.receiptId])
    expect(row.rows[0].deposit).toMatchObject({ role: 'deposit', pickupDoc: p.docNo })
  })

  it('opens the deposit again when its pickup is cancelled', async () => {
    const d = await save('reopen-dep', depositOf('REOPEN', 1000))
    const p = await pickUp('reopen-1', d.receiptId, { pickupDate: '2026-06-09' })
    await cancel(p.receiptId)
    expect(await depositInfo(d.receiptId)).toMatchObject({ settledBy: null, pickupDate: null })
    await pickUp('reopen-2', d.receiptId, { pickupDate: '2026-06-10' })
  })

  it('does not cancel a deposit whose pickup stands', async () => {
    const d = await save('keep-dep', depositOf('KEEPDEP', 1000))
    await pickUp('keep-1', d.receiptId, { pickupDate: '2026-06-09' })
    await expect(cancel(d.receiptId)).rejects.toThrow(/DEPOSIT_PICKED_UP/)
  })
})
```

- [ ] **Step 2: Đỏ** — `npx vitest run tests/sql/deposit-pickup.test.ts`

- [ ] **Step 3: Migration**

```sql path=supabase/migrations/0087_a_pickup_is_taken_from_its_deposit.sql
-- 0087_a_pickup_is_taken_from_its_deposit.sql
-- The customer comes back for the gold: the pickup is written from its deposit.
--
--   "Khi pickup không chỉnh sửa được trạng thái từ deposit sang pickup, cũng
--    chưa có trường dữ liệu để phân biệt ngày nào đặt cọc, ngày nào pickup.
--    Chị có thử tạo đơn pickup riêng nhưng không lưu được" (17-09-2026)
--
-- A pickup has always had to name its deposit (0013), and the entry screen
-- offered PICKUP with nowhere to name one, so it could only fail. A pickup is
-- now made from the deposit's row: the same customer, gold, quantity, agreed
-- price and people, on the day it happens, under a number of its own, with
-- whatever was handed over then. Its amount is the whole order, as the loader
-- writes one and as 0015 posts it; what was put down at the deposit is taken
-- off what it owes (0086).
--
--   write_gold_transaction  0073's body, also taking the deposit a pickup settles
--   save_gold_pickup        the pickup, safely retried
--   gold_receipt_deposit    on a deposit's row, whether and when it was picked
--                           up; on a pickup's, when the deposit was taken
--   gold_receipt_ledger     returns that, after what is owed
--
-- The refusals begin with a code the screen translates:
--
--   PICKUP_NOT_DEPOSIT  what was named is not a deposit
--   PICKUP_TAKEN        the deposit was already picked up or cancelled, on that day
--   PICKUP_DATE         picked up before the deposit was taken
--   PICKUP_NO_PRICE     nobody recorded what the order comes to, and it was not given

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
     doc_no, receipt_id, line_no, item_desc, deposit_ref_id)
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
    nullif(btrim(coalesce(p_payload ->> 'itemDesc', '')), ''),
    nullif(p_payload ->> 'depositRefId', '')::uuid)
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

CREATE OR REPLACE FUNCTION pc49.save_gold_pickup(
  p_request_key text,
  p_deposit     uuid,
  p_payload     jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_hash    text := md5(p_deposit::text || p_payload::text);
  v_seen    pc49.request_outcome;
  d         pc49.gold_txn;
  v_settled pc49.gold_txn;
  v_date    date := nullif(p_payload ->> 'pickupDate', '')::date;
  v_order   numeric;
  v_who     jsonb;
  v_doc     text;
  v_receipt uuid;
  v_made    jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  IF btrim(coalesce(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'a pickup needs a request key so that retrying it is safe';
  END IF;

  SELECT * INTO v_seen FROM pc49.request_outcome
   WHERE actor = v_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_seen.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'REQUEST_KEY_REUSED: this request key was already used for different data';
    END IF;
    RETURN pc49.receipt_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  -- The deposit, by the ledger's key, locked so two people cannot both hand
  -- the same order over.
  SELECT t.* INTO d FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_deposit OR (t.id = p_deposit AND t.receipt_id IS NULL))
     AND t.voided_at IS NULL
   ORDER BY coalesce(t.line_no, 1)
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM pc49.gold_receipt WHERE id = p_deposit)
       OR EXISTS (SELECT 1 FROM pc49.gold_txn WHERE id = p_deposit) THEN
      RAISE EXCEPTION 'RECEIPT_VOIDED: this receipt has already been cancelled';
    END IF;
    RAISE EXCEPTION 'there is no such deposit';
  END IF;

  IF d.txn_type <> 'DEPOSIT' THEN
    RAISE EXCEPTION 'PICKUP_NOT_DEPOSIT: only a deposit is picked up, not a %', d.txn_type;
  END IF;

  SELECT * INTO v_settled FROM pc49.gold_txn
   WHERE deposit_ref_id = d.id AND voided_at IS NULL LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'PICKUP_TAKEN: %; this deposit was already settled by a %',
      v_settled.txn_date, v_settled.txn_type;
  END IF;

  IF v_date IS NULL THEN RAISE EXCEPTION 'a pickup needs the day it happened'; END IF;
  IF v_date < d.txn_date THEN
    RAISE EXCEPTION 'PICKUP_DATE: deposit %, picked up %; a pickup cannot come before its deposit',
      d.txn_date, v_date;
  END IF;

  v_order := coalesce(pc49.deposit_order_value(d.id),
                      round(nullif(p_payload ->> 'orderValue', '')::numeric, 2));
  IF v_order IS NULL OR v_order <= 0 THEN
    RAISE EXCEPTION 'PICKUP_NO_PRICE: nobody recorded what this order comes to; say what it does';
  END IF;

  -- The people credited with the deposit are credited with its collection.
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', s.sales_person_code, 'sharePct', s.share_pct)),
                  '[]'::jsonb)
    INTO v_who
    FROM pc49.gold_txn_sales_person s WHERE s.txn_id = d.id;

  v_doc := pc49.next_doc_no(v_date);

  INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type, partner_code, remarks, created_by, updated_by)
  VALUES (v_doc, v_date, 'PICKUP', d.partner_code, nullif(p_payload ->> 'remarks', ''), v_actor, v_actor)
  RETURNING id INTO v_receipt;

  v_made := pc49.write_gold_transaction(jsonb_build_object(
    'txnDate',      v_date,
    'txnType',      'PICKUP',
    'goldTypeCode', d.gold_type_code,
    'uom',          d.uom,
    'qty',          -abs(d.qty),
    -- The agreed price only where it is what the order comes to; a deposit with
    -- no price is collected at the value given, with no price.
    'unitPrice',    CASE WHEN d.unit_price IS NOT NULL
                          AND round(abs(d.qty) * d.unit_price, 2) = v_order THEN d.unit_price END,
    'amount',       v_order,
    'scrapDetail',  d.scrap_detail,
    'goldPct',      d.gold_pct,
    'itemDesc',     d.item_desc,
    'partnerCode',  d.partner_code,
    'remarks',      p_payload -> 'remarks',
    'salesPeople',  v_who,
    'payments',     coalesce(p_payload -> 'payments', '[]'::jsonb),
    'docNo',        v_doc,
    'receiptId',    v_receipt,
    'lineNo',       1,
    'depositRefId', d.id));

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_pickup', v_hash, (v_made ->> 'txnId')::uuid);

  RETURN jsonb_build_object('receiptId', v_receipt, 'docNo', v_doc, 'repeated', false);
END $$;

/**
 * A deposit's order and its collection, for the ledger row of either.
 *
 * On a deposit: what the order comes to, what was put down, and — once it is
 * settled — by what, on which day, under which number. On a pickup: the same
 * order, and when and under which number the deposit was taken. Null on
 * anything else.
 */
CREATE OR REPLACE FUNCTION pc49.gold_receipt_deposit(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN f.txn_type = 'DEPOSIT' THEN jsonb_build_object(
      'role', 'deposit',
      'orderValue', pc49.deposit_order_value(f.id),
      'paid', pc49.txn_paid(f.id),
      'settledBy', s.txn_type,
      'pickupDate', s.txn_date,
      'pickupDoc', s.doc_no)
    WHEN f.txn_type = 'PICKUP' AND d.id IS NOT NULL THEN jsonb_build_object(
      'role', 'pickup',
      'orderValue', abs(f.amount),
      'paid', pc49.txn_paid(d.id),
      'depositDate', d.txn_date,
      'depositDoc', d.doc_no)
  END
    FROM (SELECT t.* FROM pc49.gold_txn t
           WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
             AND t.voided_at IS NULL
           ORDER BY coalesce(t.line_no, 1)
           LIMIT 1) f
    LEFT JOIN pc49.gold_txn s ON f.txn_type = 'DEPOSIT' AND s.deposit_ref_id = f.id AND s.voided_at IS NULL
    LEFT JOIN pc49.gold_txn d ON d.id = f.deposit_ref_id
$$;

-- The row gains a column, and a function's result cannot be changed in place.
DROP FUNCTION IF EXISTS pc49.gold_receipt_ledger(date, date, text, text, text, text, text, text, int, int);

CREATE FUNCTION pc49.gold_receipt_ledger(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_gold   text DEFAULT NULL,
  p_staff  text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_query  text DEFAULT NULL,
  p_limit  int  DEFAULT 50,
  p_offset int  DEFAULT 0)
RETURNS TABLE (
  receipt_key uuid, receipt_id uuid, txn_date date, doc_no text, txn_type text,
  partner_code text, partner_phone text, sales_person_code text, remarks text,
  revision int, blocked_code text, amount numeric, line_count int,
  lines jsonb, payments jsonb, sold_by jsonb,
  conversion_id uuid, conversion_kind text, variance_note text, variance_reason text,
  settlements jsonb, owed numeric, deposit jsonb,
  total_count bigint)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH hit AS (
    SELECT coalesce(t.receipt_id, t.conversion_id, t.id) AS k,
           max(t.txn_date) AS txn_date,
           min(t.doc_no) AS doc_no,
           max(t.created_at) AS created_at
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
     GROUP BY coalesce(t.receipt_id, t.conversion_id, t.id)
  ),
  page AS (
    SELECT h.*, count(*) OVER () AS matched
      FROM hit h
     ORDER BY h.txn_date DESC, h.doc_no DESC NULLS LAST, h.created_at DESC, h.k
     LIMIT p_limit OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT p.k, r.id, p.txn_date, coalesce(r.doc_no, c.doc_no, p.doc_no), f.txn_type::text,
         CASE WHEN c.doc_no IS NOT NULL THEN c.partner_code ELSE f.partner_code END,
         pa.phone, f.sales_person_code,
         CASE WHEN c.doc_no IS NOT NULL THEN c.note ELSE f.remarks END,
         coalesce(r.revision, c.revision, f.revision),
         pc49.gold_receipt_blocked_code(p.k),
         (SELECT coalesce(sum((x ->> 'amount')::numeric), 0)
            FROM jsonb_array_elements(ln.lines) x),
         jsonb_array_length(ln.lines),
         ln.lines,
         pc49.gold_receipt_payments(p.k),
         pc49.gold_receipt_sold_by(p.k),
         c.id, c.kind::text, c.variance_note, c.variance_reason,
         pc49.gold_receipt_settlements(p.k),
         pc49.gold_receipt_owed(p.k),
         pc49.gold_receipt_deposit(p.k),
         p.matched
    FROM page p
    CROSS JOIN LATERAL (SELECT pc49.gold_receipt_lines(p.k) AS lines) ln
    JOIN LATERAL (SELECT t.* FROM pc49.gold_txn t
                   WHERE (t.receipt_id = p.k OR t.conversion_id = p.k
                          OR (t.id = p.k AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
                     AND t.voided_at IS NULL
                   ORDER BY CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END,
                            coalesce(t.line_no, 1), t.created_at, t.id
                   LIMIT 1) f ON true
    LEFT JOIN pc49.gold_receipt r ON r.id = p.k
    LEFT JOIN pc49.gold_conversion c ON c.id = p.k
    LEFT JOIN pc49.partner pa
      ON pa.code = CASE WHEN c.doc_no IS NOT NULL THEN c.partner_code ELSE f.partner_code END
   ORDER BY p.txn_date DESC, p.doc_no DESC NULLS LAST, p.created_at DESC, p.k
$$;

GRANT EXECUTE ON FUNCTION pc49.save_gold_pickup(text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_deposit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0087_a_pickup_is_taken_from_its_deposit')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Xanh; cả bộ SQL; commit** — `git commit -m "feat(deposit): a pickup is taken from its deposit, and each row says the other's day"`

---

### Task 4: Đọc cọc/lấy trên dòng sổ, câu báo lỗi, dấu số lượng

**Files:**
- Create: `src/components/gold/pickup.ts`, `tests/lib/pickup.test.ts`
- Modify: `types.ts` (`DepositInfo`, `ReceiptRow.deposit?`), `ledgerRow.ts`, `receiptErrors.ts`, `receiptLine.ts` (DEPOSIT tự dấu), `ui-gold.ts`, `dictionary.ts` (câu khoá DEPOSIT_PICKUP/PICKED_UP)
- Test: `tests/lib/receipt-row.test.ts`, `receipt-errors.test.ts`, `receipt-line.test.ts`

**Interfaces:**
- `type DepositInfo = { role: 'deposit' | 'pickup'; orderValue: number | null; paid: number; settledBy: string | null; pickupDate: string | null; pickupDoc: string | null; depositDate: string | null; depositDoc: string | null }`
- `canPickUp(row: Pick<ReceiptRow, 'deposit' | 'conversion'>): boolean`, `leftToPay(info: Pick<DepositInfo, 'orderValue' | 'paid'>): number | null`

- [ ] **Step 1: Test mới**

```ts path=tests/lib/pickup.test.ts
import { describe, it, expect } from 'vitest'
import { canPickUp, leftToPay } from '@/components/gold/pickup'
import type { DepositInfo } from '@/components/gold/types'

const info = (over: Partial<DepositInfo> = {}): DepositInfo => ({
  role: 'deposit', orderValue: 5300, paid: 1000, settledBy: null, pickupDate: null,
  pickupDoc: null, depositDate: null, depositDoc: null, ...over,
})

describe('picking up a deposit', () => {
  it('is offered on a deposit nobody has collected or cancelled', () => {
    expect(canPickUp({ deposit: info(), conversion: null })).toBe(true)
  })

  it('is not offered once settled, on a pickup, or on anything else', () => {
    expect(canPickUp({ deposit: info({ settledBy: 'PICKUP' }), conversion: null })).toBe(false)
    expect(canPickUp({ deposit: info({ settledBy: 'CANCEL' }), conversion: null })).toBe(false)
    expect(canPickUp({ deposit: info({ role: 'pickup' }), conversion: null })).toBe(false)
    expect(canPickUp({ deposit: null, conversion: null })).toBe(false)
  })

  it('leaves the order less what was put down to pay, never below nothing', () => {
    expect(leftToPay(info())).toBe(4300)
    expect(leftToPay(info({ paid: 6000 }))).toBe(0)
    expect(leftToPay(info({ orderValue: 0.3, paid: 0.1 }))).toBe(0.2)
  })

  it('cannot say what is left when nobody recorded the order’s value', () => {
    expect(leftToPay(info({ orderValue: null }))).toBeNull()
  })
})
```

- [ ] **Step 2: Thêm test**
  - `receipt-row.test.ts`:

```ts
describe('a deposit and its pickup on the ledger', () => {
  it('reads what the order comes to, what was put down, and when it was collected', () => {
    const row = toReceiptRow({
      receipt_key: 'd1', txn_date: '2026-09-08', txn_type: 'DEPOSIT', lines: [], payments: [], sold_by: [],
      deposit: { role: 'deposit', orderValue: '5300.00', paid: '1000.00', settledBy: 'PICKUP',
                 pickupDate: '2026-09-15', pickupDoc: 'PC49-2609-020' },
    })
    expect(row.deposit).toEqual({
      role: 'deposit', orderValue: 5300, paid: 1000, settledBy: 'PICKUP', pickupDate: '2026-09-15',
      pickupDoc: 'PC49-2609-020', depositDate: null, depositDoc: null,
    })
    expect(toReceiptRow({ receipt_key: 'x', txn_date: '2026-09-08', txn_type: 'SALE', lines: [],
      payments: [], sold_by: [] }).deposit).toBeNull()
  })
})
```

  - `receipt-errors.test.ts` (trước `passes anything else through`):

```ts
  it('says what is wrong with a pickup', () => {
    expect(describeRefusal('PICKUP_NOT_DEPOSIT: only a deposit …', say)).toBe(say('pickup.err.notDeposit'))
    expect(describeRefusal('PICKUP_TAKEN: 2026-06-10; this deposit …', say))
      .toBe(say('pickup.err.taken').replace('{0}', '2026-06-10'))
    expect(describeRefusal('PICKUP_DATE: deposit 2026-06-02, picked up …', say))
      .toBe(say('pickup.err.date').replace('{0}', '2026-06-02'))
    expect(describeRefusal('PICKUP_NO_PRICE: nobody recorded …', say)).toBe(say('pickup.err.noPrice'))
  })
```

  - `receipt-line.test.ts`: thêm `it('signs a deposit the way it signs a sale', () => { expect(signedQty('DEPOSIT', 1)).toBe(-1); expect(signFollowsType('DEPOSIT')).toBe(true) })` (import `signedQty`, `signFollowsType` nếu chưa có).

- [ ] **Step 3: Đỏ** — `npx vitest run tests/lib/pickup.test.ts tests/lib/receipt-row.test.ts tests/lib/receipt-errors.test.ts tests/lib/receipt-line.test.ts`

- [ ] **Step 4: `pickup.ts`**

```ts path=src/components/gold/pickup.ts
import type { DepositInfo, ReceiptRow } from './types'

/**
 * A deposit's collection (spec 2026-09-17, 0087).
 *
 * Pure: what the ledger row and the pickup form both need to agree on.
 */

/** Whether a row offers "Lấy hàng": a deposit nobody has collected or cancelled. */
export function canPickUp(row: Pick<ReceiptRow, 'deposit' | 'conversion'>): boolean {
  return !row.conversion && row.deposit?.role === 'deposit' && !row.deposit.settledBy
}

/** What is left to pay when the gold is collected; null when nobody recorded the order's value. */
export function leftToPay(info: Pick<DepositInfo, 'orderValue' | 'paid'>): number | null {
  if (info.orderValue === null) return null
  return Math.max(Math.round((info.orderValue - info.paid) * 100) / 100, 0)
}
```

- [ ] **Step 5: `types.ts`** — trước `ReceiptRow`:

```ts
/** A deposit's order and its collection, on the row of either (0087). */
export type DepositInfo = {
  role: 'deposit' | 'pickup'
  /** What the order comes to; null when nobody recorded it. */
  orderValue: number | null
  /** What was put down with the deposit. */
  paid: number
  /** On a deposit: PICKUP or CANCEL once settled, and when, under which number. */
  settledBy: string | null
  pickupDate: string | null
  pickupDoc: string | null
  /** On a pickup: when the deposit was taken, under which number. */
  depositDate: string | null
  depositDoc: string | null
}
```

và trong `ReceiptRow`: `/** Set on a deposit or a pickup (0087). */ deposit?: DepositInfo | null`.

- [ ] **Step 6: `ledgerRow.ts`** — sau `owed: …`:

```ts
    deposit: r.deposit ? toDepositInfo(r.deposit as Record<string, unknown>) : null,
```

và thêm hàm:

```ts
function toDepositInfo(d: Record<string, unknown>): DepositInfo {
  return {
    role: d.role === 'pickup' ? 'pickup' : 'deposit',
    orderValue: figure(d.orderValue),
    paid: Number(d.paid ?? 0),
    settledBy: text(d.settledBy),
    pickupDate: text(d.pickupDate),
    pickupDoc: text(d.pickupDoc),
    depositDate: text(d.depositDate),
    depositDoc: text(d.depositDoc),
  }
}
```

(import `DepositInfo`).

- [ ] **Step 7: `receiptErrors.ts`** — sau khối SETTLEMENT:

```ts
  // A pickup's refusals (0087).
  if (/PICKUP_NOT_DEPOSIT/.test(message)) return t('pickup.err.notDeposit')
  const taken = /PICKUP_TAKEN: (\d{4}-\d{2}-\d{2})/.exec(message)
  if (taken) return t('pickup.err.taken').replace('{0}', taken[1])
  const beforeDeposit = /PICKUP_DATE: deposit (\d{4}-\d{2}-\d{2})/.exec(message)
  if (beforeDeposit) return t('pickup.err.date').replace('{0}', beforeDeposit[1])
  if (/PICKUP_NO_PRICE/.test(message)) return t('pickup.err.noPrice')
```

- [ ] **Step 8: `receiptLine.ts`** — `const OUTWARD = new Set(['SALE', 'PICKUP', 'DEPOSIT'])`; comment: "a sale, a deposit or a pickup takes it out".

- [ ] **Step 9: Chữ** — `ui-gold.ts` vi (en tương ứng):

```ts
    'pickup.open': 'Lấy hàng',
    'pickup.title': 'Lấy hàng — {0}',
    'pickup.orderValue': 'Giá trị đơn',
    'pickup.orderValueHint': 'Phiếu cọc chưa có giá chốt: nhập giá trị cả đơn.',
    'pickup.deposited': 'Đã cọc',
    'pickup.left': 'Còn phải trả',
    'pickup.leftShort': 'Còn lại {0}',
    'pickup.depositedShort': 'Đã cọc {0}',
    'pickup.date': 'Ngày lấy',
    'pickup.payments': 'Tiền trả lúc lấy',
    'pickup.saved': 'Đã ghi lấy hàng {0}',
    'pickup.waiting': 'Chờ lấy hàng',
    'pickup.done': 'Đã lấy {0}',
    'pickup.cancelled': 'Đã huỷ đơn',
    'pickup.ofDeposit': 'Cọc {0}',
    'pickup.err.notDeposit': 'Chỉ lấy hàng được từ một phiếu đặt cọc.',
    'pickup.err.taken': 'Đơn cọc này đã được lấy hàng hoặc huỷ ngày {0}.',
    'pickup.err.date': 'Ngày lấy không được trước ngày đặt cọc ({0}).',
    'pickup.err.noPrice': 'Phiếu cọc chưa có giá chốt: nhập giá trị cả đơn để tính số còn phải trả.',
    'receipt.depositPaid': 'Tiền cọc',
    'receipt.gap.depositLeft': 'Còn lại {0}, trả khi lấy hàng.',
```

```ts
    'pickup.open': 'Pick up',
    'pickup.title': 'Pick up — {0}',
    'pickup.orderValue': 'Order value',
    'pickup.orderValueHint': 'The deposit has no agreed price: type what the whole order comes to.',
    'pickup.deposited': 'Deposit paid',
    'pickup.left': 'Left to pay',
    'pickup.leftShort': '{0} left',
    'pickup.depositedShort': '{0} deposited',
    'pickup.date': 'Picked up on',
    'pickup.payments': 'Paid at pickup',
    'pickup.saved': 'Pickup recorded as {0}',
    'pickup.waiting': 'Awaiting pickup',
    'pickup.done': 'Picked up {0}',
    'pickup.cancelled': 'Order cancelled',
    'pickup.ofDeposit': 'Deposit {0}',
    'pickup.err.notDeposit': 'Only a deposit can be picked up.',
    'pickup.err.taken': 'This deposit was already picked up or cancelled on {0}.',
    'pickup.err.date': 'A pickup cannot be dated before its deposit ({0}).',
    'pickup.err.noPrice': 'The deposit has no agreed price: type what the whole order comes to.',
    'receipt.depositPaid': 'Deposit paid',
    'receipt.gap.depositLeft': '{0} left, paid when the gold is collected.',
```

  Sửa `receipt.signHint` vi: `'Mua vào, bán ra và đặt cọc: gõ số lượng không dấu, loại phiếu tự đặt dấu. Loại khác: gõ cả dấu, dương là vào, âm là ra.'`; en: `'Purchases, sales and deposits: type quantities without a sign; the receipt type sets it. Other types: type the sign, positive in and negative out.'`.
  `dictionary.ts`: `txn.blocked.DEPOSIT_PICKUP` vi `'Phiếu lấy hàng không sửa trực tiếp: huỷ phiếu này rồi bấm Lấy hàng trên dòng cọc để ghi lại'`, en `'A pickup is not corrected here: cancel it, then press Pick up on its deposit'`; `txn.blocked.DEPOSIT_PICKED_UP` vi `'Đơn cọc đã lấy hàng: huỷ phiếu lấy hàng trước nếu cần sửa'`, en `'This deposit has been picked up: cancel the pickup first to correct it'`.

- [ ] **Step 10: Xanh, commit** — `git commit -m "feat(deposit): read a deposit's collection on the ledger row, and sign a deposit as a sale"`

---

### Task 5: Màn hình — form cọc, hộp Lấy hàng, thẻ trên sổ

**Files:** Create `src/components/gold/PickupForm.tsx`; Modify `actions.ts` (`savePickup`), `TxnScreen.tsx`, `ReceiptForm.tsx`; Test `tests/lib/txn-ledger-screen.test.tsx`.

- [ ] **Step 1: Test màn sổ** — thêm:

```tsx
  it('says on a deposit what is left and that it waits, and on a pickup when the deposit was taken', () => {
    const deposit: ReceiptRow = {
      ...sale, key: 'd', doc_no: 'PC49-2609-005', txn_type: 'DEPOSIT', amount: 5300,
      payments: [{ seq: 1, amount: 1000, method: 'CASH' }],
      deposit: { role: 'deposit', orderValue: 5300, paid: 1000, settledBy: null, pickupDate: null,
                 pickupDoc: null, depositDate: null, depositDoc: null },
    }
    const pickup: ReceiptRow = {
      ...sale, key: 'p', doc_no: 'PC49-2609-021', txn_type: 'PICKUP', amount: 5300,
      payments: [{ seq: 1, amount: 4300, method: 'CASH' }],
      deposit: { role: 'pickup', orderValue: 5300, paid: 1000, settledBy: null, pickupDate: null,
                 pickupDoc: null, depositDate: '2026-09-08', depositDoc: 'PC49-2609-005' },
    }
    const html = text(<TxnScreen {...base} rows={[pickup, deposit]}
      totals={{ count: 2, purchases: 0, sales: 5300, grams: {} }} />)
    expect(html).toContain('Chờ lấy hàng')
    expect(html).toContain('Còn lại 4,300.00')
    expect(html).toContain('Cọc 2026-09-08 PC49-2609-005')
    expect(html).toContain('Đã cọc 1,000.00')
  })
```

- [ ] **Step 2: Action** — cuối `actions.ts`:

```ts
const pickupSchema = z.object({
  // Stable for the life of one pickup on screen, so pressing Save twice is one pickup.
  requestKey: z.string().uuid(),
  key: z.string().uuid(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  orderValue: z.number().positive().nullable().default(null),
  payments: z.array(paymentSchema).max(20),
  remarks: z.string().trim().max(500).nullable().default(null),
})

/**
 * Records the customer collecting a deposit's gold (0087): a pickup of its
 * own, on its day, pointing at the deposit, with what was handed over then.
 */
export async function savePickup(input: unknown): Promise<SaveResult> {
  const parsed = pickupSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid pickup' }
  }
  const p = parsed.data
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('save_gold_pickup', {
    p_request_key: p.requestKey,
    p_deposit: p.key,
    p_payload: { pickupDate: p.pickupDate, orderValue: p.orderValue, payments: p.payments, remarks: p.remarks },
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { receiptId: string; docNo: string | null; repeated: boolean }
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.receiptId, docNo: result.docNo, repeated: result.repeated }
}
```

- [ ] **Step 3: Hộp Lấy hàng**

```tsx path=src/components/gold/PickupForm.tsx
'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useRef, useState } from 'react'
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Typography,
} from 'antd'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { savePickup } from '@/app/(app)/gold-transactions/actions'
import { money, weight } from '@/components/ledger/Ledger'
import { describeRefusal } from './receiptErrors'
import { leftToPay } from './pickup'
import { MAX_PAYMENTS, PAYMENT_METHODS, type ReceiptRow } from './types'
import styles from './Txn.module.css'

type PaymentField = { amount: number | null; method: string | null }
type Values = { pickupDate: string; orderValue: number | null; payments: PaymentField[]; remarks: string }

/** One figure of the order, its name above it. */
function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div><Typography.Text strong>{value}</Typography.Text></div>
      {note && <Typography.Text type="secondary">{note}</Typography.Text>}
    </div>
  )
}

/**
 * The customer comes back for a deposit's gold (spec 2026-09-17, 0087).
 *
 * Everything about the order comes from the deposit — customer, gold,
 * quantity, agreed price, what was put down — so all that is typed is the day
 * and what was handed over. Less than is left is recorded as owed, and paid
 * later from the ledger like any sale.
 */
export function PickupForm({ row, today, goldName, onClose, onDone }: {
  /** The deposit being collected. */
  row: ReceiptRow
  today: string
  goldName: (code: string) => string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** One pickup on this form is one pickup, however often Save is pressed. */
  const requestKey = useRef<string>(crypto.randomUUID())

  const info = row.deposit!
  const line = row.lines[0]
  const known = info.orderValue !== null
  const typedValue = Form.useWatch('orderValue', form) as number | null | undefined
  const payments = (Form.useWatch('payments', form) ?? []) as (PaymentField | undefined)[]
  const left = leftToPay({ orderValue: known ? info.orderValue : (typedValue ?? null), paid: info.paid })
  const paying = payments.reduce((sum, p) => sum + Number(p?.amount ?? 0), 0)
  const gap = left === null ? 0 : Math.round((paying - left) * 100) / 100

  async function save() {
    setError(null)
    let v: Values
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    const result = await settleAction(() => savePickup({
      requestKey: requestKey.current,
      key: row.key,
      pickupDate: v.pickupDate,
      orderValue: known ? null : Number(v.orderValue ?? 0),
      payments: (v.payments ?? [])
        .map((p) => ({ amount: Number(p?.amount ?? 0), method: String(p?.method ?? '') }))
        .filter((p) => p.amount > 0 && p.method),
      remarks: v.remarks?.trim() || null,
    }))
    setSaving(false)
    if (!result.ok) {
      setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      return
    }
    onDone(t('pickup.saved').replace('{0}', result.docNo ?? ''))
  }

  return (
    <Modal
      open
      width={680}
      title={t('pickup.title').replace('{0}', row.doc_no ?? '—')}
      onCancel={onClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>{t('txn.form.close')}</Button>,
        <Button key="save" type="primary" icon={<Check size={16} aria-hidden />} loading={saving}
                onClick={save}>
          {t('txn.save')}
        </Button>,
      ]}
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}

      <Typography.Paragraph>
        {row.partner_code ?? '—'} · {line ? `${goldName(line.gold_type_code)} ${weight.format(Math.abs(line.qty))} ${line.uom}` : ''}
      </Typography.Paragraph>
      <Space size={32} wrap style={{ marginBottom: 16 }}>
        <Figure label={t('pickup.orderValue')} value={known ? money.format(info.orderValue!) : '—'} />
        <Figure label={t('pickup.deposited')} value={money.format(info.paid)} note={row.txn_date} />
        <Figure label={t('pickup.left')} value={left === null ? '—' : money.format(left)} />
      </Space>

      <Form<Values>
        form={form}
        layout="vertical"
        initialValues={{
          pickupDate: today < row.txn_date ? row.txn_date : today,
          orderValue: null,
          payments: [{ amount: left, method: 'CASH' }],
          remarks: '',
        }}
      >
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="pickupDate" label={t('pickup.date')}
                       rules={[{ required: true, message: t('txn.form.required') }]}>
              <Input type="date" min={row.txn_date} />
            </Form.Item>
          </Col>
          {!known && (
            <Col xs={24} sm={12}>
              <Form.Item name="orderValue" label={t('pickup.orderValue')} extra={t('pickup.orderValueHint')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <InputNumber style={{ width: '100%' }} min={0.01} step={0.01} controls={false} />
              </Form.Item>
            </Col>
          )}
        </Row>

        <section className={styles.section} aria-labelledby="pickup-pay-heading">
          <h3 id="pickup-pay-heading" className={styles.sectionHeading}>{t('pickup.payments')}</h3>
          <Form.List name="payments">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={12} key={field.key} align="middle">
                    <Col xs={24} sm={10}>
                      <Form.Item name={[field.name, 'amount']} label={t('txn.form.payAmount')}>
                        <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
                      </Form.Item>
                    </Col>
                    <Col xs={16} sm={10}>
                      <Form.Item name={[field.name, 'method']} label={t('txn.col.method')}>
                        <Select allowClear options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={8} sm={4}>
                      <Button type="text" danger icon={<Trash2 size={16} aria-hidden />}
                              aria-label={t('txn.form.remove')}
                              disabled={fields.length === 1}
                              onClick={() => remove(field.name)} />
                    </Col>
                  </Row>
                ))}
                {fields.length < MAX_PAYMENTS && (
                  <Button type="dashed" block icon={<Plus size={16} aria-hidden />}
                          onClick={() => add({ amount: null, method: null })}>
                    {t('txn.form.addPayment')}
                  </Button>
                )}
              </>
            )}
          </Form.List>
          {left !== null && Math.abs(gap) >= 0.005 && (
            <Alert type="warning" showIcon role="status" style={{ marginTop: 12 }}
                   title={gap > 0
                     ? t('receipt.gap.over').replace('{0}', money.format(gap))
                     : t('receipt.gap.under').replace('{0}', money.format(-gap))} />
          )}
        </section>

        <Form.Item name="remarks" label={t('txn.col.remarks')} style={{ marginTop: 16 }}>
          <Input maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
```

- [ ] **Step 4: `TxnScreen.tsx`**
  - import `PackageCheck` (lucide), `PickupForm`, `canPickUp, leftToPay` từ `./pickup`.
  - state `const [pickingUp, setPickingUp] = useState<ReceiptRow | null>(null)`.
  - cột Thành tiền, ngay sau `<div><Money value={v} /></div>`:

```tsx
          {r.deposit?.role === 'deposit' && !r.deposit.settledBy && leftToPay(r.deposit) !== null && (
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              {t('pickup.leftShort').replace('{0}', money.format(leftToPay(r.deposit)!))}
            </Typography.Text>
          )}
          {r.deposit?.role === 'pickup' && (
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              {t('pickup.depositedShort').replace('{0}', money.format(r.deposit.paid))}
            </Typography.Text>
          )}
```

  - cột Ghi chú, trước `{v ?? ''}`:

```tsx
          {r.deposit?.role === 'deposit' && (
            r.deposit.settledBy === 'PICKUP'
              ? <><Tag color="green">{t('pickup.done').replace('{0}', r.deposit.pickupDate ?? '')}</Tag>{r.deposit.pickupDoc} </>
              : r.deposit.settledBy === 'CANCEL'
                ? <Tag>{t('pickup.cancelled')}</Tag>
                : <Tag color="gold">{t('pickup.waiting')}</Tag>
          )}
          {r.deposit?.role === 'pickup' && (
            <><Tag color="green">{t('pickup.ofDeposit').replace('{0}', r.deposit.depositDate ?? '')}</Tag>{r.deposit.depositDoc} </>
          )}
```

  - cột Thao tác, đầu `<Space>`:

```tsx
          {canPickUp(r) && (
            <IconAction icon={<PackageCheck size={16} aria-hidden />} label={t('pickup.open')}
                        onClick={() => setPickingUp(r)} />
          )}
```

  - sau khối `{settling && …}`:

```tsx
      {pickingUp && (
        <PickupForm
          row={pickingUp}
          today={today}
          goldName={goldName}
          onClose={() => setPickingUp(null)}
          onDone={(message) => {
            setPickingUp(null)
            setToast(message)
            router.refresh()
          }}
        />
      )}
```

- [ ] **Step 5: `ReceiptForm.tsx`**
  - Bỏ `NEEDS_PAYMENT` và `rules` của `Form.List name="payments"` (không loại nào bị bắt có tiền nữa).
  - `const ENTRY_TYPES = TXN_TYPES.filter((v) => v !== 'PICKUP')` kèm comment: một lần lấy hàng được ghi từ phiếu cọc của nó (0087); options ô Loại dùng `ENTRY_TYPES`.
  - tiêu đề phần thanh toán: `{t(txnType === 'DEPOSIT' ? 'receipt.depositPaid' : 'txn.form.settle')}`.
  - câu báo thiếu: `gap > 0 ? … : t(txnType === 'DEPOSIT' ? 'receipt.gap.depositLeft' : 'receipt.gap.under').replace('{0}', money.format(-gap))`.

- [ ] **Step 6: Kiểm tra, commit** — `npx tsc --noEmit`, `npx eslint src/components/gold "src/app/(app)/gold-transactions" tests/lib`, `npx vitest run tests/lib`; `git commit -m "feat(deposit): take a deposit with any money, and pick it up from its row"`

---

### Task 6: Kiểm tra trình duyệt, cổng cuối, đưa lên

**Files:** Create `scripts/verify-deposit.mjs`; Modify `package.json` (`verify:deposit`).

- [ ] **Step 1: Script**

```js path=scripts/verify-deposit.mjs
// A deposit taken, and picked up from its own row.
//
//   "Deposit gặp lỗi giống cái thứ 2 phải thanh toán"
//   "Khi pickup không chỉnh sửa được trạng thái từ deposit sang pickup, cũng
//    chưa có trường dữ liệu để phân biệt ngày nào đặt cọc, ngày nào pickup"
//
// One luong of Rong Phung is ordered at 5,300.00 with 1,000.00 down, the
// quantity typed without a sign. A second order is taken with nothing down.
// A week on the first is picked up from its row with 3,000.00 paid: the pickup
// has its own day and number, the deposit says when it was collected, and
// 1,300.00 is owed. The pickup is cancelled and the deposit waits again.
//
//   npm run verify:deposit      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { untilRowIs } from './support/until.mjs'
import { removeSettlements } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-07-08'
const PICKUP_DAY = '2019-07-15'
const PERIOD = '2019-07'
const PARTNER = 'verify-deposit customer'
const MONTH = `${BASE}/gold-transactions?from=2019-07-01&to=2019-07-31`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes in its month, and the customer it invents. */
async function cleanUp() {
  const inMonth = `txn_date >= '2019-07-01' AND txn_date < '2019-08-01'`
  const txns = await db.query(`SELECT id FROM pc49.gold_txn WHERE ${inMonth}`)
  await db.query(`UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE ${inMonth}`)
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
  }
  // A pickup must name its deposit (0013), so pickups go before deposits
  // rather than being unhooked from them.
  await db.query(`DELETE FROM pc49.gold_txn WHERE ${inMonth} AND deposit_ref_id IS NOT NULL`)
  await db.query(`DELETE FROM pc49.gold_txn WHERE ${inMonth}`)
  await db.query(`UPDATE pc49.gold_receipt SET corrects_receipt_id = NULL WHERE ${inMonth}`)
  await db.query(`DELETE FROM pc49.gold_receipt WHERE ${inMonth}`)
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'gold_receipt'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.gold_receipt)`)
  await removeSettlements(db, PERIOD)
  await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL', [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
}

async function pickOption(page, option) {
  const choice = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option }).first()
  await choice.waitFor({ state: 'attached' })
  await choice.scrollIntoViewIfNeeded().catch(() => {})
  await choice.click({ force: true })
}

async function choose(page, scope, label, option) {
  await scope.getByLabel(label, { exact: true }).first().click()
  await pickOption(page, option)
}

const shown = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ')
const rows = (page) => page.locator('.ant-table-tbody tr.ant-table-row')
// By the number in its own column: a deposit's row also names its pickup's
// number, and the pickup's names the deposit's.
const rowOf = (page, doc) => rows(page)
  .filter({ has: page.locator('td').filter({ hasText: new RegExp(`^${doc}$`) }) }).first()

/** A deposit of one luong of Rong Phung at 5,300.00, typed on the entry form. */
async function typeDeposit(page, down, remarks) {
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Ngày', { exact: true }).fill(DAY)
  await form.getByLabel('Loại', { exact: true }).click()
  const offersPickup = await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: /^PICKUP$/ }).count()
  await pickOption(page, 'DEPOSIT')
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  const item = form.getByRole('group', { name: 'Món 1', exact: true })
  await choose(page, item, 'Loại vàng', 'Rong Phung')
  await item.getByLabel('Số lượng', { exact: true }).fill('1')
  await item.getByLabel('Thành tiền', { exact: true }).fill('5300')
  const settle = form.locator('section[aria-labelledby="txn-settle-heading"]')
  if (down > 0) await settle.getByLabel('Số tiền', { exact: true }).first().fill(String(down))
  await form.getByLabel('Ghi chú', { exact: true }).fill(remarks)
  const said = await shown(settle)
  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()
  return { offersPickup, said }
}

try {
  await cleanUp()

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)
  await page.goto(MONTH, { waitUntil: 'networkidle' })

  // ---- A deposit, 1,000.00 down --------------------------------------------
  const first = await typeDeposit(page, 1000, 'coc 1000')
  check('the type list no longer offers PICKUP on its own', first.offersPickup === 0)
  check('the form says what is left to pay at pickup', first.said.includes('Còn lại 4,300.00'), first.said.slice(0, 160))
  const deposit = await untilRowIs(db,
    `SELECT t.id, t.receipt_id, t.doc_no, t.qty::float8 AS qty, t.amount::float8 AS amount,
            t.journal_entry_id IS NOT NULL AS posted
       FROM pc49.gold_txn t
      WHERE t.txn_date = $1 AND t.partner_code = $2 AND t.remarks = 'coc 1000' AND t.voided_at IS NULL`,
    [DAY, PARTNER], (r) => r.posted)
  check('the deposit saves and posts', deposit !== null, deposit ? deposit.doc_no : '(nothing saved)')
  if (!deposit) throw new Error('the deposit did not save')
  check('with the quantity going out, typed without a sign', deposit.qty === -1, `${deposit.qty}`)
  check('at the order’s value', deposit.amount === 5300, `${deposit.amount}`)

  // ---- A deposit with nothing down -----------------------------------------
  await page.goto(MONTH, { waitUntil: 'networkidle' })
  await typeDeposit(page, 0, 'coc 0')
  const free = await untilRowIs(db,
    `SELECT t.id, t.journal_entry_id IS NULL AS unposted
       FROM pc49.gold_txn t
      WHERE t.txn_date = $1 AND t.partner_code = $2 AND t.remarks = 'coc 0' AND t.voided_at IS NULL`,
    [DAY, PARTNER], () => true)
  check('a deposit with nothing down saves, with nothing on the books', free !== null && free.unposted)

  // ---- Picked up a week on, 3,000.00 paid ----------------------------------
  await page.goto(MONTH, { waitUntil: 'networkidle' })
  const waiting = await shown(rowOf(page, deposit.doc_no))
  check('the deposit waits, and says what is left', waiting.includes('Chờ lấy hàng') && waiting.includes('Còn lại 4,300.00'),
    waiting.slice(0, 200))
  await rowOf(page, deposit.doc_no).getByRole('button', { name: 'Lấy hàng', exact: true }).click()
  const pick = page.getByRole('dialog', { name: `Lấy hàng — ${deposit.doc_no}`, exact: true }).last()
  await pick.waitFor()
  check('the pickup shows the order from its deposit',
    (await shown(pick)).includes('5,300.00') && (await shown(pick)).includes('4,300.00'))
  await pick.getByLabel('Ngày lấy', { exact: true }).fill(PICKUP_DAY)
  await pick.getByLabel('Số tiền', { exact: true }).first().fill('3000')
  check('paying less says what will be owed', (await shown(pick)).includes('Còn nợ 1,300.00'))
  await pick.getByRole('button', { name: 'Lưu', exact: true }).click()

  const pickup = await untilRowIs(db,
    `SELECT p.id, p.receipt_id, p.doc_no, p.txn_date::text AS day, p.amount::float8 AS amount,
            p.journal_entry_id IS NOT NULL AS posted,
            pc49.gold_receipt_owed(coalesce(p.receipt_id, p.id))::float8 AS owed
       FROM pc49.gold_txn p WHERE p.deposit_ref_id = $1 AND p.voided_at IS NULL`,
    [deposit.id], (r) => r.posted)
  check('the pickup saves on its own day, pointing at the deposit',
    pickup !== null && pickup.day === PICKUP_DAY, pickup ? `${pickup.doc_no} ${pickup.day}` : '(nothing saved)')
  if (!pickup) throw new Error('the pickup did not save')
  check('under its own number', pickup.doc_no !== deposit.doc_no)
  check('for the whole order, 1,300.00 still owed', pickup.amount === 5300 && pickup.owed === 1300,
    `${pickup.amount} / ${pickup.owed}`)

  await page.goto(MONTH, { waitUntil: 'networkidle' })
  const collected = await shown(rowOf(page, deposit.doc_no))
  check('the deposit says when it was picked up', collected.includes(`Đã lấy ${PICKUP_DAY}`), collected.slice(0, 200))
  const pickupRow = await shown(rowOf(page, pickup.doc_no))
  check('the pickup says when the deposit was taken, and what is owed',
    pickupRow.includes(`Cọc ${DAY}`) && pickupRow.includes('Còn nợ 1,300.00'), pickupRow.slice(0, 200))

  // ---- The pickup cancelled: the deposit waits again -----------------------
  await rowOf(page, pickup.doc_no).getByRole('button', { name: 'Huỷ', exact: true }).click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiem tra huy lay hang')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  const reopened = await untilRowIs(db,
    `SELECT count(*)::int AS live FROM pc49.gold_txn WHERE deposit_ref_id = $1 AND voided_at IS NULL`,
    [deposit.id], (r) => r.live === 0)
  check('cancelling the pickup takes it off the books', reopened !== null)
  await page.goto(MONTH, { waitUntil: 'networkidle' })
  check('and the deposit waits again', (await shown(rowOf(page, deposit.doc_no))).includes('Chờ lấy hàng'))
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date >= '2019-07-01' AND txn_date < '2019-08-01') AS txns,
            (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date >= '2019-07-01' AND txn_date < '2019-08-01') AS receipts,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $1) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $2) AS partners`,
    [PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.receipts, r.entries, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.receipts} receipts, ${r.entries} entries, ${r.partners} partners`)
  await db.end()
}

console.log(failures === 0 ? '\nALL DEPOSIT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
```

- [ ] **Step 2: `package.json`** — `"verify:deposit": "node --env-file=.env.local scripts/verify-deposit.mjs",` sau `verify:settlement`.
- [ ] **Step 3: Cổng** — `npx tsc --noEmit`; `npm run lint`; `npx vitest run tests/lib`; `npx vitest run tests/sql --maxWorkers=4` (một mình).
- [ ] **Step 4: Migrate** — `npm run migrate`; `npm run verify:live`.
- [ ] **Step 5: Trình duyệt cục bộ** — `npm run build`; `node node_modules/next/dist/bin/next start -p 3149` (nền); `PC49_BASE_URL=http://localhost:3149` cho `verify:deposit`, `verify:settlement`, `verify:conversion`, `verify:receipt`.
- [ ] **Step 6: Đẩy** — hai grep in 0; `git push origin main`; chờ Vercel; `verify:deposit` trên Production; `verify:live`.
