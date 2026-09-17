# Transfer trong ô Loại, và thanh toán tiếp — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng chọn được TRANSFER ngay trong ô Loại, lưu được phiếu mua/bán trả một phần hoặc chưa trả, và ghi các lần trả tiếp ở đợt sau trên sổ.

**Architecture:** Ba migration. 0082 cho phiếu mua trả thiếu ghi phần chưa trả vào 331. 0083 thêm bảng `gold_receipt_settlement` và các hàm lưu, huỷ lần trả sau; huỷ và sửa phiếu biết tới các lần trả đó. 0084 cho sổ trả thêm `settlements` và `owed`, lọc được `OWED`. Màn hình đọc hai cột mới, thêm hộp Thanh toán tiếp, và form phiếu mở form quy đổi khi chọn TRANSFER.

**Tech Stack:** PostgreSQL (Supabase) + PGlite/vitest cho test SQL; Next.js 16 server actions, React 19, antd 6, zod 4; Playwright cho kiểm tra trên trình duyệt.

**Spec:** `docs/superpowers/specs/2026-09-17-transfer-va-thanh-toan-tiep-design.md`

## Global Constraints

- Không có chữ `cl[a]ude` hoặc `cod[e]x` trong commit hay nội dung đẩy lên; trước khi đẩy, hai lệnh grep phải in 0.
- Đẩy lên main là triển khai Production: `git push origin main` là một lệnh riêng, ngoài giờ nhập liệu (04:00–08:00 UTC) trừ khi người dùng bảo.
- Ghi DB thật chỉ bằng `npm run migrate` (chạy nguyên văn, không pipe); sau đó `npm run verify:live`.
- Chạy test SQL một mình: `npx vitest run tests/sql --maxWorkers=4`.
- Mã từ chối: `SETTLEMENT_KIND`, `SETTLEMENT_AMOUNT`, `SETTLEMENT_DATE: receipt YYYY-MM-DD`, `SETTLEMENT_PERIOD: YYYY-MM`, `SETTLEMENT_OVER: owed X paid Y`, `SETTLEMENT_OLD_POSTING`, `SETTLEMENT_VOIDED`, `RECEIPT_HAS_SETTLEMENTS: N`; `PAYMENT_SHORT` chỉ còn cho đặt cọc.
- Phiếu mua trả đủ ghi sổ y như trước; trả dư giữ như trước.
- Nhãn: nút `Transfer`; tiêu đề form `Transfer — quy đổi vàng`, sửa `Sửa transfer`; nhãn loại trên sổ `TRANSFER`/`RA_RP`; ô Loại phiên `Transfer (quy đổi)`/`Ra RP`; bộ lọc Thanh toán thêm `Còn nợ`; nút `Thanh toán tiếp`.

## Cách tách mã từ kế hoạch

Khối mã có `path=` ở dòng mở là **toàn bộ nội dung** của file mới. Tách ra bằng:

```bash
node scripts/extract-plan-files.mjs docs/superpowers/plans/2026-09-17-transfer-va-thanh-toan-tiep.md <path>...
```

(script ở Task 0). Khối không có `path=` là đoạn sửa trong file có sẵn, làm bằng tay.

## Các file

| File | Việc |
|---|---|
| `supabase/migrations/0082_a_purchase_may_be_paid_later.sql` | `post_gold_txn` ghi 331 phần chưa trả; `write_gold_receipt` chỉ chặn đặt cọc không tiền |
| `supabase/migrations/0083_a_receipt_is_paid_in_instalments.sql` | bảng lần trả sau; `settlement_side`, `gold_receipt_owed`, `gold_receipt_settlements`, `save_receipt_settlement`, `void_receipt_settlement`; `void_gold_receipt`, `correct_gold_receipt` |
| `supabase/migrations/0084_the_ledger_shows_what_is_owed.sql` | `gold_receipt_ledger_match` (OWED, hình thức trả sau), `gold_receipt_ledger` (+settlements, owed) |
| `tests/sql/receipt-owed.test.ts` | bút toán phiếu mua trả 0 / một phần / đủ |
| `tests/sql/settlement.test.ts` | lưu, từ chối, huỷ lần trả; huỷ và sửa phiếu có lần trả |
| `tests/sql/settlement-ledger.test.ts` | sổ và bộ lọc |
| `tests/sql/receipt.test.ts`, `tests/sql/txn-journal.test.ts` | cập nhật theo 0082 |
| `src/components/gold/types.ts` | `Settlement`; `ReceiptRow.settlements?`, `owed?` |
| `src/components/gold/settlement.ts` | `SETTLEABLE_TYPES`, `canSettle`, `paidSoFar` |
| `src/components/gold/ledgerRow.ts` | đọc `settlements`, `owed` |
| `src/components/gold/ledgerQuery.ts` | `OWED` trong bộ lọc hình thức |
| `src/components/gold/receiptErrors.ts` | câu cho mã mới |
| `src/components/gold/ledgerCsv.ts` | cột Đã trả, Còn nợ |
| `src/lib/i18n/ui-gold.ts`, `src/lib/i18n/dictionary.ts` | chữ |
| `src/app/(app)/gold-transactions/actions.ts` | `saveSettlement`, `voidSettlement` |
| `src/components/gold/SettlementForm.tsx` | hộp Thanh toán tiếp |
| `src/components/gold/TxnScreen.tsx` | cột, nút, bộ lọc, hộp; TRANSFER mở form quy đổi |
| `src/components/gold/ReceiptForm.tsx` | TRANSFER trong ô Loại; chỉ đặt cọc bắt buộc tiền; câu còn nợ |
| `tests/lib/*` | receipt-errors, receipt-row, ledger-csv, ledger-query, settlement, txn-ledger-screen |
| `scripts/verify-settlement.mjs`, `scripts/support/receipts.mjs`, `scripts/verify-live.mjs`, `scripts/verify-conversion.mjs`, `package.json` | kiểm tra trên trình duyệt |

---

### Task 0: Script tách file từ kế hoạch

**Files:**
- Create: `scripts/extract-plan-files.mjs`

- [ ] **Step 1: Viết script**

```js path=scripts/extract-plan-files.mjs
// Writes the files a plan spells out whole.
//
// A fenced block whose opening line carries `path=<file>` is that file's entire
// content. Named paths only, so running it twice, or for one task, writes
// exactly what was asked for.
//
//   node scripts/extract-plan-files.mjs <plan.md> <path>...
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [plan, ...wanted] = process.argv.slice(2)
if (!plan || wanted.length === 0) {
  console.error('usage: node scripts/extract-plan-files.mjs <plan.md> <path>...')
  process.exit(1)
}

const text = (await readFile(plan, 'utf8')).replace(/\r\n/g, '\n')
const blocks = new Map()
const fence = /^(`{3,})\w* path=(\S+)\n([\s\S]*?)\n\1$/gm
for (const m of text.matchAll(fence)) blocks.set(m[2], m[3] + '\n')

let missing = 0
for (const file of wanted) {
  const body = blocks.get(file)
  if (body === undefined) {
    console.error(`not in the plan: ${file}`)
    missing += 1
    continue
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  console.log(`wrote ${file}`)
}
process.exit(missing === 0 ? 0 : 1)
```

- [ ] **Step 2: Commit** — `git add scripts/extract-plan-files.mjs && git commit -m "chore(plan): write the files a plan spells out whole"`

---

### Task 1: Phiếu mua trả thiếu vẫn lưu, phần chưa trả vào 331 (0082)

**Files:**
- Create: `supabase/migrations/0082_a_purchase_may_be_paid_later.sql`
- Create: `tests/sql/receipt-owed.test.ts`
- Modify: `tests/sql/receipt.test.ts` (test "refuses a purchase whose payments never reach an item")
- Modify: `tests/sql/txn-journal.test.ts` (thêm describe cuối file)

**Interfaces:**
- Produces: `pc49.post_gold_txn(uuid)` ghi thêm dòng `Nợ kho / Có 331` = `-amount − đã trả` khi dương; `pc49.write_gold_receipt` chỉ ném `PAYMENT_SHORT: item 1` cho `DEPOSIT` không tiền.

- [ ] **Step 1: Viết test mới**

```ts path=tests/sql/receipt-owed.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'
import { receiptPayload } from '../support/receipt'

// "Không lưu được đối với đơn chưa thanh toán hết" (17-09-2026): a purchase
// paid in part, or not yet at all, is saved, and what is still owed is booked
// against the seller (0082).

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

async function save(key: string, body: string) {
  const r = await asRole(db, KT, () => db.query<{ r: { receiptId: string } }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

/** What every item of a receipt put on the books, added up. */
async function booked(receiptId: string) {
  const r = await db.query<{
    owed: number; stock: number; cash: number; grams: number; posted: number; items: number
  }>(
    `SELECT coalesce(sum(jl.amount_usd) FILTER (WHERE jl.credit_account = '331'), 0)::float8 AS owed,
            coalesce(sum(jl.amount_usd) FILTER (WHERE jl.debit_account LIKE '15%'), 0)::float8 AS stock,
            coalesce(sum(jl.amount_usd) FILTER (
              WHERE jl.credit_account IN ('1111', '1121BW', '1121ZL', '1121CK')), 0)::float8 AS cash,
            coalesce(sum(jl.qty_gram) FILTER (WHERE jl.debit_account LIKE '15%'), 0)::float8 AS grams,
            count(DISTINCT t.journal_entry_id)::int AS posted,
            (SELECT count(*)::int FROM pc49.gold_txn x WHERE x.receipt_id = $1) AS items
       FROM pc49.gold_txn t
       JOIN pc49.journal_line jl ON jl.entry_id = t.journal_entry_id
      WHERE t.receipt_id = $1`, [receiptId])
  return r.rows[0]
}

describe('a purchase not paid in full', () => {
  it('saves six items with nothing paid, and owes the seller all of it', async () => {
    const saved = await save('nothing-paid', receiptPayload({ partnerCode: 'UNPAID', payments: [] }))
    const b = await booked(saved.receiptId)
    expect(b).toMatchObject({ owed: 8361, stock: 8361, cash: 0, posted: 6, items: 6 })
    expect(b.grams).toBeCloseTo(75.6, 4)
  })

  it('saves six items paid in part, and owes the seller the rest', async () => {
    const saved = await save('part-paid', receiptPayload({
      partnerCode: 'PART', payments: [{ amount: 5000, method: 'CASH' }],
    }))
    const b = await booked(saved.receiptId)
    expect(b).toMatchObject({ owed: 3361, stock: 8361, cash: 5000, posted: 6 })
    expect(b.grams).toBeCloseTo(75.6, 4)
  })

  it('books a purchase paid in full as it always did, owing nobody', async () => {
    const saved = await save('paid-in-full', receiptPayload({ partnerCode: 'FULL' }))
    expect(await booked(saved.receiptId)).toMatchObject({ owed: 0, stock: 8361, cash: 8361 })
  })

  it('still refuses a deposit taken without its deposit', async () => {
    await expect(save('deposit-unpaid', receiptPayload({
      partnerCode: 'DEP0', txnType: 'DEPOSIT', payments: [],
      lines: [{ itemDesc: 'RP', goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5000,
                amount: 5000, scrapDetail: null, goldPct: null }],
    }))).rejects.toThrow(/PAYMENT_SHORT: item 1/)
  })
})
```

- [ ] **Step 2: Sửa test cũ trong `tests/sql/receipt.test.ts`** — thay cả khối `it('refuses a purchase whose payments never reach an item, and names the item', …)` bằng:

```ts
  it('saves a purchase whose payments stop short of the last item, every item posted', async () => {
    const saved = await saveReceipt('six-short', receiptPayload({
      partnerCode: 'SHORT', payments: [{ amount: 8000, method: 'CASH' }],
    }))
    expect((await paidPerItem(saved.receiptId))[5]).toBe('')
    const posted = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn
        WHERE receipt_id = $1 AND journal_entry_id IS NOT NULL`, [saved.receiptId])
    expect(posted.rows[0].n).toBe('6')
  })
```

- [ ] **Step 3: Thêm vào cuối `tests/sql/txn-journal.test.ts`**

```ts
describe('what is not paid yet', () => {
  it('owes the seller the part of a purchase not paid', async () => {
    const t = await enter(
      { date: '2026-01-05', type: 'PO', gold: 'SG', uom: 'GRAM', qty: 10, price: 60, amount: -600,
        partner: 'OWED1' },
      [{ amount: 400, method: 'CASH' }],
    )
    const lines = await linesOf(await post(t))
    expect(lines.map((l) => [l.dr, l.cr, Number(l.amount), l.g === null ? null : Number(l.g)]))
      .toEqual([['155SG', '1111', 400, 10], ['155SG', '331', 200, null]])
  })

  it('posts a purchase with nothing paid against the seller, carrying the weight', async () => {
    const t = await enter(
      { date: '2026-01-05', type: 'PO', gold: 'SG', uom: 'GRAM', qty: 10, price: 60, amount: -600,
        partner: 'OWED2' },
      [],
    )
    const lines = await linesOf(await post(t))
    expect(lines.map((l) => [l.dr, l.cr, Number(l.amount), Number(l.g)]))
      .toEqual([['155SG', '331', 600, 10]])
  })
})
```

- [ ] **Step 4: Chạy, phải đỏ** — `npx vitest run tests/sql/receipt-owed.test.ts tests/sql/receipt.test.ts tests/sql/txn-journal.test.ts`. Mong đợi: "nothing paid" và "part paid" hỏng (PAYMENT_SHORT / thiếu 331), "six-short" hỏng (PAYMENT_SHORT), hai test journal hỏng.

- [ ] **Step 5: Viết migration**

```sql path=supabase/migrations/0082_a_purchase_may_be_paid_later.sql
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
```

- [ ] **Step 6: Chạy lại, phải xanh** — cùng lệnh Step 4. Mong đợi: PASS.

- [ ] **Step 7: Commit** — `git add supabase/migrations/0082_a_purchase_may_be_paid_later.sql tests/sql/receipt-owed.test.ts tests/sql/receipt.test.ts tests/sql/txn-journal.test.ts && git commit -m "feat(receipt): a purchase paid in part is saved, and what is owed is booked to 331"`

---

### Task 2: Thanh toán tiếp trong database (0083)

**Files:**
- Create: `supabase/migrations/0083_a_receipt_is_paid_in_instalments.sql`
- Create: `tests/sql/settlement.test.ts`

**Interfaces:**
- Consumes: 0082 (phiếu mua trả thiếu có dòng 331).
- Produces:
  - bảng `pc49.gold_receipt_settlement(id, receipt_key, pay_date, amount, method, note, journal_entry_id, voided_at, void_reason, reversal_entry_id, …)`
  - `pc49.settlement_side(text) → 'AP' | 'AR' | null`
  - `pc49.gold_receipt_owed(uuid) → numeric`
  - `pc49.gold_receipt_settlements(uuid) → jsonb` (mảng `{id, payDate, amount, method, note}`)
  - `pc49.save_receipt_settlement(p_request_key text, p_receipt_key uuid, p_payload jsonb) → {settlementId, owed, repeated}`, payload `{payDate, amount, method, note}`
  - `pc49.void_receipt_settlement(p_id uuid, p_reason text, p_on_date date DEFAULT NULL) → uuid` (bút toán đảo)
  - `void_gold_receipt` ném `RECEIPT_HAS_SETTLEMENTS: N`; `correct_gold_receipt` chuyển lần trả sang phiếu mới, ném `RECEIPT_HAS_SETTLEMENTS: N` khi đổi mua↔bán.

- [ ] **Step 1: Viết test**

```ts path=tests/sql/settlement.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'
import { SIX_ITEMS, purchaseLine, receiptPayload } from '../support/receipt'
import { GRAIN_TO_RP, conversionPayload } from '../support/conversion'

// "đợt sau thanh toán tiếp" (17-09-2026): what is still owed on a receipt is
// paid later, a payment at a time, each on its own day (0083).

let db: PGlite
const KT = '11111111-1111-1111-1111-111111111111'
const GS = '22222222-2222-2222-2222-222222222222'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email)
      VALUES ('${KT}', 'accountant@ctyhp.vn'), ('${GS}', 'supervisor@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role)
      VALUES ('${KT}', 'Ke toan', 'KT'), ('${GS}', 'Giam sat', 'GS_US');
  `)
}, 60_000)

afterAll(async () => { await db?.close() })

type Saved = { receiptId: string; docNo: string }
type Paid = { settlementId: string; owed: number; repeated: boolean }

async function save(key: string, body: string): Promise<Saved> {
  const r = await asRole(db, KT, () => db.query<{ r: Saved }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

async function settle(key: string, receiptKey: string, payment: Record<string, unknown>,
  as = KT): Promise<Paid> {
  const r = await asRole(db, as, () => db.query<{ r: Paid }>(
    `SELECT pc49.save_receipt_settlement($1, $2, $3::jsonb) AS r`,
    [key, receiptKey, JSON.stringify({ method: 'CASH', note: null, ...payment })]))
  return r.rows[0].r
}

async function unsettle(id: string, reason = 'nhap nham'): Promise<string | null> {
  const r = await asRole(db, KT, () => db.query<{ r: string | null }>(
    `SELECT pc49.void_receipt_settlement($1, $2) AS r`, [id, reason]))
  return r.rows[0].r
}

async function correct(key: string, original: string, body: string): Promise<Saved> {
  const revision = (await db.query<{ revision: number }>(
    `SELECT revision FROM pc49.gold_receipt WHERE id = $1`, [original])).rows[0].revision
  const r = await asRole(db, KT, () => db.query<{ r: Saved }>(
    `SELECT pc49.correct_gold_receipt($1, $2, $3, 'sua phieu', $4::jsonb) AS r`,
    [key, original, revision, body]))
  return r.rows[0].r
}

async function cancel(original: string): Promise<number> {
  const r = await asRole(db, KT, () => db.query<{ n: number }>(
    `SELECT pc49.void_gold_receipt($1, 'nhap trung') AS n`, [original]))
  return r.rows[0].n
}

const owed = async (key: string) => Number((await db.query<{ o: string }>(
  `SELECT pc49.gold_receipt_owed($1)::text AS o`, [key])).rows[0].o)

/** The line a later payment posted, with its day, number and partner. */
async function postedFor(settlementId: string) {
  const r = await db.query<{
    day: string; doc: string; partner: string; dr: string; cr: string; amount: number
  }>(
    `SELECT e.entry_date::text AS day, e.doc_no_hp AS doc, e.partner_code AS partner,
            jl.debit_account AS dr, jl.credit_account AS cr, jl.amount_usd::float8 AS amount
       FROM pc49.gold_receipt_settlement s
       JOIN pc49.journal_entry e ON e.id = s.journal_entry_id
       JOIN pc49.journal_line jl ON jl.entry_id = e.id
      WHERE s.id = $1`, [settlementId])
  return r.rows
}

/** The six items of 17-09, 8,361.00, of which 5,000.00 paid in cash. */
const partPaid = (partnerCode: string) => receiptPayload({
  partnerCode, payments: [{ amount: 5000, method: 'CASH' }],
})

/** One luong of Rong Phung sold for 5,000.00. */
const saleOf = (partnerCode: string, paid: number) => receiptPayload({
  txnType: 'SALE', partnerCode,
  lines: [{ itemDesc: 'RP 1 luong', goldTypeCode: 'RP', uom: 'LUONG', qty: -1,
            unitPrice: 5000, amount: 5000, scrapDetail: null, goldPct: null }],
  payments: paid > 0 ? [{ amount: paid, method: 'CASH' }] : [],
})

describe('paying the rest later', () => {
  it('books a later payment on its own day, against the seller', async () => {
    const saved = await save('later', partPaid('LATER'))
    expect(await owed(saved.receiptId)).toBe(3361)

    const paid = await settle('later-1', saved.receiptId,
      { payDate: '2026-06-20', amount: 2000, method: 'ZELLE' })
    expect(paid.repeated).toBe(false)
    expect(Number(paid.owed)).toBe(1361)
    expect(await postedFor(paid.settlementId)).toEqual([
      { day: '2026-06-20', doc: saved.docNo, partner: 'LATER', dr: '331', cr: '1121ZL', amount: 2000 },
    ])
    expect(await owed(saved.receiptId)).toBe(1361)
  })

  it('settles the rest to nothing', async () => {
    const saved = await save('to-nothing', partPaid('NOTHING'))
    await settle('to-nothing-1', saved.receiptId, { payDate: '2026-06-02', amount: 3361 })
    expect(await owed(saved.receiptId)).toBe(0)
  })

  it('takes a customer’s later payment into cash, clearing what they owe', async () => {
    const saved = await save('sale-later', saleOf('SALELATER', 1000))
    expect(await owed(saved.receiptId)).toBe(4000)
    const paid = await settle('sale-later-1', saved.receiptId, { payDate: '2026-06-05', amount: 4000 })
    expect(await postedFor(paid.settlementId)).toEqual([
      { day: '2026-06-05', doc: saved.docNo, partner: 'SALELATER', dr: '1111', cr: '131', amount: 4000 },
    ])
    expect(await owed(saved.receiptId)).toBe(0)
  })

  it('settles a purchase saved before receipts, by its own id', async () => {
    const r = await asRole(db, KT, () => db.query<{ r: { txnId: string } }>(
      `SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`,
      ['lone-part', JSON.stringify({
        txnDate: '2026-06-02', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM', qty: 10,
        unitPrice: 60, amount: -600, partnerCode: 'LONEPART', scrapDetail: null, goldPct: null,
        remarks: null, payments: [{ amount: 400, method: 'CASH' }], salesPeople: [],
      })]))
    const lone = r.rows[0].r.txnId
    expect(await owed(lone)).toBe(200)
    await settle('lone-part-1', lone, { payDate: '2026-06-04', amount: 200 })
    expect(await owed(lone)).toBe(0)
  })

  it('is one payment however many times it is sent', async () => {
    const saved = await save('twice', partPaid('TWICE'))
    const payment = { payDate: '2026-06-03', amount: 100 }
    const first = await settle('twice-1', saved.receiptId, payment)
    const again = await settle('twice-1', saved.receiptId, payment)
    expect(again).toMatchObject({ settlementId: first.settlementId, repeated: true })
    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt_settlement WHERE receipt_key = $1`,
      [saved.receiptId])
    expect(n.rows[0].n).toBe('1')
    await expect(settle('twice-1', saved.receiptId, { ...payment, amount: 200 }))
      .rejects.toThrow(/REQUEST_KEY_REUSED/)
  })
})

describe('what a later payment is refused for', () => {
  let receipt: Saved
  beforeAll(async () => { receipt = await save('refusals', partPaid('REFUSE')) })

  it('more than is owed', async () => {
    await expect(settle('over', receipt.receiptId, { payDate: '2026-06-03', amount: 4000 }))
      .rejects.toThrow(/SETTLEMENT_OVER: owed 3361(\.00)? paid 4000(\.00)?/)
  })

  it('nothing at all', async () => {
    await expect(settle('zero', receipt.receiptId, { payDate: '2026-06-03', amount: 0 }))
      .rejects.toThrow(/SETTLEMENT_AMOUNT/)
  })

  it('a day before the receipt', async () => {
    await expect(settle('early', receipt.receiptId, { payDate: '2026-06-01', amount: 100 }))
      .rejects.toThrow(/SETTLEMENT_DATE: receipt 2026-06-02/)
  })

  it('a day in a closed month', async () => {
    await db.query(`INSERT INTO pc49.accounting_period (period, status, closed_at)
                    VALUES ('2026-11', 'CLOSED', now())`)
    await expect(settle('closed', receipt.receiptId, { payDate: '2026-11-10', amount: 100 }))
      .rejects.toThrow(/SETTLEMENT_PERIOD: 2026-11/)
  })

  it('a conversion, which has nothing to pay', async () => {
    const c = await asRole(db, KT, () => db.query<{ r: { conversionId: string } }>(
      `SELECT pc49.save_gold_conversion($1, $2::jsonb) AS r`,
      ['conversion', conversionPayload(GRAIN_TO_RP)]))
    await expect(settle('conversion-pay', c.rows[0].r.conversionId,
      { payDate: '2026-06-03', amount: 100 })).rejects.toThrow(/SETTLEMENT_KIND/)
  })

  it('a cancelled receipt', async () => {
    const saved = await save('gone', partPaid('GONE'))
    await cancel(saved.receiptId)
    await expect(settle('gone-pay', saved.receiptId, { payDate: '2026-06-03', amount: 100 }))
      .rejects.toThrow(/RECEIPT_VOIDED/)
  })

  it('a purchase booked before what is owed was, until it is saved again', async () => {
    // Posted the way 0015 did: stock at what was paid, nothing against 331.
    const t = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, partner_code)
       VALUES ('2026-06-02', 'PO', 'SG', 'GRAM', 10, 60, -600, 'OLDWAY') RETURNING id`)
    const id = t.rows[0].id
    await db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                    VALUES ($1, 1, 'AP', 400, 'CASH')`, [id])
    const e = await db.query<{ id: string }>(
      `INSERT INTO pc49.journal_entry (entry_date, period, txn_kind, memo)
       VALUES ('2026-06-02', '2026-06', 'PO', 'the old way') RETURNING id`)
    await db.query(`INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
                    VALUES ($1, 1, '155SG', '1111', 400)`, [e.rows[0].id])
    await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`, [e.rows[0].id])
    await db.query(`UPDATE pc49.gold_txn SET journal_entry_id = $1 WHERE id = $2`, [e.rows[0].id, id])

    await expect(settle('old-way', id, { payDate: '2026-06-03', amount: 100 }))
      .rejects.toThrow(/SETTLEMENT_OLD_POSTING/)
  })

  it('somebody who may only read', async () => {
    await expect(settle('supervisor', receipt.receiptId, { payDate: '2026-06-03', amount: 100 }, GS))
      .rejects.toThrow()
  })
})

describe('cancelling a later payment', () => {
  it('reverses its entry on its own day, and the money is owed again', async () => {
    const saved = await save('undo', partPaid('UNDO'))
    const paid = await settle('undo-1', saved.receiptId,
      { payDate: '2026-06-06', amount: 1000, method: 'CHECK' })
    const reversal = await unsettle(paid.settlementId)
    const lines = await db.query<{ day: string; dr: string; cr: string; amount: number }>(
      `SELECT e.entry_date::text AS day, jl.debit_account AS dr, jl.credit_account AS cr,
              jl.amount_usd::float8 AS amount
         FROM pc49.journal_entry e JOIN pc49.journal_line jl ON jl.entry_id = e.id
        WHERE e.id = $1`, [reversal])
    expect(lines.rows).toEqual([{ day: '2026-06-06', dr: '1121CK', cr: '331', amount: 1000 }])
    expect(await owed(saved.receiptId)).toBe(3361)
    const listed = await db.query<{ s: unknown[] }>(
      `SELECT pc49.gold_receipt_settlements($1) AS s`, [saved.receiptId])
    expect(listed.rows[0].s).toEqual([])
  })

  it('says a cancelled payment is already cancelled', async () => {
    const saved = await save('undo-twice', partPaid('UNDO2'))
    const paid = await settle('undo-twice-1', saved.receiptId, { payDate: '2026-06-06', amount: 10 })
    await unsettle(paid.settlementId)
    await expect(unsettle(paid.settlementId)).rejects.toThrow(/SETTLEMENT_VOIDED/)
  })
})

describe('a receipt with later payments on it', () => {
  it('is not cancelled while they stand', async () => {
    const saved = await save('keep', partPaid('KEEP'))
    const paid = await settle('keep-1', saved.receiptId, { payDate: '2026-06-07', amount: 500 })
    await expect(cancel(saved.receiptId)).rejects.toThrow(/RECEIPT_HAS_SETTLEMENTS: 1/)
    await unsettle(paid.settlementId)
    expect(await cancel(saved.receiptId)).toBe(6)
  })

  it('takes them along when it is corrected', async () => {
    const saved = await save('move', partPaid('MOVE'))
    const paid = await settle('move-1', saved.receiptId, { payDate: '2026-06-08', amount: 1000 })
    const fixed = await correct('move-fix', saved.receiptId, receiptPayload({
      partnerCode: 'MOVE', lines: SIX_ITEMS.slice(0, 5).map(purchaseLine),
      payments: [{ amount: 5000, method: 'CASH' }],
    }))
    const moved = await db.query<{ key: string }>(
      `SELECT receipt_key::text AS key FROM pc49.gold_receipt_settlement WHERE id = $1`,
      [paid.settlementId])
    expect(moved.rows[0].key).toBe(fixed.receiptId)
    expect(await owed(fixed.receiptId)).toBe(2325)
    expect(await owed(saved.receiptId)).toBe(0)
  })

  it('cannot turn from a purchase into a sale while they stand', async () => {
    const saved = await save('turn', partPaid('TURN'))
    await settle('turn-1', saved.receiptId, { payDate: '2026-06-09', amount: 1000 })
    await expect(correct('turn-fix', saved.receiptId, saleOf('TURN', 5000)))
      .rejects.toThrow(/RECEIPT_HAS_SETTLEMENTS: 1/)
  })
})
```

- [ ] **Step 2: Chạy, phải đỏ** — `npx vitest run tests/sql/settlement.test.ts`. Mong đợi: FAIL, `function pc49.gold_receipt_owed(unknown) does not exist`.

- [ ] **Step 3: Viết migration**

```sql path=supabase/migrations/0083_a_receipt_is_paid_in_instalments.sql
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
```

- [ ] **Step 4: Chạy lại, phải xanh** — `npx vitest run tests/sql/settlement.test.ts`. Mong đợi: PASS.

- [ ] **Step 5: Commit** — `git add supabase/migrations/0083_a_receipt_is_paid_in_instalments.sql tests/sql/settlement.test.ts && git commit -m "feat(receipt): what is owed on a receipt is paid later, a payment at a time"`

---

### Task 3: Sổ cho thấy lần trả sau và số còn nợ (0084)

**Files:**
- Create: `supabase/migrations/0084_the_ledger_shows_what_is_owed.sql`
- Create: `tests/sql/settlement-ledger.test.ts`

**Interfaces:**
- Consumes: `gold_receipt_owed`, `gold_receipt_settlements`, bảng lần trả sau (Task 2).
- Produces: `pc49.gold_receipt_ledger(...)` trả thêm `settlements jsonb`, `owed numeric` (trước `total_count`); `p_method = 'OWED'` lọc phiếu còn nợ; `p_method` là hình thức thì khớp cả lần trả sau chưa huỷ.

- [ ] **Step 1: Viết test**

```ts path=tests/sql/settlement-ledger.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'
import { receiptPayload } from '../support/receipt'

// The ledger says what was paid later and what is still owed, and finds the
// receipts something is still owed on (0084).

let db: PGlite
const KT = '11111111-1111-1111-1111-111111111111'

type Row = {
  partner_code: string
  owed: string
  settlements: { id: string; payDate: string; amount: number; method: string; note: string | null }[]
}

async function save(key: string, body: string) {
  const r = await asRole(db, KT, () => db.query<{ r: { receiptId: string } }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r.receiptId
}

async function settle(key: string, receiptKey: string, payment: Record<string, unknown>) {
  const r = await asRole(db, KT, () => db.query<{ r: { settlementId: string } }>(
    `SELECT pc49.save_receipt_settlement($1, $2, $3::jsonb) AS r`,
    [key, receiptKey, JSON.stringify({ note: null, ...payment })]))
  return r.rows[0].r.settlementId
}

async function ledger(method: string | null): Promise<Row[]> {
  const r = await db.query<Row>(
    `SELECT partner_code, owed::text, settlements
       FROM pc49.gold_receipt_ledger(p_from => '2026-04-01', p_to => '2026-04-30', p_method => $1)
      ORDER BY partner_code`, [method])
  return r.rows
}

const partners = async (method: string | null) => (await ledger(method)).map((r) => r.partner_code)
const withoutIds = (row: Row) => row.settlements.map((s) => (
  { payDate: s.payDate, amount: s.amount, method: s.method, note: s.note }))

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'accountant@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
  `)

  // OWING: 8,361.00, 5,000.00 paid at the counter, 2,000.00 by Zelle a week on.
  const owing = await save('owing', receiptPayload({
    txnDate: '2026-04-02', partnerCode: 'OWING', payments: [{ amount: 5000, method: 'CASH' }],
  }))
  await settle('owing-1', owing, { payDate: '2026-04-10', amount: 2000, method: 'ZELLE', note: 'dot 2' })

  // PAIDUP: paid in full at the counter, in cash and by wire.
  await save('paidup', receiptPayload({ txnDate: '2026-04-03', partnerCode: 'PAIDUP' }))

  // UNDONE: a Zelle payment recorded against it, then cancelled.
  const undone = await save('undone', receiptPayload({
    txnDate: '2026-04-05', partnerCode: 'UNDONE', payments: [{ amount: 5000, method: 'CASH' }],
  }))
  const typo = await settle('undone-1', undone, { payDate: '2026-04-06', amount: 3361, method: 'ZELLE' })
  await asRole(db, KT, () => db.query(
    `SELECT pc49.void_receipt_settlement($1, 'nhap nham')`, [typo]))
}, 60_000)

afterAll(async () => { await db?.close() })

describe('the ledger and what is owed', () => {
  it('carries a receipt’s later payments and what is still owed on it', async () => {
    const row = (await ledger(null)).find((r) => r.partner_code === 'OWING')!
    expect(Number(row.owed)).toBe(1361)
    expect(withoutIds(row)).toEqual([
      { payDate: '2026-04-10', amount: 2000, method: 'ZELLE', note: 'dot 2' },
    ])
  })

  it('owes nothing on a receipt paid in full, and lists no later payment', async () => {
    const row = (await ledger(null)).find((r) => r.partner_code === 'PAIDUP')!
    expect(Number(row.owed)).toBe(0)
    expect(row.settlements).toEqual([])
  })

  it('leaves a cancelled payment out, and the money owed again', async () => {
    const row = (await ledger(null)).find((r) => r.partner_code === 'UNDONE')!
    expect(Number(row.owed)).toBe(3361)
    expect(row.settlements).toEqual([])
  })

  it('finds the receipts something is still owed on', async () => {
    expect(await partners('OWED')).toEqual(['OWING', 'UNDONE'])
  })

  it('finds a receipt by how it was paid later, not by a payment cancelled', async () => {
    expect(await partners('ZELLE')).toEqual(['OWING'])
  })

  it('counts the same receipts in the totals', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT receipt_count::text AS n
         FROM pc49.gold_receipt_ledger_totals(p_from => '2026-04-01', p_to => '2026-04-30',
                                              p_method => 'OWED')`)
    expect(r.rows[0].n).toBe('2')
  })
})
```

- [ ] **Step 2: Chạy, phải đỏ** — `npx vitest run tests/sql/settlement-ledger.test.ts`. Mong đợi: FAIL, `column "owed" does not exist`.

- [ ] **Step 3: Viết migration**

```sql path=supabase/migrations/0084_the_ledger_shows_what_is_owed.sql
-- 0084_the_ledger_shows_what_is_owed.sql
-- The gold ledger says what was paid on a receipt later, and what is still owed.
--
--   gold_receipt_ledger_match  the payment filter also takes OWED, the receipts
--                              something is still owed on; and a way of paying
--                              finds a receipt paid that way later, not only at
--                              the counter
--   gold_receipt_ledger        returns the later payments still standing and
--                              what is owed (0083), after the conversion columns
--   gold_receipt_paid_later_with  a later payment still standing was made this
--                              way. Its own function, as gold_txn_paid_with is:
--                              a sub-select written into the match itself would
--                              stop the match being folded into the query (0069)

CREATE OR REPLACE FUNCTION pc49.gold_receipt_paid_later_with(p_key uuid, p_method text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pc49.gold_receipt_settlement s
                  WHERE s.receipt_key = p_key AND s.voided_at IS NULL
                    AND s.method::text = p_method)
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_ledger_match(
  t        pc49.gold_txn,
  p_from   date,
  p_to     date,
  p_type   text,
  p_gold   text,
  p_staff  text,
  p_method text,
  p_status text,
  p_query  text)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT t.voided_at IS NULL
     AND (p_from IS NULL OR t.txn_date >= p_from)
     AND (p_to IS NULL OR t.txn_date <= p_to)
     AND (p_type IS NULL OR t.txn_type::text = p_type)
     AND (p_gold IS NULL OR t.gold_type_code = p_gold)
     AND (p_staff IS NULL
          OR t.sales_person_code = p_staff
          OR pc49.gold_txn_shared_by(t.id, p_staff))
     AND (p_method IS NULL
          OR (p_method = 'OWED'
              AND pc49.gold_receipt_owed(coalesce(t.receipt_id, t.conversion_id, t.id)) > 0)
          OR pc49.gold_txn_paid_with(t.id, p_method)
          OR pc49.gold_receipt_paid_later_with(coalesce(t.receipt_id, t.conversion_id, t.id), p_method))
     AND (p_status IS NULL
          OR (p_status = 'correctable'
              AND NOT pc49.gold_receipt_locked(coalesce(t.receipt_id, t.conversion_id, t.id)))
          OR (p_status = 'locked'
              AND pc49.gold_receipt_locked(coalesce(t.receipt_id, t.conversion_id, t.id))))
     AND (p_query IS NULL
          OR pc49.fold_search(p_query) = ''
          OR pc49.fold_search(t.doc_no) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.partner_code) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.remarks) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.item_desc) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.partner_phone_matches(t.partner_code, p_query))
$$;

-- The row gains two columns, and a function's result cannot be changed in place.
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
  settlements jsonb, owed numeric,
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

GRANT EXECUTE ON FUNCTION pc49.gold_receipt_paid_later_with(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0084_the_ledger_shows_what_is_owed')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Chạy lại, phải xanh; rồi cả bộ SQL** — `npx vitest run tests/sql/settlement-ledger.test.ts`, sau đó `npx vitest run tests/sql --maxWorkers=4`. Mong đợi: PASS hết.

- [ ] **Step 5: Commit** — `git add supabase/migrations/0084_the_ledger_shows_what_is_owed.sql tests/sql/settlement-ledger.test.ts && git commit -m "feat(ledger): a receipt row says what was paid later and what is still owed"`

> Ghi chú khi làm Task 3: cả bộ SQL lộ ra hai điều, đã sửa ngay trong khối mã ở trên.
> (1) `gold_receipt_ledger_match` phải gộp được vào câu truy vấn (0069), nên phần "trả sau bằng hình thức" nằm trong hàm riêng `gold_receipt_paid_later_with`.
> (2) `post_import_batch` (0064) vẫn nêu tên dòng nạp là phiếu mua không có thanh toán nào, thay vì ghi thành nợ 331; nằm trong 0082.

---

### Task 4: Đọc dòng sổ, bộ lọc, câu báo lỗi, file Excel

**Files:**
- Create: `src/components/gold/settlement.ts`, `tests/lib/settlement.test.ts`
- Modify: `src/components/gold/types.ts`, `ledgerRow.ts`, `ledgerQuery.ts`, `receiptErrors.ts`, `ledgerCsv.ts`
- Modify: `src/lib/i18n/ui-gold.ts`, `src/lib/i18n/dictionary.ts`
- Test: `tests/lib/receipt-row.test.ts`, `receipt-errors.test.ts`, `ledger-csv.test.ts`, `ledger-query.test.ts`

**Interfaces:**
- Consumes: cột `settlements`, `owed` của `gold_receipt_ledger` (Task 3).
- Produces:
  - `type Settlement = { id: string; payDate: string; amount: number; method: string; note: string | null }`
  - `ReceiptRow.settlements?: Settlement[]`, `ReceiptRow.owed?: number`
  - `SETTLEABLE_TYPES: Set<string>`, `owes(row): boolean`, `canSettle(row): boolean`, `paidSoFar(row): number` trong `settlement.ts`
  - `OWED = 'OWED'`, `PAYMENT_FILTERS` trong `ledgerQuery.ts`
  - khoá chữ `settle.*`, `receipt.owed`, `receipt.col.paid`, `receipt.col.owed`, `receipt.err.hasSettlements`, `txn.filter.owed`, `txn.type.transfer`

- [ ] **Step 1: Test mới**

```ts path=tests/lib/settlement.test.ts
import { describe, it, expect } from 'vitest'
import { canSettle, owes, paidSoFar } from '@/components/gold/settlement'
import type { ReceiptRow } from '@/components/gold/types'

type Settleable = Pick<ReceiptRow, 'txn_type' | 'conversion' | 'owed' | 'settlements'>
const row = (over: Partial<Settleable> = {}): Settleable =>
  ({ txn_type: 'PO', conversion: null, owed: 0, settlements: [], ...over })
const later = { id: 's', payDate: '2026-09-20', amount: 5, method: 'CASH', note: null }

describe('paying the rest of a receipt later', () => {
  it('is offered on a purchase or a sale that still owes', () => {
    expect(canSettle(row({ owed: 10 }))).toBe(true)
    expect(canSettle(row({ txn_type: 'SALE', owed: 0.01 }))).toBe(true)
  })

  it('stays offered once paid up, so a later payment can still be cancelled', () => {
    expect(canSettle(row({ settlements: [later] }))).toBe(true)
  })

  it('is not offered where nothing is owed or can be', () => {
    expect(canSettle(row())).toBe(false)
    expect(canSettle(row({ txn_type: 'DEPOSIT', owed: 10 }))).toBe(false)
    expect(canSettle(row({
      owed: 10, conversion: { id: 'c', kind: 'TRANSFER', varianceNote: null, varianceReason: null },
    }))).toBe(false)
  })

  it('counts less than half a cent as paid', () => {
    expect(owes({ owed: 0.004 })).toBe(false)
    expect(owes({})).toBe(false)
  })

  it('adds up what was paid at the counter and since, to the cent', () => {
    expect(paidSoFar({
      payments: [{ seq: 1, amount: 0.1, method: 'CASH' }, { seq: 2, amount: 0.2, method: 'ZELLE' }],
      settlements: [{ ...later, amount: 1000.05 }],
    })).toBe(1000.35)
  })
})
```

- [ ] **Step 2: Thêm vào cuối `tests/lib/receipt-row.test.ts`**

```ts
describe('what was paid later, and what is owed', () => {
  it('reads the later payments and what is owed as numbers', () => {
    const row = toReceiptRow({
      receipt_key: 'k2', receipt_id: 'k2', txn_date: '2026-09-16', doc_no: 'PC49-2609-011',
      txn_type: 'PO', revision: 1, amount: '-8361.00', lines: [], sold_by: [],
      payments: [{ seq: 1, amount: '5000.00', method: 'CASH' }],
      settlements: [{ id: 's1', payDate: '2026-09-20', amount: '2000.00', method: 'ZELLE', note: null }],
      owed: '1361.00',
    })
    expect(row.settlements).toEqual([
      { id: 's1', payDate: '2026-09-20', amount: 2000, method: 'ZELLE', note: null },
    ])
    expect(row.owed).toBe(1361)
  })

  it('reads a row without them as owing nothing', () => {
    const row = toReceiptRow({
      receipt_key: 'k3', txn_date: '2026-09-16', txn_type: 'PO', lines: [], payments: [], sold_by: [],
    })
    expect(row.settlements).toEqual([])
    expect(row.owed).toBe(0)
  })
})
```

- [ ] **Step 3: Thêm vào `tests/lib/receipt-errors.test.ts`** (trong describe chính, trước `it('passes anything else through as it came'`)

```ts
  it('says what is wrong with a later payment', () => {
    expect(describeRefusal('SETTLEMENT_OVER: owed 3361.00 paid 4000.00', say))
      .toBe('Số tiền 4,000.00 lớn hơn số còn nợ 3,361.00.')
    expect(describeRefusal('SETTLEMENT_DATE: receipt 2026-06-02, paid 2026-06-01; …', say))
      .toBe('Ngày trả không được trước ngày của phiếu (2026-06-02).')
    expect(describeRefusal('SETTLEMENT_PERIOD: 2026-11 is closed; …', say))
      .toBe('Tháng 2026-11 đã khoá sổ. Chọn ngày trả trong tháng còn mở.')
    expect(describeRefusal('SETTLEMENT_KIND: only a purchase …', say)).toBe(say('settle.err.kind'))
    expect(describeRefusal('SETTLEMENT_AMOUNT: a payment …', say)).toBe(say('settle.err.amount'))
    expect(describeRefusal('SETTLEMENT_OLD_POSTING: this purchase …', say)).toBe(say('settle.err.oldPosting'))
    expect(describeRefusal('SETTLEMENT_VOIDED: this payment …', say)).toBe(say('settle.err.voided'))
    expect(describeRefusal('RECEIPT_HAS_SETTLEMENTS: 2 later payment(s) …', say))
      .toBe(say('receipt.err.hasSettlements').replace('{0}', '2'))
  })
```

- [ ] **Step 4: Sửa `tests/lib/ledger-csv.test.ts`**
  - Tiêu đề: sau `'Thanh toán',` thêm `'Đã trả', 'Còn nợ',`.
  - Dòng 1: sau `'950 CASH · 1900 BANKWIRE',` thêm `2850, 0,`. Dòng 2: sau `null,` (ô Thanh toán) thêm `null, null,`.
  - Thêm test:

```ts
  it('says on the first line what was paid, later payments too, and what is owed', () => {
    const owing: ReceiptRow = {
      ...receipt,
      payments: [{ seq: 1, amount: 950, method: 'CASH' }],
      settlements: [{ id: 's1', payDate: '2026-09-20', amount: 1000, method: 'ZELLE', note: null }],
      owed: 900,
    }
    const [first, second] = ledgerSheet([owing], 'vi', gold).rows
    expect(first.slice(16, 19)).toEqual(['950 CASH · 1000 ZELLE 2026-09-20', 1950, 900])
    expect(second.slice(16, 19)).toEqual([null, null, null])
  })
```

- [ ] **Step 5: Thêm vào `tests/lib/ledger-query.test.ts`** (trong describe đầu)

```ts
  it('takes the receipts still owed as a payment filter', () => {
    expect(parseLedgerQuery({ method: 'OWED' }).method).toBe('OWED')
  })
```

- [ ] **Step 6: Chạy, phải đỏ** — `npx vitest run tests/lib/settlement.test.ts tests/lib/receipt-row.test.ts tests/lib/receipt-errors.test.ts tests/lib/ledger-csv.test.ts tests/lib/ledger-query.test.ts`

- [ ] **Step 7: `src/components/gold/settlement.ts`**

```ts path=src/components/gold/settlement.ts
import type { ReceiptRow } from './types'

/**
 * Paying the rest of a receipt later (spec 2026-09-17, 0083).
 *
 * Pure: what the ledger row and the payment form both need to agree on.
 */

/** The kinds of receipt something can be owed on (pc49.settlement_side). */
export const SETTLEABLE_TYPES = new Set(['PO', 'PO_VENDOR', 'SALE', 'PICKUP'])

/** Whether anything is still owed. Less than half a cent is paid. */
export const owes = (row: Pick<ReceiptRow, 'owed'>) => (row.owed ?? 0) >= 0.005

/**
 * Whether a row offers "Thanh toán tiếp": a purchase or a sale that still owes,
 * or one paid up by later payments, one of which may yet need cancelling.
 */
export function canSettle(
  row: Pick<ReceiptRow, 'txn_type' | 'conversion' | 'owed' | 'settlements'>,
): boolean {
  if (row.conversion || !SETTLEABLE_TYPES.has(row.txn_type)) return false
  return owes(row) || (row.settlements ?? []).length > 0
}

/** Everything paid on a receipt so far, at the counter and since, to the cent. */
export function paidSoFar(row: Pick<ReceiptRow, 'payments' | 'settlements'>): number {
  const cents = [...row.payments, ...(row.settlements ?? [])]
    .reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
  return cents / 100
}
```

- [ ] **Step 8: `types.ts`** — trước `export type ReceiptRow` thêm:

```ts
/** A payment made after the receipt, on its own day (0083). */
export type Settlement = {
  id: string
  payDate: string
  amount: number
  method: string
  note: string | null
}
```

và trong `ReceiptRow`, sau `conversion?: ConversionInfo | null`:

```ts
  /** Payments made after the receipt, still standing, oldest first (0084). */
  settlements?: Settlement[]
  /** What is still owed on it; nothing when absent (0084). */
  owed?: number
```

- [ ] **Step 9: `ledgerRow.ts`** — trong `toReceiptRow`, thêm `const settlements = (r.settlements ?? []) as Record<string, unknown>[]` cạnh các `const` đầu, và sau khối `conversion: …,`:

```ts
    settlements: settlements.map((s) => ({
      id: String(s.id),
      payDate: String(s.payDate),
      amount: Number(s.amount),
      method: String(s.method),
      note: text(s.note),
    })),
    owed: Number(r.owed ?? 0),
```

- [ ] **Step 10: `ledgerQuery.ts`** — sau `export const DEFAULT_PAGE_SIZE = 50`:

```ts
/** Not a way of paying: the receipts something is still owed on (0084). */
export const OWED = 'OWED'
export const PAYMENT_FILTERS = [...PAYMENT_METHODS, OWED] as const
```

và `method: oneOf(first(params.method), PAYMENT_METHODS),` → `method: oneOf(first(params.method), PAYMENT_FILTERS),`.

- [ ] **Step 11: `receiptErrors.ts`** — sau dòng `if (/CONVERSION_VOIDED/.test(message)) …`:

```ts
  // A later payment's refusals (0083) carry the figures and the days to say.
  const over = /SETTLEMENT_OVER: owed ([\d.]+) paid ([\d.]+)/.exec(message)
  if (over) return t('settle.err.over').replace('{0}', cents(over[1])).replace('{1}', cents(over[2]))
  const early = /SETTLEMENT_DATE: receipt (\d{4}-\d{2}-\d{2})/.exec(message)
  if (early) return t('settle.err.date').replace('{0}', early[1])
  const closed = /SETTLEMENT_PERIOD: (\d{4}-\d{2})/.exec(message)
  if (closed) return t('settle.err.period').replace('{0}', closed[1])
  if (/SETTLEMENT_KIND/.test(message)) return t('settle.err.kind')
  if (/SETTLEMENT_AMOUNT/.test(message)) return t('settle.err.amount')
  if (/SETTLEMENT_OLD_POSTING/.test(message)) return t('settle.err.oldPosting')
  if (/SETTLEMENT_VOIDED/.test(message)) return t('settle.err.voided')
  const standing = /RECEIPT_HAS_SETTLEMENTS: (\d+)/.exec(message)
  if (standing) return t('receipt.err.hasSettlements').replace('{0}', standing[1])
```

và trên `export function describeRefusal`:

```ts
const cents = (figure: string) =>
  Number(figure).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
```

- [ ] **Step 12: `ledgerCsv.ts`** — thay toàn bộ file:

```ts path=src/components/gold/ledgerCsv.ts
/**
 * The gold ledger as a block of a CSV file.
 *
 * Pure: receipts in, a Sheet out; the route sends it. One line per item, as the
 * books hold them, so the amount column adds up to what the receipts came to.
 * The receipt's number, day and customer are repeated on every line so a
 * filtered or sorted sheet still says whose item it is; what was paid, later
 * payments included, and what is still owed are on the first line only,
 * because repeated they would read as paid again. Figures stay numbers, and
 * something that is not there is an empty cell.
 */
import { t, type Locale, type MessageKey } from '@/lib/i18n'
import type { Sheet } from '@/lib/export/csv'
import { toGrams } from '@/lib/domain/units'
import { fineGrams } from './receiptLine'
import { SETTLEABLE_TYPES, paidSoFar } from './settlement'
import type { ReceiptRow } from './types'

const HEADINGS: MessageKey[] = [
  'txn.date', 'txn.col.doc', 'receipt.col.line', 'receipt.itemDesc', 'txn.col.type',
  'txn.col.partner', 'txn.col.phone', 'txn.col.sales', 'txn.col.gold', 'txn.col.scrap',
  'txn.col.qty', 'txn.col.uom', 'txn.col.grams', 'receipt.fine', 'txn.col.price',
  'txn.col.amount', 'txn.col.pay', 'receipt.col.paid', 'receipt.col.owed', 'txn.col.remarks',
]

export function ledgerSheet(
  receipts: ReceiptRow[],
  locale: Locale,
  goldName: (code: string) => string,
): Sheet {
  return {
    header: HEADINGS.map((key) => t(locale, key)),
    rows: receipts.flatMap((r) => {
      // Everybody on the receipt with their share; the lead name alone only
      // when it was never divided.
      const sales = r.soldBy.length
        ? r.soldBy.map((p) => `${p.code} ${p.sharePct}%`).join(' · ')
        : r.sales_person_code
      const paid = [
        ...r.payments.map((p) => `${p.amount} ${p.method}`),
        ...(r.settlements ?? []).map((s) => `${s.amount} ${s.method} ${s.payDate}`),
      ].join(' · ')
      // Only a purchase or a sale is paid for: a memo or a conversion has no
      // figure to put in these two columns.
      const settles = !r.conversion && SETTLEABLE_TYPES.has(r.txn_type)
      return r.lines.map((l, i) => {
        const scrap = [l.scrap_detail, l.gold_pct].filter((x) => x !== null && x !== '').join(' · ')
        const fine = fineGrams(l.uom, l.qty, l.gold_pct)
        return [
          r.txn_date, r.doc_no, l.lineNo,
          // A conversion's leg has no description; which side it is on is what
          // somebody filtering the sheet needs.
          l.itemDesc ?? (l.side ? t(locale, l.side === 'out' ? 'conversion.side.out' : 'conversion.side.in') : null),
          r.txn_type,
          r.partner_code, r.partner_phone, sales || null, goldName(l.gold_type_code), scrap || null,
          l.qty, l.uom, toGrams(l.qty, l.uom), fine === null ? null : Math.round(fine * 10000) / 10000,
          l.unit_price, l.amount, i === 0 ? (paid || null) : null,
          i === 0 && settles ? paidSoFar(r) : null,
          i === 0 && settles ? (r.owed ?? 0) : null,
          r.remarks,
        ]
      })
    }),
  }
}
```

- [ ] **Step 13: Chữ.** Trong `src/lib/i18n/ui-gold.ts`, khối `vi`:
  - sửa: `'receipt.gap.under': 'Còn nợ {0}. Vẫn lưu được; phần còn lại thanh toán tiếp trên sổ.'`, `'receipt.err.paymentShort': 'Đặt cọc phải có tiền cọc.'`, `'txn.newConversion': 'Transfer'`, `'conversion.title': 'Transfer — quy đổi vàng'`, `'conversion.correctTitle': 'Sửa transfer'`, `'conversion.kind.TRANSFER': 'Transfer (quy đổi)'`
  - thêm trước `'txn.newConversion'`:

```ts
    'receipt.err.hasSettlements': 'Phiếu đang có {0} lần thanh toán tiếp. Huỷ các lần đó trước khi huỷ phiếu, hoặc trước khi đổi phiếu giữa mua và bán.',
    'receipt.owed': 'Còn nợ {0}',
    'receipt.col.paid': 'Đã trả',
    'receipt.col.owed': 'Còn nợ',
    'txn.filter.owed': 'Còn nợ',
    'txn.type.transfer': 'TRANSFER (quy đổi vàng)',
    'settle.open': 'Thanh toán tiếp',
    'settle.title': 'Thanh toán tiếp — {0}',
    'settle.receiptTotal': 'Tổng phiếu',
    'settle.paid': 'Đã trả',
    'settle.owed': 'Còn nợ',
    'settle.atCounter': 'Trả lúc lập phiếu',
    'settle.later': 'Các lần trả sau',
    'settle.noneAtCounter': 'Không trả đồng nào lúc lập phiếu.',
    'settle.noneLater': 'Chưa có lần trả sau.',
    'settle.new': 'Ghi lần trả mới',
    'settle.payDate': 'Ngày trả',
    'settle.amount': 'Số tiền',
    'settle.note': 'Ghi chú',
    'settle.save': 'Lưu lần trả',
    'settle.paidUp': 'Phiếu đã trả đủ.',
    'settle.void': 'Huỷ lần trả này',
    'settle.voidWhy': 'Lý do huỷ lần trả này',
    'settle.voidConfirm': 'Huỷ lần trả',
    'settle.saved': 'Đã ghi lần trả cho {0}',
    'settle.voided': 'Đã huỷ lần trả',
    'settle.err.over': 'Số tiền {1} lớn hơn số còn nợ {0}.',
    'settle.err.amount': 'Số tiền phải lớn hơn 0.',
    'settle.err.date': 'Ngày trả không được trước ngày của phiếu ({0}).',
    'settle.err.period': 'Tháng {0} đã khoá sổ. Chọn ngày trả trong tháng còn mở.',
    'settle.err.kind': 'Chỉ phiếu mua vào và bán ra mới thanh toán tiếp được.',
    'settle.err.oldPosting': 'Phiếu này ghi sổ theo cách cũ. Bấm Sửa rồi Lưu phiếu một lần, sau đó thanh toán tiếp.',
    'settle.err.voided': 'Lần trả này đã được huỷ.',
```

  khối `en`:
  - sửa: `'receipt.gap.under': '{0} still owed. It saves; pay the rest later from the ledger.'`, `'receipt.err.paymentShort': 'A deposit needs its deposit.'`, `'txn.newConversion': 'Transfer'`, `'conversion.title': 'Transfer — convert gold'`, `'conversion.correctTitle': 'Correct transfer'`, `'conversion.kind.TRANSFER': 'Transfer (convert)'`
  - thêm trước `'txn.newConversion'`:

```ts
    'receipt.err.hasSettlements': '{0} later payment(s) stand on this receipt. Cancel them before cancelling the receipt, or before turning it between a purchase and a sale.',
    'receipt.owed': '{0} owed',
    'receipt.col.paid': 'Paid',
    'receipt.col.owed': 'Owed',
    'txn.filter.owed': 'Still owed',
    'txn.type.transfer': 'TRANSFER (convert gold)',
    'settle.open': 'Pay the rest',
    'settle.title': 'Pay the rest — {0}',
    'settle.receiptTotal': 'Receipt total',
    'settle.paid': 'Paid',
    'settle.owed': 'Owed',
    'settle.atCounter': 'Paid at the counter',
    'settle.later': 'Paid later',
    'settle.noneAtCounter': 'Nothing was paid at the counter.',
    'settle.noneLater': 'No later payment yet.',
    'settle.new': 'A new payment',
    'settle.payDate': 'Paid on',
    'settle.amount': 'Amount',
    'settle.note': 'Note',
    'settle.save': 'Save payment',
    'settle.paidUp': 'Paid in full.',
    'settle.void': 'Cancel this payment',
    'settle.voidWhy': 'Why is this payment cancelled?',
    'settle.voidConfirm': 'Cancel payment',
    'settle.saved': 'Payment recorded on {0}',
    'settle.voided': 'Payment cancelled',
    'settle.err.over': '{1} is more than the {0} still owed.',
    'settle.err.amount': 'The amount must be more than zero.',
    'settle.err.date': 'A payment cannot be dated before its receipt ({0}).',
    'settle.err.period': '{0} is closed. Pick a day in an open month.',
    'settle.err.kind': 'Only a purchase or a sale can be paid later.',
    'settle.err.oldPosting': 'This receipt was booked the old way. Press Correct and save it once, then pay.',
    'settle.err.voided': 'This payment has already been cancelled.',
```

  Trong `dictionary.ts`: `'txn.form.paymentRequired': 'Đặt cọc phải có ít nhất một khoản thanh toán'` và `'txn.form.paymentRequired': 'A deposit needs at least one payment'`.

- [ ] **Step 14: Chạy, phải xanh** — lệnh Step 6, rồi `npx vitest run tests/lib`.

- [ ] **Step 15: Commit** — `git add src/components/gold src/lib/i18n tests/lib && git commit -m "feat(ledger): read what was paid later and what is owed, filter it, and export it"`

---

### Task 5: Màn hình — Transfer, Thanh toán tiếp

**Files:**
- Create: `src/components/gold/SettlementForm.tsx`
- Modify: `src/app/(app)/gold-transactions/actions.ts`, `src/components/gold/TxnScreen.tsx`, `src/components/gold/ReceiptForm.tsx`
- Test: `tests/lib/txn-ledger-screen.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`canSettle`, `owes`, `paidSoFar`, `OWED`, chữ); RPC `save_receipt_settlement`, `void_receipt_settlement`.
- Produces:
  - `saveSettlement(input) → { ok: true; id; owed; repeated } | { ok: false; message }`, input `{ requestKey, key, payDate, amount, method, note }`
  - `voidSettlement(input) → { ok: true } | { ok: false; message }`, input `{ id, reason }`
  - `ReceiptForm` prop `onTransfer?: (txnDate: string) => void`

- [ ] **Step 1: Test màn sổ.** Trong `tests/lib/txn-ledger-screen.test.tsx`, ở test conversion đổi `expect(html).toContain('Quy đổi vàng')` thành `expect(html).toContain('TRANSFER')`, và thêm:

```tsx
  it('offers Transfer beside a new receipt', () => {
    expect(text(<TxnScreen {...base} />)).toContain('Transfer')
  })

  it('shows what was paid later and what is still owed on a row', () => {
    const owing: ReceiptRow = {
      ...sale, key: '9', doc_no: 'PC49-2609-020',
      payments: [{ seq: 1, amount: 3000, method: 'CASH' }],
      settlements: [{ id: 's1', payDate: '2026-09-20', amount: 1000, method: 'ZELLE', note: null }],
      owed: 1425,
    }
    const html = text(<TxnScreen {...base} rows={[owing]}
      totals={{ count: 1, purchases: 0, sales: 5425, grams: {} }} />)
    expect(html).toContain('1,000.00 ZELLE · 2026-09-20')
    expect(html).toContain('Còn nợ 1,425.00')
  })
```

- [ ] **Step 2: Chạy, phải đỏ** — `npx vitest run tests/lib/txn-ledger-screen.test.tsx`

- [ ] **Step 3: Actions.** Thêm vào cuối `actions.ts`:

```ts
const settlementSchema = z.object({
  // Stable for the life of one payment on screen, so pressing Save twice is one payment.
  requestKey: z.string().uuid(),
  key: z.string().uuid(),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive('the amount must be more than zero'),
  method: z.enum(PAYMENT_METHODS),
  note: z.string().trim().max(500).nullable().default(null),
})

export type SettlementResult =
  | { ok: true; id: string; owed: number; repeated: boolean }
  | { ok: false; message: string }

/**
 * Records a payment made after the receipt, on the day it was made, and posts
 * it (0083). The receipt itself is not touched.
 */
export async function saveSettlement(input: unknown): Promise<SettlementResult> {
  const parsed = settlementSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid payment' }
  }
  const s = parsed.data
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('save_receipt_settlement', {
    p_request_key: s.requestKey,
    p_receipt_key: s.key,
    p_payload: { payDate: s.payDate, amount: s.amount, method: s.method, note: s.note },
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { settlementId: string; owed: number | string; repeated: boolean }
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.settlementId, owed: Number(result.owed), repeated: result.repeated }
}

const settlementVoidSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, 'say why in a few words'),
})

/** Cancels a later payment: its entry reversed on its own day (0083). */
export async function voidSettlement(input: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = settlementVoidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('void_receipt_settlement', {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
    p_on_date: null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/gold-transactions')
  return { ok: true }
}
```

- [ ] **Step 4: Hộp Thanh toán tiếp**

```tsx path=src/components/gold/SettlementForm.tsx
'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useRef, useState, type CSSProperties } from 'react'
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Typography,
} from 'antd'
import { Ban, Check } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { saveSettlement, voidSettlement } from '@/app/(app)/gold-transactions/actions'
import { IconAction } from '@/components/ui/IconAction'
import { money } from '@/components/ledger/Ledger'
import { describeRefusal } from './receiptErrors'
import { owes, paidSoFar } from './settlement'
import { PAYMENT_METHODS, type ReceiptRow, type Settlement } from './types'
import styles from './Txn.module.css'

type Values = { payDate: string; amount: number | null; method: string; note: string }

const LIST: CSSProperties = { listStyle: 'none', margin: '0 0 16px', padding: 0 }

/** One figure of the receipt, its name above it. */
function Figure({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div><Typography.Text strong type={danger ? 'danger' : undefined}>{value}</Typography.Text></div>
    </div>
  )
}

/**
 * Paying the rest of a receipt later: "đợt sau thanh toán tiếp" (17-09).
 *
 * What the receipt came to, what was paid at the counter and since, and what
 * is still owed. A later payment typed in error is cancelled here, with a
 * reason; while anything is owed another is recorded, on the day it was made.
 * Each goes to the books on its own (0083): the receipt is not touched.
 */
export function SettlementForm({ row, today, onClose, onDone }: {
  row: ReceiptRow
  /** The server's date: a payment is made today unless said otherwise. */
  today: string
  onClose: () => void
  /** Something was written; the sentence says what. */
  onDone: (message: string) => void
}) {
  const { t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState<Settlement | null>(null)
  const [reason, setReason] = useState('')
  /** Pressing Save twice, or again after a lost answer, is still one payment. */
  const requestKey = useRef<string>(crypto.randomUUID())

  const owed = row.owed ?? 0
  const later = row.settlements ?? []
  const canPay = owes(row)
  const doc = row.doc_no ?? '—'

  const refused = (result: { ok: false; message: string }) =>
    setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))

  async function save() {
    setError(null)
    let v: Values
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    const result = await settleAction(() => saveSettlement({
      requestKey: requestKey.current,
      key: row.key,
      payDate: v.payDate,
      amount: Number(v.amount ?? 0),
      method: v.method,
      note: v.note?.trim() || null,
    }))
    setSaving(false)
    if (!result.ok) {
      refused(result)
      return
    }
    onDone(t('settle.saved').replace('{0}', doc))
  }

  async function cancel() {
    if (!cancelling) return
    setError(null)
    setSaving(true)
    const result = await settleAction(() => voidSettlement({ id: cancelling.id, reason }))
    setSaving(false)
    if (!result.ok) {
      refused(result)
      return
    }
    onDone(t('settle.voided'))
  }

  return (
    <Modal
      open
      width={640}
      title={t('settle.title').replace('{0}', doc)}
      onCancel={onClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>{t('txn.form.close')}</Button>,
        canPay && (
          <Button key="save" type="primary" icon={<Check size={16} aria-hidden />} loading={saving}
                  onClick={save}>
            {t('settle.save')}
          </Button>
        ),
      ]}
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}

      <Space size={32} wrap style={{ marginBottom: 16 }}>
        <Figure label={t('settle.receiptTotal')} value={money.format(Math.abs(row.amount))} />
        <Figure label={t('settle.paid')} value={money.format(paidSoFar(row))} />
        <Figure label={t('settle.owed')} value={money.format(owed)} danger={canPay} />
      </Space>

      <h3 className={styles.sectionHeading}>{t('settle.atCounter')}</h3>
      {row.payments.length === 0
        ? <Typography.Paragraph type="secondary">{t('settle.noneAtCounter')}</Typography.Paragraph>
        : (
          <ul style={LIST}>
            {row.payments.map((p) => (
              <li key={p.seq}>{row.txn_date} · {money.format(p.amount)} {p.method}</li>
            ))}
          </ul>
        )}

      <h3 className={styles.sectionHeading}>{t('settle.later')}</h3>
      {later.length === 0
        ? <Typography.Paragraph type="secondary">{t('settle.noneLater')}</Typography.Paragraph>
        : (
          <ul style={LIST}>
            {later.map((s) => (
              <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>
                  {s.payDate} · {money.format(s.amount)} {s.method}{s.note ? ` · ${s.note}` : ''}
                </span>
                <IconAction icon={<Ban size={16} aria-hidden />} label={t('settle.void')} danger
                            onClick={() => { setCancelling(s); setReason('') }} />
              </li>
            ))}
          </ul>
        )}

      {cancelling && (
        <div role="group" aria-label={t('settle.void')} style={{ marginBottom: 16 }}>
          <Typography.Paragraph>
            {cancelling.payDate} · {money.format(cancelling.amount)} {cancelling.method}
          </Typography.Paragraph>
          <Space.Compact style={{ width: '100%' }}>
            <Input autoFocus value={reason} aria-label={t('settle.voidWhy')}
                   placeholder={t('settle.voidWhy')} onChange={(e) => setReason(e.target.value)} />
            <Button danger loading={saving} disabled={reason.trim().length < 3} onClick={cancel}>
              {t('settle.voidConfirm')}
            </Button>
          </Space.Compact>
        </div>
      )}

      {canPay
        ? (
          <section aria-labelledby="settle-new-heading">
            <h3 id="settle-new-heading" className={styles.sectionHeading}>{t('settle.new')}</h3>
            <Form<Values>
              form={form}
              layout="vertical"
              initialValues={{
                payDate: today < row.txn_date ? row.txn_date : today,
                amount: owed,
                method: 'CASH',
                note: '',
              }}
            >
              <Row gutter={12}>
                <Col xs={24} sm={8}>
                  <Form.Item name="payDate" label={t('settle.payDate')}
                             rules={[{ required: true, message: t('txn.form.required') }]}>
                    <Input type="date" min={row.txn_date} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8}>
                  {/* Not capped at what is owed: typing more is refused with the figures. */}
                  <Form.Item name="amount" label={t('settle.amount')}
                             rules={[{ required: true, message: t('txn.form.required') }]}>
                    <InputNumber style={{ width: '100%' }} min={0.01} step={0.01} controls={false} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8}>
                  <Form.Item name="method" label={t('txn.col.method')}
                             rules={[{ required: true, message: t('txn.form.required') }]}>
                    <Select options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="note" label={t('settle.note')}>
                <Input maxLength={500} />
              </Form.Item>
            </Form>
          </section>
        )
        : <Alert type="success" showIcon title={t('settle.paidUp')} />}
    </Modal>
  )
}
```

- [ ] **Step 5: `TxnScreen.tsx`**
  - import: `Banknote` từ lucide; `voidConversion, voidReceipt` giữ; thêm `import { SettlementForm } from './SettlementForm'`, `import { canSettle, owes } from './settlement'`; thêm `OWED` vào import từ `./ledgerQuery`.
  - state: `converting` thành `useState<{ correcting: ReceiptRow | null; date?: string } | null>`; thêm `const [settling, setSettling] = useState<ReceiptRow | null>(null)`.
  - comment trên `convertButton`: `// "Không có phân loại Transfer" (17-09): converting gold is called Transfer, as in the sheets.`
  - cột Loại: nhãn quy đổi là mã, như PO và SALE:

```tsx
      render: (v: string, r) => (r.conversion
        ? <Tag color="purple" className="pc-txn-type">
            {r.conversion.kind === 'RA_RP' ? 'RA_RP' : 'TRANSFER'}
          </Tag>
        : <TxnTypeTag type={v} />),
```

  - cột Thành tiền, sau `r.payments.map(…)`:

```tsx
          {(r.settlements ?? []).map((s) => (
            <Typography.Text key={s.id} type="secondary" style={{ display: 'block' }}>
              {money.format(s.amount)} {s.method} · {s.payDate}
            </Typography.Text>
          ))}
          {owes(r) && (
            <Typography.Text type="danger" style={{ display: 'block' }}>
              {t('receipt.owed').replace('{0}', money.format(r.owed ?? 0))}
            </Typography.Text>
          )}
```

  - cột Thao tác: `width: 84` → `width: 116`; đầu `<Space size={2}>`:

```tsx
          {canSettle(r) && (
            <IconAction icon={<Banknote size={16} aria-hidden />} label={t('settle.open')}
                        onClick={() => setSettling(r)} />
          )}
```

  - bộ lọc Thanh toán: `options={[...PAYMENT_METHODS.map((value) => ({ value, label: value })), { value: OWED, label: t('txn.filter.owed') }]}`
  - `ReceiptForm`: thêm prop `onTransfer={(date) => { setEditing(null); setConverting({ correcting: null, date }) }}`
  - `ConversionForm`: `convDate={converting.correcting?.txn_date ?? converting.date ?? singleDay(query) ?? today}`
  - sau khối `{converting && (…)}`:

```tsx
      {settling && (
        <SettlementForm
          row={settling}
          today={today}
          onClose={() => setSettling(null)}
          onDone={(message) => {
            setSettling(null)
            setToast(message)
            router.refresh()
          }}
        />
      )}
```

- [ ] **Step 6: `ReceiptForm.tsx`**
  - `const NEEDS_PAYMENT = new Set(['PO', 'PO_VENDOR', 'DEPOSIT'])` và comment trên nó thành:

```ts
/**
 * The types refused without a payment. Only a deposit: a purchase or a sale may
 * be paid later, and what is owed goes to the books as owed (0082, 0083).
 */
const NEEDS_PAYMENT = new Set(['DEPOSIT'])

/** Not a kind of receipt: choosing it opens the conversion form (17-09). */
const TRANSFER = 'TRANSFER'
```

  - comment của validator thanh toán: `// A deposit needs its deposit; anything else may be paid later.`
  - props: thêm `onTransfer` vào destructuring và kiểu:

```ts
  /** "Không có phân loại Transfer": TRANSFER in the type list opens the conversion form, for this day. */
  onTransfer?: (txnDate: string) => void
```

  - sau `const [confirmClose, setConfirmClose] = useState(false)`: `const leaveTo = useRef<'close' | 'transfer'>('close')`; `requestClose` đặt `leaveTo.current = 'close'` trước; thêm:

```ts
  /** On to a conversion: asked first, like closing, when something has been typed. */
  function requestTransfer() {
    leaveTo.current = 'transfer'
    if (dirty) setConfirmClose(true)
    else onTransfer?.(form.getFieldValue('txnDate'))
  }
```

  - sau `useMemo` của `initial`: `const lastType = useRef<string>(initial.txnType)`
  - `onValuesChange` của `<Form>`:

```tsx
                    onValuesChange={(changed: Partial<Values>) => {
                      if (changed.txnType === TRANSFER) {
                        form.setFieldValue('txnType', lastType.current)
                        requestTransfer()
                        return
                      }
                      if (changed.txnType) lastType.current = changed.txnType
                      setDirty(true)
                      setValidationError(false)
                    }}>
```

  - `Select` của ô Loại:

```tsx
                <Select options={[
                  ...TXN_TYPES.map((v) => ({ value: v, label: v })),
                  ...(correcting || !onTransfer ? [] : [{ value: TRANSFER, label: t('txn.type.transfer') }]),
                ]} />
```

  - `Modal` xác nhận: `onOk={() => { setConfirmClose(false); setDirty(false); if (leaveTo.current === 'transfer') onTransfer?.(form.getFieldValue('txnDate')); else onClose() }}`

- [ ] **Step 7: Kiểm tra** — `npx vitest run tests/lib/txn-ledger-screen.test.tsx`, `npx tsc --noEmit`, `npx eslint src/components/gold src/app/(app)/gold-transactions tests/lib`, `npx vitest run tests/lib`.

- [ ] **Step 8: Commit** — `git add src tests/lib && git commit -m "feat(gold): Transfer in the type list, and the rest of a receipt paid from the ledger"`

---

### Task 6: Kiểm tra trên trình duyệt

**Files:**
- Create: `scripts/verify-settlement.mjs`
- Modify: `scripts/support/receipts.mjs`, `scripts/verify-live.mjs`, `scripts/verify-conversion.mjs`, `scripts/verify-receipt.mjs`, `package.json`

- [ ] **Step 1: `scripts/support/receipts.mjs`** — thêm cuối file:

```js
/**
 * Takes a check's later payments off the month it paid them in. Called before
 * that month's entries go: a payment points at its entry and at its reversal.
 */
export async function removeSettlements(db, period) {
  await db.query(`DELETE FROM pc49.gold_receipt_settlement WHERE to_char(pay_date, 'YYYY-MM') = $1`, [period])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'gold_receipt_settlement'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.gold_receipt_settlement)`)
}
```

- [ ] **Step 2: `scripts/verify-live.mjs`** — trong check "nothing in the books is dated before the ledger begins", sau dòng `gold_conversion` thêm `+ (SELECT count(*)::int FROM pc49.gold_receipt_settlement WHERE pay_date < '2025-01-01')`.

- [ ] **Step 3: `scripts/verify-conversion.mjs`** — `'Quy đổi vàng'` (nút) → `'Transfer'` với `exact: true`; dialog `'Quy đổi vàng'` → `'Transfer — quy đổi vàng'`; `rowText.includes('Quy đổi')` → `rowText.includes('TRANSFER')`; dialog `'Sửa quy đổi'` → `'Sửa transfer'`.

- [ ] **Step 4: `scripts/verify-receipt.mjs`** — `settle.getByText(/Thanh toán (còn thiếu|nhiều hơn)/)` → `settle.getByText(/Còn nợ|Thanh toán nhiều hơn/)`.

- [ ] **Step 5: Script mới**

```js path=scripts/verify-settlement.mjs
// Paying a receipt in instalments, and Transfer in the type list.
//
//   "Không có phân loại Transfer"
//   "Không lưu được đối với đơn chưa thanh toán hết. Thực tế vẫn sẽ có đơn
//    thanh toán 1 phần, còn nợ lại khách đợt sau thanh toán tiếp"
//
// TRANSFER is chosen in the type list and opens the conversion form. Then a
// purchase of 1,000.00 is saved with 300.00 paid; the ledger says 700.00 is
// owed and the Còn nợ filter finds it. 400.00 is paid by Zelle two days on,
// cancelled as typed in error, and the whole 700.00 paid in cash. A receipt
// with later payments on it is not cancelled.
//
//   npm run verify:settlement      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { untilRowIs } from './support/until.mjs'
import { removeReceipts, removeSettlements } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-06-10'
const PERIOD = '2019-06'
const PARTNER = 'verify-settlement seller'
const SCREEN = `${BASE}/gold-transactions?date=${DAY}`
const OWING = `${BASE}/gold-transactions?from=${DAY}&to=${DAY}&method=OWED`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes in its month, and the seller it invents. */
async function cleanUp() {
  const txns = await db.query('SELECT id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  await db.query('UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  await removeReceipts(db, DAY)
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

/** Clicks an option in whichever dropdown is open, scrolled to and pressed. */
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
const owedOn = async (receiptId) => Number((await db.query(
  'SELECT pc49.gold_receipt_owed($1)::float8 AS o', [receiptId])).rows[0].o)

try {
  await cleanUp()

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- Transfer, from the type list ----------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('the ledger offers Transfer by that name',
    (await page.getByRole('button', { name: 'Transfer', exact: true }).count()) === 1)
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const typed = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await typed.waitFor()
  await choose(page, typed, 'Loại', 'TRANSFER (quy đổi vàng)')
  const transfer = page.getByRole('dialog', { name: 'Transfer — quy đổi vàng', exact: true }).last()
  await transfer.waitFor({ timeout: 10_000 }).catch(() => {})
  check('choosing TRANSFER opens the conversion form', await transfer.isVisible())
  check('in place of the receipt form',
    (await page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).count()) === 0)
  await transfer.getByRole('button', { name: 'Đóng', exact: true }).first().click()

  // ---- A purchase, 300.00 of 1,000.00 paid ---------------------------------
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  const item = form.getByRole('group', { name: 'Món 1', exact: true })
  await item.getByLabel('Mô tả món', { exact: true }).fill('Thoi Grain')
  await choose(page, item, 'Loại vàng', 'Vàng Grain')
  await item.getByLabel('Số lượng', { exact: true }).fill('10')
  await item.getByLabel('Tuổi vàng (0–1)', { exact: true }).fill('0.999')
  await item.getByLabel('Thành tiền', { exact: true }).fill('1000')
  const settle = form.locator('section[aria-labelledby="txn-settle-heading"]')
  await settle.getByLabel('Số tiền', { exact: true }).first().fill('300')
  check('the form says what will still be owed', (await shown(settle)).includes('Còn nợ 700.00'))
  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const saved = await untilRowIs(db,
    `SELECT r.id, r.doc_no, count(t.journal_entry_id)::int AS posted,
            (SELECT coalesce(sum(jl.amount_usd), 0)::float8
               FROM pc49.gold_txn x JOIN pc49.journal_line jl ON jl.entry_id = x.journal_entry_id
              WHERE x.receipt_id = r.id AND jl.credit_account = '331') AS owed
       FROM pc49.gold_receipt r JOIN pc49.gold_txn t ON t.receipt_id = r.id
      WHERE r.txn_date = $1 AND r.partner_code = $2 AND r.voided_at IS NULL
      GROUP BY r.id`, [DAY, PARTNER], (r) => r.posted === 1)
  check('a purchase paid in part saves and posts', saved !== null, saved ? saved.doc_no : '(nothing posted)')
  if (!saved) throw new Error('the receipt did not save')
  check('owing the seller 700.00', saved.owed === 700, `${saved.owed}`)

  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('the ledger row says what is owed', (await shown(rows(page).first())).includes('Còn nợ 700.00'))
  await page.goto(OWING, { waitUntil: 'networkidle' })
  check('the Còn nợ filter finds it', (await rows(page).count()) === 1, `${await rows(page).count()} rows`)

  // ---- 400.00 by Zelle, two days on ----------------------------------------
  const openPayments = async () => {
    await rows(page).first().getByRole('button', { name: 'Thanh toán tiếp', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Thanh toán tiếp — ${saved.doc_no}`, exact: true }).last()
    await dialog.waitFor()
    return dialog
  }
  let pay = await openPayments()
  await pay.getByLabel('Ngày trả', { exact: true }).fill('2019-06-12')
  await pay.getByLabel('Số tiền', { exact: true }).fill('400')
  await choose(page, pay, 'Hình thức', 'ZELLE')
  await pay.getByRole('button', { name: 'Lưu lần trả', exact: true }).click()

  const later = await untilRowIs(db,
    `SELECT s.id, e.entry_date::text AS day, jl.debit_account AS dr, jl.credit_account AS cr,
            jl.amount_usd::float8 AS amount
       FROM pc49.gold_receipt_settlement s
       JOIN pc49.journal_entry e ON e.id = s.journal_entry_id
       JOIN pc49.journal_line jl ON jl.entry_id = e.id
      WHERE s.receipt_key = $1 AND s.voided_at IS NULL`, [saved.id], (r) => r.amount === 400)
  check('the later payment posts on its own day, against the seller',
    later !== null && later.day === '2019-06-12' && later.dr === '331' && later.cr === '1121ZL',
    later ? `${later.day} ${later.dr}/${later.cr} ${later.amount}` : '(nothing posted)')
  check('and 300.00 is owed', (await owedOn(saved.id)) === 300, `${await owedOn(saved.id)}`)

  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  const paidRow = await shown(rows(page).first())
  check('the row lists the payment with its day, and what is left',
    paidRow.includes('400.00 ZELLE · 2019-06-12') && paidRow.includes('Còn nợ 300.00'), paidRow.slice(0, 200))

  // ---- Typed in error: cancelled -------------------------------------------
  pay = await openPayments()
  await pay.getByRole('button', { name: 'Huỷ lần trả này', exact: true }).click()
  await pay.getByLabel('Lý do huỷ lần trả này', { exact: true }).fill('Nhap nham so tien')
  await pay.getByRole('button', { name: 'Huỷ lần trả', exact: true }).click()
  const undone = await untilRowIs(db,
    `SELECT voided_at IS NOT NULL AS voided, reversal_entry_id IS NOT NULL AS reversed
       FROM pc49.gold_receipt_settlement WHERE id = $1`, [later?.id], (r) => r.voided)
  check('cancelling the payment reverses it', undone !== null && undone.reversed)
  check('and 700.00 is owed again', (await owedOn(saved.id)) === 700, `${await owedOn(saved.id)}`)

  // ---- The rest, in cash ---------------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  pay = await openPayments()
  await pay.getByLabel('Ngày trả', { exact: true }).fill('2019-06-15')
  await pay.getByRole('button', { name: 'Lưu lần trả', exact: true }).click()
  const settled = await untilRowIs(db,
    `SELECT pc49.gold_receipt_owed($1)::float8 AS owed`, [saved.id], (r) => r.owed === 0)
  check('paying the rest leaves nothing owed', settled !== null)
  await page.goto(OWING, { waitUntil: 'networkidle' })
  check('and the Còn nợ filter no longer finds it', (await rows(page).count()) === 0)

  // ---- Not cancelled with payments on it -----------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await rows(page).first().getByRole('button', { name: 'Huỷ', exact: true }).click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiem tra huy phieu da tra sau')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  await page.getByText(/lần thanh toán tiếp/).first().waitFor({ timeout: 10_000 }).catch(() => {})
  check('a receipt with later payments is not cancelled, and says why',
    (await page.getByText(/lần thanh toán tiếp/).count()) > 0)
  const still = await db.query('SELECT voided_at IS NULL AS live FROM pc49.gold_receipt WHERE id = $1', [saved.id])
  check('it is still in the books', still.rows[0]?.live === true)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date = $1) AS receipts,
            (SELECT count(*)::int FROM pc49.gold_receipt_settlement
              WHERE to_char(pay_date, 'YYYY-MM') = $2) AS payments,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.receipts, r.payments, r.entries, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.receipts} receipts, ${r.payments} payments, ${r.entries} entries, ${r.partners} partners`)
  await db.end()
}

console.log(failures === 0 ? '\nALL SETTLEMENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
```

- [ ] **Step 6: `package.json`** — sau `"verify:receipt"`: `"verify:settlement": "node --env-file=.env.local scripts/verify-settlement.mjs",`

- [ ] **Step 7: Chạy trên bản build cục bộ** — `npm run build`; chạy `node node_modules/next/dist/bin/next start -p 3149` (nền); `PC49_BASE_URL=http://localhost:3149 npm run verify:settlement`, `… verify:conversion`, `… verify:receipt`. Cục bộ nối DB thật, nên **chỉ chạy sau khi 0082–0084 đã migrate** (Task 7 Step 2).

- [ ] **Step 8: Commit** — `git add scripts package.json && git commit -m "test(settlement): a receipt paid in part, paid later, cancelled and paid again in the browser"`

---

### Task 7: Cổng cuối và đưa lên

- [ ] **Step 1: Cổng** — `npx tsc --noEmit`; `npm run lint`; `npx vitest run tests/lib`; `npx vitest run tests/sql --maxWorkers=4` (một mình).
- [ ] **Step 2: Migrate** — `npm run migrate` (áp 0082–0084), rồi `npm run verify:live`.
- [ ] **Step 3: Kiểm tra trình duyệt cục bộ** — Task 6 Step 7.
- [ ] **Step 4: Kiểm tra trước khi đẩy** — `git log origin/main..HEAD --format=%B | grep -ciE 'cl[a]ude|cod[e]x|co-authored'` và `git diff origin/main..HEAD | grep -ciE 'cl[a]ude|cod[e]x'` đều in 0.
- [ ] **Step 5: Đẩy** — ngoài 04:00–08:00 UTC, hoặc khi người dùng bảo: `git push origin main` (lệnh riêng). Chờ Vercel xong, chạy `PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:settlement` và `verify:conversion`, rồi `npm run verify:live`.
