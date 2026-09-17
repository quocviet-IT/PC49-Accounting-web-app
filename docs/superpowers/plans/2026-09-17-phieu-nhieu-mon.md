# Phiếu nhiều món — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một tờ phiếu nhiều món được nhập một lần: một số phiếu, một khách, một lần thanh toán, danh sách món bên trong; sổ hiện mỗi phiếu một dòng; sửa/huỷ theo cả phiếu.

**Architecture:** Bảng mới `gold_receipt` bọc các dòng `gold_txn` hiện có (thêm `receipt_id`, `line_no`, `item_desc`). Ba hàm database `save/correct/void_gold_receipt` ghi cả phiếu trong một giao dịch, mỗi món vẫn đi qua `write_gold_transaction` và `post_gold_txn` như cũ, thanh toán được chia xuống từng món theo thứ tự lấp đầy. Sổ đọc qua `gold_receipt_ledger`, nhóm theo `coalesce(receipt_id, id)` nên dữ liệu cũ tự thành phiếu một món. Màn hình: form mới `ReceiptForm` (danh sách món, giá theo gram tinh), sổ có dòng mở rộng, Excel mỗi món một dòng. Đặc tả: `docs/superpowers/specs/2026-09-17-phieu-nhieu-mon-design.md`.

**Tech Stack:** PostgreSQL/Supabase (plpgsql, RLS), PGlite + vitest cho test SQL, Next.js 16 server actions, React 19, antd 6 (Form.List, Table expandable), zod, Playwright cho `verify:*`.

## Global Constraints

- Không chuyển dữ liệu cũ. Dòng `gold_txn` không có `receipt_id` là **phiếu một món**; mọi chỗ đọc theo phiếu dùng khoá `coalesce(receipt_id, id)`.
- Một phiếu: 1–30 món; `DEPOSIT` và `PICKUP` đúng 1 món; mọi món cùng chiều.
- Mã từ chối từ database (màn hình dịch): `RECEIPT_SIZE`, `RECEIPT_SINGLE`, `RECEIPT_QTY`, `RECEIPT_DIRECTION`, `PAYMENT_SHORT: item N`, `LINE_BLOCKED: item N CODE`, `RECEIPT_VOIDED`, `CONFLICT`, `REQUEST_KEY_REUSED`.
- Thanh toán chia theo thứ tự lấp đầy trên giá trị tuyệt đối; dư nằm ở món cuối; thiếu để trống các món cuối; không làm tròn.
- `unit_price` lưu vẫn là giá theo đơn vị gốc (gram thô / lượng / oz), 8 chữ số thập phân; gram tinh và giá/gram tinh chỉ tính ra, không lưu.
- `save_gold_transaction`, `correct_gold_transaction`, `gold_txn_ledger`, `gold_txn_ledger_totals` **giữ nguyên** trong database (bỏ ở migration sau).
- Nhãn mà các script kiểm tra bấm theo tên giữ nguyên: dialog `Giao dịch mới`, `Sửa giao dịch`, `Huỷ giao dịch`; nút `Thêm giao dịch`, `Lưu`, `Sửa`, `Huỷ`, `Thêm hình thức thanh toán`; trường `Loại`, `Loại vàng`, `Số lượng`, `Đơn giá`, `Khách / NCC`, `Số tiền`, `Hình thức`, `Ghi chú`, `Lý do sửa`, `Nhóm vàng vụn`, `Tuổi vàng (0–1)`.
- Mọi lời gọi server action từ màn hình đi qua `settleAction`. Mọi chữ trên màn hình đi qua từ điển, có đủ `vi` và `en`.
- Test SQL chạy **riêng**, không song song với lệnh test khác: `npx vitest run tests/sql/<file> --maxWorkers=4`.
- Ghi database thật chỉ bằng `npm run migrate` (gõ nguyên văn, không pipe). Script `verify:*` ghi database thật: không pipe vào `head`/`grep`, ghi output ra file trong scratchpad, chạy `npm run verify:live` sau cùng.
- Server local: `node node_modules/next/dist/bin/next start -p 3149`, chạy nền như một tác vụ riêng; không bao giờ dừng tiến trình theo cổng.
- File có ký tự tiếng Việt: viết bằng Write/Edit, không dùng heredoc.
- Commit và nội dung đẩy lên không có dòng đồng tác giả hay tên công cụ AI. Đẩy lên `main` = triển khai Production: chỉ đẩy sau 15:00 giờ VN (08:00 UTC), `git push origin main` chạy riêng một lệnh, không force-push.

## File Structure

| File | Trách nhiệm |
|---|---|
| `supabase/migrations/0073_a_receipt_holds_several_items.sql` | bảng `gold_receipt`, cột mới trên `gold_txn`, `write_gold_transaction` nhận thêm trường phiếu, `allocate_receipt_payments` |
| `supabase/migrations/0074_a_receipt_is_saved_whole.sql` | `write_gold_receipt`, `receipt_answer`, `save_gold_receipt` |
| `supabase/migrations/0075_a_receipt_is_corrected_whole.sql` | `receipt_live_lines`, `refuse_blocked_lines`, `correct_gold_receipt`, `void_gold_receipt` |
| `supabase/migrations/0076_the_ledger_lists_receipts.sql` | `gold_receipt_*` đọc sổ theo phiếu và thẻ tổng |
| `tests/support/receipt.ts` | tờ phiếu 6 món dùng chung cho test |
| `tests/sql/receipt.test.ts` | lưu, chia tiền, sửa, huỷ |
| `tests/sql/receipt-ledger.test.ts` | sổ theo phiếu |
| `src/components/gold/receiptLine.ts` | phép tính thuần của một món: dấu, gram tinh, giá ↔ thành tiền, payload |
| `src/components/gold/receiptErrors.ts` | dịch lời từ chối của database |
| `src/components/gold/ReceiptForm.tsx` | form nhập/sửa phiếu (thay `TxnForm.tsx`) |
| `src/components/gold/ReceiptLines.tsx` | bảng món dưới một dòng sổ |
| `src/components/gold/types.ts` | `ReceiptLine`, `ReceiptRow` (bỏ `SavedRow`, `LedgerRow` ở Task 9) |
| `src/components/gold/ledgerRow.ts` | `toReceiptRow`, `goldSummary` |
| `src/components/gold/ledgerCsv.ts` | Excel mỗi món một dòng |
| `src/components/gold/TxnScreen.tsx` | sổ theo phiếu, dòng mở rộng, huỷ cả phiếu |
| `src/app/(app)/gold-transactions/actions.ts` | `saveReceipt`, `correctReceipt`, `voidReceipt` |
| `src/app/(app)/gold-transactions/page.tsx`, `export/route.ts` | đọc `gold_receipt_ledger` |
| `src/lib/i18n/ui-gold.ts`, `dictionary.ts` | chữ mới |
| `scripts/verify-receipt.mjs`, `scripts/support/receipts.mjs` | kiểm tra trên trình duyệt, dọn phiếu thử |
| `scripts/verify-{payments,void,correct,txn-form,ledger,live}.mjs` | cập nhật theo phiếu |

---

### Task 1: Bảng phiếu và chia thanh toán

**Files:**
- Create: `supabase/migrations/0073_a_receipt_holds_several_items.sql`
- Create: `tests/sql/receipt.test.ts`

**Interfaces:**
- Produces:
  - bảng `pc49.gold_receipt(id, doc_no, txn_date, txn_type, partner_code, remarks, revision, voided_at, void_reason, corrects_receipt_id, created_at, created_by, updated_at, updated_by)`;
  - cột `pc49.gold_txn.receipt_id uuid`, `line_no int`, `item_desc text`;
  - `pc49.write_gold_transaction(p_payload jsonb, p_corrects uuid DEFAULT NULL)`: payload nhận thêm `docNo`, `receiptId`, `lineNo`, `itemDesc` (đều tuỳ chọn);
  - `pc49.allocate_receipt_payments(p_amounts numeric[], p_payments jsonb) RETURNS jsonb`: mảng các mảng `{amount, method}`, một mảng cho mỗi món.

- [ ] **Step 1: Viết test hỏng**

Tạo `tests/sql/receipt.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'

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

/** The division as "amount method" per item, so a failure reads like the paper. */
async function allocate(amounts: number[], payments: { amount: number; method: string }[]) {
  const r = await db.query<{ a: { amount: number | string; method: string }[][] }>(
    `SELECT pc49.allocate_receipt_payments($1::numeric[], $2::jsonb) AS a`,
    [`{${amounts.join(',')}}`, JSON.stringify(payments)])
  return r.rows[0].a.map((line) => line.map((p) => `${Number(p.amount)} ${p.method}`))
}

describe('what the customer paid, divided between the items', () => {
  it('fills the items in order, as the example in the design', async () => {
    expect(await allocate([-950, -825, -1900, -4125, -525, -36],
      [{ amount: 5000, method: 'CASH' }, { amount: 3361, method: 'BANKWIRE' }]))
      .toEqual([['950 CASH'], ['825 CASH'], ['1900 CASH'],
        ['1325 CASH', '2800 BANKWIRE'], ['525 BANKWIRE'], ['36 BANKWIRE']])
  })

  it('leaves money paid over the total on the last item', async () => {
    expect(await allocate([-100, -50], [{ amount: 200, method: 'CASH' }]))
      .toEqual([['100 CASH'], ['100 CASH']])
  })

  it('leaves the last items short when too little was paid', async () => {
    expect(await allocate([-100, -50, -30], [{ amount: 120, method: 'CASH' }]))
      .toEqual([['100 CASH'], ['20 CASH'], []])
  })

  it('divides nothing when nothing was paid', async () => {
    expect(await allocate([-100, -50], [])).toEqual([[], []])
  })
})

describe('the receipt and its lines', () => {
  it('lets accounting write a receipt and a line that belongs to it', async () => {
    const made = await asRole(db, KT, async () => {
      const receipt = await db.query<{ id: string }>(
        `INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type, partner_code)
         VALUES ('PC49-2606-900', '2026-06-02', 'PO', 'KHACH') RETURNING id`)
      const line = await db.query<{ r: { txnId: string } }>(
        `SELECT pc49.write_gold_transaction($1::jsonb) AS r`,
        [JSON.stringify({
          txnDate: '2026-06-02', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM',
          qty: 9.4, unitPrice: 101.06382979, amount: -950, partnerCode: 'KHACH',
          payments: [{ amount: 950, method: 'CASH' }], salesPeople: [],
          docNo: 'PC49-2606-900', receiptId: receipt.rows[0].id, lineNo: 1,
          itemDesc: 'Nhẫn 24K (vụn)',
        })])
      return { receiptId: receipt.rows[0].id, txnId: line.rows[0].r.txnId }
    })
    const row = await db.query<{ doc_no: string; receipt_id: string; line_no: number; item_desc: string }>(
      `SELECT doc_no, receipt_id, line_no, item_desc FROM pc49.gold_txn WHERE id = $1`, [made.txnId])
    expect(row.rows[0]).toEqual({
      doc_no: 'PC49-2606-900', receipt_id: made.receiptId, line_no: 1, item_desc: 'Nhẫn 24K (vụn)',
    })
  })

  it('numbers a line written without a receipt exactly as before', async () => {
    const r = await asRole(db, KT, () => db.query<{ r: { txnId: string } }>(
      `SELECT pc49.write_gold_transaction($1::jsonb) AS r`,
      [JSON.stringify({
        txnDate: '2026-06-02', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM',
        qty: 2, unitPrice: 50, amount: -100,
        payments: [{ amount: 100, method: 'CASH' }], salesPeople: [],
      })]))
    const row = await db.query<{ doc_no: string; receipt_id: string | null; line_no: number | null }>(
      `SELECT doc_no, receipt_id, line_no FROM pc49.gold_txn WHERE id = $1`, [r.rows[0].r.txnId])
    expect(row.rows[0].doc_no).toMatch(/^PC49-2606-\d{3}$/)
    expect(row.rows[0].receipt_id).toBeNull()
    expect(row.rows[0].line_no).toBeNull()
  })

  it('lets anyone signed in read receipts, and only accounting write them', async () => {
    await db.query(`INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type)
                    VALUES ('PC49-2606-901', '2026-06-02', 'PO')`)
    const seen = await asRole(db, GS, () => db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt`))
    expect(Number(seen.rows[0].n)).toBeGreaterThan(0)
    await expect(asRole(db, GS, () => db.query(
      `INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type)
       VALUES ('X', '2026-06-02', 'PO')`))).rejects.toThrow(/row-level security/)
  })
})
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/receipt.test.ts --maxWorkers=4`
Expected: FAIL — `function pc49.allocate_receipt_payments(numeric[], jsonb) does not exist` và `relation "pc49.gold_receipt" does not exist`.

- [ ] **Step 3: Viết migration**

Tạo `supabase/migrations/0073_a_receipt_holds_several_items.sql`:

```sql
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
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/sql/receipt.test.ts --maxWorkers=4`
Expected: PASS, 7 test. Chạy thêm `npx vitest run tests/sql/rls-once-per-query.test.ts tests/sql/atomic-save.test.ts tests/sql/atomic-correct.test.ts --maxWorkers=4`: PASS (chính sách mới dạng sub-select; lưu/sửa cũ không đổi).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0073_a_receipt_holds_several_items.sql tests/sql/receipt.test.ts
git commit -m "feat(receipt): a receipt table, and payments divided between its items"
```

### Task 2: Lưu một phiếu

**Files:**
- Create: `supabase/migrations/0074_a_receipt_is_saved_whole.sql`
- Create: `tests/support/receipt.ts`
- Modify: `tests/sql/receipt.test.ts` (thêm import và một khối `describe` ở cuối)

**Interfaces:**
- Consumes: `allocate_receipt_payments`, `write_gold_transaction` mở rộng (Task 1).
- Produces:
  - `pc49.write_gold_receipt(p_payload jsonb, p_doc_no text DEFAULT NULL, p_corrects_receipt uuid DEFAULT NULL, p_corrects_txn uuid DEFAULT NULL) RETURNS jsonb` → `{receiptId, docNo, firstTxnId}`;
  - `pc49.receipt_answer(p_first_txn uuid) RETURNS jsonb` → `{receiptId, docNo}`;
  - `pc49.save_gold_receipt(p_request_key text, p_payload jsonb) RETURNS jsonb` → `{receiptId, docNo, repeated}`;
  - payload phiếu: `{txnDate, txnType, partnerCode, remarks, salesPeople: [{code, sharePct}], payments: [{amount, method}], lines: [{itemDesc, goldTypeCode, uom, qty, unitPrice, amount, scrapDetail, goldPct}]}`;
  - `tests/support/receipt.ts`: `type Item`, `SIX_ITEMS: Item[]`, `purchaseLine(item)`, `receiptPayload(over?, items?) → string`.

- [ ] **Step 1: Tạo dữ liệu test dùng chung**

Tạo `tests/support/receipt.ts`:

```ts
/**
 * The paper receipt from the counter on 17-09, as the screen sends it: six
 * pieces bought from one customer, 8,361.00 in all.
 */
export type Item = {
  itemDesc: string
  goldTypeCode: string
  qty: number
  goldPct: number | null
  total: number
  scrapDetail: string | null
}

export const SIX_ITEMS: Item[] = [
  { itemDesc: 'Nhẫn 24K (vụn)', goldTypeCode: 'SG', qty: 9.4, goldPct: 0.987, total: 950, scrapDetail: '19-24k/grs' },
  { itemDesc: 'Mũ 24K (vụn)', goldTypeCode: 'SG', qty: 7.5, goldPct: 0.981, total: 825, scrapDetail: '19-24k/grs' },
  { itemDesc: 'Thỏi RCM', goldTypeCode: 'GRAIN', qty: 15.6, goldPct: 0.998, total: 1900, scrapDetail: null },
  { itemDesc: 'Bi 24K (vụn)', goldTypeCode: 'SG', qty: 37.5, goldPct: 0.99, total: 4125, scrapDetail: '19-24k/grs' },
  { itemDesc: 'Xu Suisse 24K', goldTypeCode: 'GRAIN', qty: 5, goldPct: 0.99, total: 525, scrapDetail: null },
  { itemDesc: 'Mặt dây 14K (vụn)', goldTypeCode: 'SG', qty: 0.6, goldPct: 0.597, total: 36, scrapDetail: '10-18k/grs' },
]

/** An item as a purchase line: the price per gram worked out from the receipt's amount, to eight places. */
export function purchaseLine(item: Item) {
  return {
    itemDesc: item.itemDesc,
    goldTypeCode: item.goldTypeCode,
    uom: 'GRAM',
    qty: item.qty,
    unitPrice: Math.round((item.total / item.qty) * 1e8) / 1e8,
    amount: -item.total,
    scrapDetail: item.scrapDetail,
    goldPct: item.goldPct,
  }
}

/** The whole receipt as the payload save_gold_receipt takes, with anything overridden. */
export function receiptPayload(over: Record<string, unknown> = {}, items: Item[] = SIX_ITEMS): string {
  return JSON.stringify({
    txnDate: '2026-06-02',
    txnType: 'PO',
    partnerCode: 'NGUYEN VAN A',
    remarks: 'phieu 6 mon',
    salesPeople: [{ code: 'L.Thanh', sharePct: 80 }, { code: 'P.Minh', sharePct: 20 }],
    payments: [{ amount: 5000, method: 'CASH' }, { amount: 3361, method: 'BANKWIRE' }],
    lines: items.map(purchaseLine),
    ...over,
  })
}
```

- [ ] **Step 2: Viết test hỏng**

Trong `tests/sql/receipt.test.ts`, thêm dưới dòng `import { createTestDb, asRole } from '../support/db'`:

```ts
import { SIX_ITEMS, purchaseLine, receiptPayload } from '../support/receipt'
```

Thêm vào cuối file:

```ts
type Saved = { receiptId: string; docNo: string; repeated: boolean }

async function saveReceipt(key: string, body: string, as = KT): Promise<Saved> {
  const r = await asRole(db, as, () => db.query<{ r: Saved }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

/** Each item's payments as "amount method + amount method", in item order. */
async function paidPerItem(receiptId: string) {
  const r = await db.query<{ paid: string }>(
    `SELECT coalesce(string_agg(gp.amount::float8::text || ' ' || gp.method::text, ' + '
                                ORDER BY gp.seq), '') AS paid
       FROM pc49.gold_txn t
       LEFT JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
      WHERE t.receipt_id = $1
      GROUP BY t.line_no ORDER BY t.line_no`, [receiptId])
  return r.rows.map((row) => row.paid)
}

describe('saving a receipt of several items', () => {
  it('writes one receipt and six items under one number, every item posted', async () => {
    const saved = await saveReceipt('six-items', receiptPayload({ partnerCode: 'SIX' }))
    const receipt = await db.query<{ doc_no: string; txn_type: string; partner_code: string }>(
      `SELECT doc_no, txn_type::text, partner_code FROM pc49.gold_receipt WHERE id = $1`,
      [saved.receiptId])
    expect(receipt.rows[0]).toEqual({ doc_no: saved.docNo, txn_type: 'PO', partner_code: 'SIX' })

    const lines = await db.query<{
      line_no: number; doc_no: string; item_desc: string; amount: string; posted: boolean
    }>(
      `SELECT line_no, doc_no, item_desc, amount::text, journal_entry_id IS NOT NULL AS posted
         FROM pc49.gold_txn WHERE receipt_id = $1 ORDER BY line_no`, [saved.receiptId])
    expect(lines.rows.map((l) => l.line_no)).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(lines.rows.map((l) => l.doc_no))).toEqual(new Set([saved.docNo]))
    expect(lines.rows.map((l) => l.item_desc)).toEqual(SIX_ITEMS.map((i) => i.itemDesc))
    expect(lines.rows.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(-8361)
    expect(lines.rows.every((l) => l.posted)).toBe(true)
  })

  it('divides the payments as the design says, to the cent', async () => {
    const saved = await saveReceipt('six-paid', receiptPayload({ partnerCode: 'PAID' }))
    expect(await paidPerItem(saved.receiptId)).toEqual([
      '950 CASH', '825 CASH', '1900 CASH', '1325 CASH + 2800 BANKWIRE', '525 BANKWIRE', '36 BANKWIRE',
    ])
    const byMethod = await db.query<{ method: string; total: string }>(
      `SELECT gp.method::text AS method, sum(gp.amount)::float8::text AS total
         FROM pc49.gold_txn t JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
        WHERE t.receipt_id = $1 GROUP BY gp.method ORDER BY gp.method::text`, [saved.receiptId])
    expect(byMethod.rows).toEqual([
      { method: 'BANKWIRE', total: '3361' }, { method: 'CASH', total: '5000' },
    ])
  })

  it('leaves an overpayment on the last item, as a single transaction would', async () => {
    const saved = await saveReceipt('six-over', receiptPayload({
      partnerCode: 'OVER', payments: [{ amount: 9000, method: 'CASH' }],
    }))
    expect((await paidPerItem(saved.receiptId))[5]).toBe('675 CASH')
  })

  it('refuses a purchase whose payments never reach an item, and names the item', async () => {
    const count = async () => (await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt`)).rows[0].n
    const before = await count()
    await expect(saveReceipt('six-short', receiptPayload({
      partnerCode: 'SHORT', payments: [{ amount: 8000, method: 'CASH' }],
    }))).rejects.toThrow(/PAYMENT_SHORT: item 6/)
    expect(await count()).toBe(before)
  })

  it('credits the same people with the same shares on every item', async () => {
    const saved = await saveReceipt('six-staff', receiptPayload({ partnerCode: 'STAFF' }))
    const shares = await db.query<{ who: string }>(
      `SELECT string_agg(s.sales_person_code || ' ' || s.share_pct::float8::text, ', '
                         ORDER BY s.share_pct DESC) AS who
         FROM pc49.gold_txn t JOIN pc49.gold_txn_sales_person s ON s.txn_id = t.id
        WHERE t.receipt_id = $1 GROUP BY t.line_no ORDER BY t.line_no`, [saved.receiptId])
    expect(shares.rows.map((r) => r.who)).toEqual(Array(6).fill('L.Thanh 80, P.Minh 20'))
  })

  it('is one receipt however many times it is saved', async () => {
    const body = receiptPayload({ partnerCode: 'TWICE' })
    const first = await saveReceipt('six-twice', body)
    const again = await saveReceipt('six-twice', body)
    expect(first.repeated).toBe(false)
    expect(again).toEqual({ receiptId: first.receiptId, docNo: first.docNo, repeated: true })
    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt WHERE partner_code = 'TWICE'`)
    expect(n.rows[0].n).toBe('1')
  })

  it('refuses the same key for a different receipt', async () => {
    await saveReceipt('six-reused', receiptPayload({ partnerCode: 'REUSED' }))
    await expect(saveReceipt('six-reused', receiptPayload({ partnerCode: 'REUSED', remarks: 'khac' })))
      .rejects.toThrow(/REQUEST_KEY_REUSED/)
  })

  it('keeps a deposit to one item', async () => {
    const two = [SIX_ITEMS[0], SIX_ITEMS[1]].map(purchaseLine)
    await expect(saveReceipt('deposit-two', receiptPayload({
      partnerCode: 'DEP', txnType: 'DEPOSIT', lines: two,
    }))).rejects.toThrow(/RECEIPT_SINGLE/)
  })

  it('holds thirty items at most', async () => {
    const many = Array.from({ length: 31 }, () => purchaseLine(SIX_ITEMS[4]))
    await expect(saveReceipt('thirty-one', receiptPayload({
      partnerCode: 'MANY', lines: many, payments: [{ amount: 31 * 525, method: 'CASH' }],
    }))).rejects.toThrow(/RECEIPT_SIZE/)
  })

  it('refuses items that move in both directions', async () => {
    const memo = {
      itemDesc: 'x', goldTypeCode: 'SG', uom: 'GRAM', unitPrice: null, amount: 0,
      scrapDetail: null, goldPct: null,
    }
    await expect(saveReceipt('both-ways', receiptPayload({
      partnerCode: 'WAYS', txnType: 'MEMO', payments: [],
      lines: [{ ...memo, qty: 5 }, { ...memo, qty: -5 }],
    }))).rejects.toThrow(/RECEIPT_DIRECTION/)
  })

  it('is refused to somebody who may only read', async () => {
    await expect(saveReceipt('supervisor', receiptPayload({ partnerCode: 'GS' }), GS))
      .rejects.toThrow()
  })
})
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/receipt.test.ts --maxWorkers=4`
Expected: 7 test của Task 1 PASS; khối mới FAIL — `function pc49.save_gold_receipt(unknown, jsonb) does not exist`.

- [ ] **Step 4: Viết migration**

Tạo `supabase/migrations/0074_a_receipt_is_saved_whole.sql`:

```sql
-- 0074_a_receipt_is_saved_whole.sql
-- Saving a receipt of several items: one number, one call, whole or not at all.
--
--   write_gold_receipt   the body: the checks, the receipt row, each line
--                        through write_gold_transaction, the payments divided
--   receipt_answer       what a repeated request is answered with
--   save_gold_receipt    the request key and the retry check around the body,
--                        as save_gold_transaction has them (0054)
--
-- The refusals begin with a code the screen translates, and name the item
-- where there is one to name:
--
--   RECEIPT_SIZE       fewer than 1 or more than 30 items
--   RECEIPT_SINGLE     a deposit or a pickup with more than one item: the two
--                      are tied to each other one transaction at a time
--   RECEIPT_QTY        an item with no quantity
--   RECEIPT_DIRECTION  items moving both ways; an exchange is two receipts
--   PAYMENT_SHORT      a purchase or deposit item the payments never reach,
--                      which the books cannot post (0015 books a purchase
--                      from what was paid for it)

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

  IF v_type IN ('PO', 'PO_VENDOR', 'DEPOSIT') THEN
    FOR v_i IN 1..v_n LOOP
      IF jsonb_array_length(v_alloc -> (v_i - 1)) = 0 THEN
        RAISE EXCEPTION 'PAYMENT_SHORT: item % is left with no payment; the payments on this receipt do not reach it', v_i;
      END IF;
    END LOOP;
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

/** What a repeated request is answered with: the receipt its first line belongs to. */
CREATE OR REPLACE FUNCTION pc49.receipt_answer(p_first_txn uuid)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('receiptId', coalesce(t.receipt_id, t.id), 'docNo', t.doc_no)
    FROM pc49.gold_txn t WHERE t.id = p_first_txn
$$;

CREATE OR REPLACE FUNCTION pc49.save_gold_receipt(
  p_request_key text,
  p_payload     jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hash  text := md5(p_payload::text);
  v_seen  pc49.request_outcome;
  v_made  jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  IF btrim(coalesce(p_request_key, '')) = '' THEN
    RAISE EXCEPTION 'a save needs a request key so that retrying it is safe';
  END IF;

  SELECT * INTO v_seen FROM pc49.request_outcome
   WHERE actor = v_actor AND request_key = p_request_key;
  IF FOUND THEN
    IF v_seen.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'REQUEST_KEY_REUSED: this request key was already used for different data';
    END IF;
    RETURN pc49.receipt_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  v_made := pc49.write_gold_receipt(p_payload);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_receipt', v_hash,
          (v_made ->> 'firstTxnId')::uuid);

  RETURN jsonb_build_object('receiptId', v_made -> 'receiptId', 'docNo', v_made -> 'docNo',
                            'repeated', false);
END $$;

GRANT EXECUTE ON FUNCTION pc49.write_gold_receipt(jsonb, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.receipt_answer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.save_gold_receipt(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0074_a_receipt_is_saved_whole')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 5: Chạy test**

Run: `npx vitest run tests/sql/receipt.test.ts --maxWorkers=4`
Expected: PASS, 18 test.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0074_a_receipt_is_saved_whole.sql tests/support/receipt.ts tests/sql/receipt.test.ts
git commit -m "feat(receipt): a receipt of several items is saved in one call"
```

### Task 3: Sửa và huỷ cả phiếu

**Files:**
- Create: `supabase/migrations/0075_a_receipt_is_corrected_whole.sql`
- Modify: `tests/sql/receipt.test.ts` (thêm ở cuối)

**Interfaces:**
- Consumes: `write_gold_receipt`, `receipt_answer` (Task 2); `correction_blocked_code(uuid)` (0071); `void_gold_txn(uuid, text, date)` (0034).
- Produces:
  - `pc49.receipt_live_lines(p_key uuid) RETURNS TABLE (txn_id uuid, line_no int)`;
  - `pc49.refuse_blocked_lines(p_key uuid, p_allow text[] DEFAULT '{}') RETURNS void`;
  - `pc49.correct_gold_receipt(p_request_key text, p_original uuid, p_expected_revision int, p_reason text, p_payload jsonb, p_reversal_date date DEFAULT NULL) RETURNS jsonb` → `{receiptId, docNo, repeated, replaced}`;
  - `pc49.void_gold_receipt(p_original uuid, p_reason text, p_on_date date DEFAULT NULL) RETURNS int` (số món đã huỷ).
  - `p_original` luôn là khoá sổ: id phiếu, hoặc id dòng không có phiếu.

- [ ] **Step 1: Viết test hỏng**

Thêm vào cuối `tests/sql/receipt.test.ts`:

```ts
type Corrected = Saved & { replaced?: string }

async function correct(key: string, original: string, revision: number, body: string,
  reason = 'Bớt món mặt dây'): Promise<Corrected> {
  const r = await asRole(db, KT, () => db.query<{ r: Corrected }>(
    `SELECT pc49.correct_gold_receipt($1, $2, $3, $4, $5::jsonb) AS r`,
    [key, original, revision, reason, body]))
  return r.rows[0].r
}

async function cancel(original: string, reason = 'nhập trùng'): Promise<number> {
  const r = await asRole(db, KT, () => db.query<{ n: number }>(
    `SELECT pc49.void_gold_receipt($1, $2) AS n`, [original, reason]))
  return r.rows[0].n
}

const revisionOf = async (table: 'gold_receipt' | 'gold_txn', id: string) =>
  (await db.query<{ revision: number }>(
    `SELECT revision FROM pc49.${table} WHERE id = $1`, [id])).rows[0].revision

/** The same receipt with the pendant taken off: five items, 8,325.00. */
const fivePayload = (partnerCode: string) => receiptPayload({
  partnerCode,
  lines: SIX_ITEMS.slice(0, 5).map(purchaseLine),
  payments: [{ amount: 5000, method: 'CASH' }, { amount: 3325, method: 'BANKWIRE' }],
})

/** A transaction saved the way everything was saved before receipts. */
async function saveLone(key: string, partnerCode: string): Promise<string> {
  const r = await asRole(db, KT, () => db.query<{ r: { txnId: string } }>(
    `SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`,
    [key, JSON.stringify({
      txnDate: '2026-06-02', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM', qty: 10,
      unitPrice: 60, amount: -600, partnerCode, scrapDetail: null, goldPct: null,
      remarks: null, payments: [{ amount: 600, method: 'CASH' }], salesPeople: [],
    })]))
  return r.rows[0].r.txnId
}

const liveItems = async (receiptId: string) => (await db.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM pc49.gold_txn WHERE receipt_id = $1 AND voided_at IS NULL`,
  [receiptId])).rows[0].n

describe('correcting a receipt', () => {
  it('replaces every item in one go and keeps the number', async () => {
    const saved = await saveReceipt('fix-me', receiptPayload({ partnerCode: 'FIX' }))
    const oldEntries = await db.query<{ e: string }>(
      `SELECT journal_entry_id::text AS e FROM pc49.gold_txn WHERE receipt_id = $1`, [saved.receiptId])

    const fixed = await correct('fix-it', saved.receiptId,
      await revisionOf('gold_receipt', saved.receiptId), fivePayload('FIX'))
    expect(fixed.docNo).toBe(saved.docNo)
    expect(fixed.receiptId).not.toBe(saved.receiptId)

    const old = await db.query<{ voided: boolean; why: string }>(
      `SELECT voided_at IS NOT NULL AS voided, void_reason AS why
         FROM pc49.gold_receipt WHERE id = $1`, [saved.receiptId])
    expect(old.rows[0]).toEqual({ voided: true, why: 'Bớt món mặt dây' })
    expect(await liveItems(saved.receiptId)).toBe('0')

    const reversals = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.journal_entry WHERE reversal_of_id = ANY($1::uuid[])`,
      [`{${oldEntries.rows.map((r) => r.e).join(',')}}`])
    expect(reversals.rows[0].n).toBe('6')

    const replacement = await db.query<{ corrects: string; items: string; posted: string }>(
      `SELECT r.corrects_receipt_id::text AS corrects,
              (SELECT count(*)::text FROM pc49.gold_txn t WHERE t.receipt_id = r.id) AS items,
              (SELECT count(*)::text FROM pc49.gold_txn t
                WHERE t.receipt_id = r.id AND t.journal_entry_id IS NOT NULL) AS posted
         FROM pc49.gold_receipt r WHERE r.id = $1`, [fixed.receiptId])
    expect(replacement.rows[0]).toEqual({ corrects: saved.receiptId, items: '5', posted: '5' })
  })

  it('tells the second person to look again rather than overwrite', async () => {
    const saved = await saveReceipt('race', receiptPayload({ partnerCode: 'RACE' }))
    const seen = await revisionOf('gold_receipt', saved.receiptId)
    await correct('race-first', saved.receiptId, seen, fivePayload('RACE'))
    await expect(correct('race-second', saved.receiptId, seen, fivePayload('RACE')))
      .rejects.toThrow(/CONFLICT/)
  })

  it('refuses while an item sits in a refining lot, and says which item', async () => {
    const saved = await saveReceipt('in-a-lot', receiptPayload({ partnerCode: 'LOT' }))
    const fourth = await db.query<{ id: string }>(
      `SELECT id FROM pc49.gold_txn WHERE receipt_id = $1 AND line_no = 4`, [saved.receiptId])
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.RECEIPT') RETURNING id`)
    await db.query(`INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`,
      [lot.rows[0].id, fourth.rows[0].id])

    await expect(correct('in-a-lot-fix', saved.receiptId,
      await revisionOf('gold_receipt', saved.receiptId), fivePayload('LOT')))
      .rejects.toThrow(/LINE_BLOCKED: item 4 REFINING_SOURCE/)
    await expect(cancel(saved.receiptId)).rejects.toThrow(/LINE_BLOCKED: item 4 REFINING_SOURCE/)
    expect(await liveItems(saved.receiptId)).toBe('6')
  })

  it('corrects a transaction saved before receipts as a receipt of one item', async () => {
    const loneId = await saveLone('lone-save', 'LONE')
    const loneDoc = (await db.query<{ doc_no: string }>(
      `SELECT doc_no FROM pc49.gold_txn WHERE id = $1`, [loneId])).rows[0].doc_no

    const fixed = await correct('lone-fix', loneId, await revisionOf('gold_txn', loneId),
      receiptPayload({
        partnerCode: 'LONE', lines: [purchaseLine(SIX_ITEMS[0])],
        payments: [{ amount: 950, method: 'CASH' }],
      }))
    expect(fixed.docNo).toBe(loneDoc)
    const first = await db.query<{ corrects: string }>(
      `SELECT corrects_txn_id::text AS corrects FROM pc49.gold_txn
        WHERE receipt_id = $1 AND line_no = 1`, [fixed.receiptId])
    expect(first.rows[0].corrects).toBe(loneId)
    const gone = await db.query<{ voided: boolean }>(
      `SELECT voided_at IS NOT NULL AS voided FROM pc49.gold_txn WHERE id = $1`, [loneId])
    expect(gone.rows[0].voided).toBe(true)
  })

  it('returns the first correction when asked twice', async () => {
    const saved = await saveReceipt('fix-twice-save', receiptPayload({ partnerCode: 'FIX2' }))
    const seen = await revisionOf('gold_receipt', saved.receiptId)
    const body = fivePayload('FIX2')
    const first = await correct('fix-twice', saved.receiptId, seen, body)
    const again = await correct('fix-twice', saved.receiptId, seen, body)
    expect(again).toEqual({ receiptId: first.receiptId, docNo: first.docNo, repeated: true })
  })
})

describe('cancelling a receipt', () => {
  it('cancels every item at once and gives the stock back', async () => {
    const saved = await saveReceipt('cancel-me', receiptPayload({ partnerCode: 'CANCEL' }))
    expect(await cancel(saved.receiptId)).toBe(6)
    const state = await db.query<{ live: string; voided: boolean; grams: string }>(
      `SELECT (SELECT count(*)::text FROM pc49.gold_txn
                WHERE receipt_id = $1 AND voided_at IS NULL) AS live,
              (SELECT voided_at IS NOT NULL FROM pc49.gold_receipt WHERE id = $1) AS voided,
              (SELECT coalesce(sum(m.qty_gram), 0)::float8::text
                 FROM pc49.inventory_movement m JOIN pc49.gold_txn t ON t.id = m.source_id
                WHERE t.receipt_id = $1) AS grams`, [saved.receiptId])
    expect(state.rows[0]).toEqual({ live: '0', voided: true, grams: '0' })
  })

  it('cancels a transaction saved before receipts', async () => {
    const loneId = await saveLone('lone-cancel', 'LONE2')
    expect(await cancel(loneId)).toBe(1)
    const gone = await db.query<{ voided: boolean }>(
      `SELECT voided_at IS NOT NULL AS voided FROM pc49.gold_txn WHERE id = $1`, [loneId])
    expect(gone.rows[0].voided).toBe(true)
  })

  it('says a cancelled receipt is already cancelled', async () => {
    const saved = await saveReceipt('cancel-twice', receiptPayload({ partnerCode: 'CANCEL2' }))
    await cancel(saved.receiptId)
    await expect(cancel(saved.receiptId)).rejects.toThrow(/RECEIPT_VOIDED/)
  })
})
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/receipt.test.ts --maxWorkers=4`
Expected: 18 test cũ PASS; khối mới FAIL — `function pc49.correct_gold_receipt(...) does not exist`.

- [ ] **Step 3: Viết migration**

Tạo `supabase/migrations/0075_a_receipt_is_corrected_whole.sql`:

```sql
-- 0075_a_receipt_is_corrected_whole.sql
-- Correcting and cancelling a receipt, every item at once.
--
-- Both take the receipt's key as the ledger lists it: coalesce(receipt_id, id).
-- A row written before receipts existed, or by the loader, a refining lot or a
-- conversion, is a receipt of one line, and is corrected and cancelled the
-- same way.
--
--   receipt_live_lines     the live lines behind a key, in item order
--   refuse_blocked_lines   stops at the first item something else points at
--   correct_gold_receipt   reverses every line and writes the corrected receipt
--                          in one transaction, keeping its number
--   void_gold_receipt      reverses every line
--
-- An item that something else points at (0071's codes) stops the whole
-- receipt, and the refusal names the item: LINE_BLOCKED: item 3 REFINING_SOURCE.
-- Cancelling makes one exception. A pickup is cancelled before its deposit
-- (void_gold_txn itself says so), so DEPOSIT_PICKUP does not stop a void.

CREATE OR REPLACE FUNCTION pc49.receipt_live_lines(p_key uuid)
RETURNS TABLE (txn_id uuid, line_no int)
LANGUAGE sql STABLE AS $$
  SELECT t.id, coalesce(t.line_no, 1)
    FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
     AND t.voided_at IS NULL
   ORDER BY coalesce(t.line_no, 1)
$$;

CREATE OR REPLACE FUNCTION pc49.refuse_blocked_lines(p_key uuid, p_allow text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_line record;
  v_code text;
BEGIN
  FOR v_line IN SELECT l.txn_id, l.line_no FROM pc49.receipt_live_lines(p_key) l ORDER BY l.line_no LOOP
    v_code := pc49.correction_blocked_code(v_line.txn_id);
    IF v_code IS NOT NULL AND NOT v_code = ANY (p_allow) THEN
      RAISE EXCEPTION 'LINE_BLOCKED: item % % cannot be changed here', v_line.line_no, v_code;
    END IF;
  END LOOP;
END $$;

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

GRANT EXECUTE ON FUNCTION pc49.receipt_live_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.refuse_blocked_lines(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION
  pc49.correct_gold_receipt(text, uuid, int, text, jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.void_gold_receipt(uuid, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0075_a_receipt_is_corrected_whole')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/sql/receipt.test.ts --maxWorkers=4`
Expected: PASS, 26 test. Chạy thêm `npx vitest run tests/sql/void-txn.test.ts tests/sql/deposit.test.ts --maxWorkers=4`: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0075_a_receipt_is_corrected_whole.sql tests/sql/receipt.test.ts
git commit -m "feat(receipt): a receipt is corrected and cancelled whole, naming a blocked item"
```

### Task 4: Sổ đọc theo phiếu

**Files:**
- Create: `supabase/migrations/0076_the_ledger_lists_receipts.sql`
- Create: `tests/sql/receipt-ledger.test.ts`

**Interfaces:**
- Consumes: `save_gold_receipt`, `void_gold_receipt`, `receipt_live_lines` (Task 2–3); `gold_txn_shared_by`, `gold_txn_paid_with`, `partner_phone_matches`, `fold_search` (0068–0069).
- Produces (tham số lọc giống hệt `gold_txn_ledger`: `p_from, p_to, p_type, p_gold, p_staff, p_method, p_status, p_query`):
  - `pc49.gold_receipt_ledger(..., p_limit int DEFAULT 50, p_offset int DEFAULT 0)` trả `receipt_key uuid, receipt_id uuid, txn_date date, doc_no text, txn_type text, partner_code text, partner_phone text, sales_person_code text, remarks text, revision int, blocked_code text, amount numeric, line_count int, lines jsonb, payments jsonb, sold_by jsonb, total_count bigint`;
  - phần tử `lines`: `{id, lineNo, itemDesc, goldTypeCode, scrapDetail, goldPct, uom, qty, unitPrice, amount, blockedCode}`; phần tử `payments`: `{seq, amount, method}`; phần tử `sold_by`: `{code, sharePct}`;
  - `pc49.gold_receipt_ledger_totals(...)` trả `receipt_count bigint, purchases numeric, sales numeric, grams_by_gold jsonb`.

- [ ] **Step 1: Viết test hỏng**

Tạo `tests/sql/receipt-ledger.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDb } from '../support/db'
import { SIX_ITEMS, purchaseLine, receiptPayload } from '../support/receipt'

const KT = '11111111-1111-1111-1111-111111111111'

type Row = {
  receipt_key: string
  receipt_id: string | null
  doc_no: string
  line_count: number
  amount: string
  blocked_code: string | null
  total_count: string
  lines: { itemDesc: string | null; goldTypeCode: string; amount: number }[]
  payments: { seq: number; amount: number; method: string }[]
  sold_by: { code: string; sharePct: number }[]
}

type Filters = {
  from?: string; to?: string; type?: string; gold?: string; staff?: string
  method?: string; status?: string; query?: string; limit?: number | null; offset?: number
}
const ARGS = `p_from => $1, p_to => $2, p_type => $3, p_gold => $4, p_staff => $5,
              p_method => $6, p_status => $7, p_query => $8`
const params = (f: Filters) => [f.from ?? null, f.to ?? null, f.type ?? null, f.gold ?? null,
  f.staff ?? null, f.method ?? null, f.status ?? null, f.query ?? null]

let db: PGlite
const doc = { A: '', B: '', C: '', E: '' }
const key = { A: '', B: '', C: '', E: '' }

async function ledger(f: Filters = {}) {
  const r = await db.query<Row>(
    `SELECT receipt_key, receipt_id, doc_no, line_count, amount::text, blocked_code,
            total_count::text, lines, payments, sold_by
       FROM pc49.gold_receipt_ledger(${ARGS}, p_limit => $9, p_offset => $10)`,
    [...params(f), f.limit === undefined ? 50 : f.limit, f.offset ?? 0])
  return r.rows
}
const docs = async (f: Filters = {}) => (await ledger(f)).map((r) => r.doc_no)

async function save(k: string, body: string) {
  const r = await asRole(db, KT, () => db.query<{ r: { receiptId: string; docNo: string } }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [k, body]))
  return r.rows[0].r
}

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'accountant@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
  `)

  // A: a scrap ring and a bar, paid part in cash and part by wire.
  const a = await save('A', receiptPayload({
    txnDate: '2026-03-10', partnerCode: 'KHACH A',
    lines: [purchaseLine(SIX_ITEMS[0]), purchaseLine(SIX_ITEMS[2])],
    payments: [{ amount: 950, method: 'CASH' }, { amount: 1900, method: 'BANKWIRE' }],
  }))

  // B: saved the way everything was saved before receipts.
  const b = await asRole(db, KT, () => db.query<{ r: { txnId: string } }>(
    `SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`, ['B', JSON.stringify({
      txnDate: '2026-03-12', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM', qty: 10,
      unitPrice: 50, amount: -500, partnerCode: 'KHACH B', scrapDetail: null, goldPct: null,
      remarks: null, payments: [{ amount: 500, method: 'CASH' }],
      salesPeople: [{ code: 'P.Minh', sharePct: 100 }],
    })]))
  const bId = b.rows[0].r.txnId

  // C: one Rong Phung sold.
  const c = await save('C', receiptPayload({
    txnDate: '2026-03-15', txnType: 'SALE', partnerCode: 'KHACH C',
    lines: [{ itemDesc: 'RP 1 luong', goldTypeCode: 'RP', uom: 'LUONG', qty: -1,
              unitPrice: 5000, amount: 5000, scrapDetail: null, goldPct: null }],
    payments: [{ amount: 5000, method: 'ZELLE' }],
  }))

  // D: typed twice and cancelled, so never listed.
  const d = await save('D', receiptPayload({
    txnDate: '2026-03-20', partnerCode: 'KHACH D',
    lines: [purchaseLine(SIX_ITEMS[1])], payments: [{ amount: 825, method: 'CASH' }],
  }))
  await asRole(db, KT, () => db.query(
    `SELECT pc49.void_gold_receipt($1, 'nhap trung')`, [d.receiptId]))

  // E: two scrap items, the second already picked into a refining lot.
  const e = await save('E', receiptPayload({
    txnDate: '2026-03-25', partnerCode: 'KHACH E',
    lines: [purchaseLine(SIX_ITEMS[1]), purchaseLine(SIX_ITEMS[5])],
    payments: [{ amount: 861, method: 'CASH' }],
  }))
  const second = await db.query<{ id: string }>(
    `SELECT id FROM pc49.gold_txn WHERE receipt_id = $1 AND line_no = 2`, [e.receiptId])
  const lot = await db.query<{ id: string }>(
    `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.LEDGER') RETURNING id`)
  await db.query(`INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`,
    [lot.rows[0].id, second.rows[0].id])

  const bDoc = await db.query<{ doc_no: string }>(
    `SELECT doc_no FROM pc49.gold_txn WHERE id = $1`, [bId])
  Object.assign(doc, { A: a.docNo, B: bDoc.rows[0].doc_no, C: c.docNo, E: e.docNo })
  Object.assign(key, { A: a.receiptId, B: bId, C: c.receiptId, E: e.receiptId })
}, 180_000)

afterAll(async () => { await db?.close() })

describe('the ledger, one receipt a row', () => {
  it('lists receipts newest first, an older transaction as one item, never a cancelled one', async () => {
    const rows = await ledger()
    expect(rows.map((r) => r.doc_no)).toEqual([doc.E, doc.C, doc.B, doc.A])
    expect(rows.map((r) => r.line_count)).toEqual([2, 1, 1, 2])
    expect(rows.map((r) => r.receipt_key)).toEqual([key.E, key.C, key.B, key.A])
    expect(rows[2].receipt_id).toBeNull()
  })

  it('carries the items, what they come to, and what was paid by each method', async () => {
    const [a] = await ledger({ query: doc.A })
    expect(a.lines.map((l) => l.itemDesc)).toEqual(['Nhẫn 24K (vụn)', 'Thỏi RCM'])
    expect(Number(a.amount)).toBe(-2850)
    expect(a.payments.map((p) => `${Number(p.amount)} ${p.method}`))
      .toEqual(['950 CASH', '1900 BANKWIRE'])
    expect(a.sold_by.map((p) => `${p.code} ${Number(p.sharePct)}`))
      .toEqual(['L.Thanh 80', 'P.Minh 20'])
  })

  it('finds a receipt by any one of its items, and shows all of them', async () => {
    const bars = await ledger({ gold: 'GRAIN' })
    expect(bars.map((r) => r.doc_no)).toEqual([doc.A])
    expect(bars[0].lines).toHaveLength(2)
    expect(await docs({ method: 'BANKWIRE' })).toEqual([doc.A])
    expect(await docs({ staff: 'P.Minh' })).toEqual([doc.E, doc.C, doc.B, doc.A])
  })

  it('searches what the items are called, without accents', async () => {
    expect(await docs({ query: 'thoi rcm' })).toEqual([doc.A])
  })

  it('locks a whole receipt when one of its items cannot be corrected', async () => {
    expect(await docs({ status: 'locked' })).toEqual([doc.E])
    expect(await docs({ status: 'correctable' })).toEqual([doc.C, doc.B, doc.A])
    expect((await ledger({ query: doc.E }))[0].blocked_code).toBe('REFINING_SOURCE')
  })

  it('pages by receipts and counts receipts', async () => {
    const page = await ledger({ limit: 2, offset: 0 })
    expect(page.map((r) => r.doc_no)).toEqual([doc.E, doc.C])
    expect(page.every((r) => r.total_count === '4')).toBe(true)
  })

  it('totals the items as before and counts receipts', async () => {
    const all = await db.query<{ n: string; purchases: string; sales: string }>(
      `SELECT receipt_count::text AS n, purchases::text, sales::text
         FROM pc49.gold_receipt_ledger_totals(${ARGS})`, params({}))
    expect(all.rows[0].n).toBe('4')
    expect(Number(all.rows[0].purchases)).toBe(2850 + 500 + 861)
    expect(Number(all.rows[0].sales)).toBe(5000)

    const bars = await db.query<{ n: string; purchases: string }>(
      `SELECT receipt_count::text AS n, purchases::text
         FROM pc49.gold_receipt_ledger_totals(${ARGS})`, params({ gold: 'GRAIN' }))
    expect(bars.rows[0].n).toBe('1')
    expect(Number(bars.rows[0].purchases)).toBe(1900)
  })

  it('checks each item inside the query rather than calling a function per row', async () => {
    const plan = await db.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT count(*) FROM pc49.gold_txn t
        WHERE pc49.gold_receipt_ledger_match(t, NULL::date, NULL::date, NULL, NULL, NULL, NULL, NULL, NULL)`)
    expect(plan.rows.map((r) => r['QUERY PLAN']).join(' ')).not.toContain('gold_receipt_ledger_match')
  })

  it('is read with the permissions of the person asking', async () => {
    const r = await asRole(db, KT, () => db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt_ledger()`))
    expect(r.rows[0].n).toBe('4')
  })
})
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/receipt-ledger.test.ts --maxWorkers=4`
Expected: FAIL — `function pc49.gold_receipt_ledger(...) does not exist`.

- [ ] **Step 3: Viết migration**

Tạo `supabase/migrations/0076_the_ledger_lists_receipts.sql`:

```sql
-- 0076_the_ledger_lists_receipts.sql
-- The gold ledger lists receipts, one row each, with their items beneath.
--
-- The predicate is 0069's, one line at a time, with two changes. The search
-- also reads what the items are called ("nhan" finds the receipt with the
-- ring on it). And whether a receipt can be corrected is a fact about the
-- receipt: one item in a refining lot locks all of it, so every line of that
-- receipt answers "locked", and the receipt is never listed as correctable
-- because its other items could have been.
--
-- A receipt matches when any of its live items matches, so a filter on a gold
-- type finds the receipt with that gold on it and shows the whole receipt.
-- The totals still add up matching items, so purchases, sales and grams are
-- the figures they were; what they count is receipts.
--
--   gold_receipt_locked         a live item of the receipt is blocked (0071)
--   gold_receipt_ledger_match   the predicate
--   gold_receipt_lines          a receipt's items, as the screen expands them
--   gold_receipt_payments       what was paid on the receipt, by method
--   gold_receipt_sold_by        who sold it: the first item's shares
--   gold_receipt_ledger         one page of receipts, with the count of all
--   gold_receipt_ledger_totals  receipts, purchases, sales and grams per gold type
--
-- 0068's gold_txn_ledger and gold_txn_ledger_totals stay until nothing calls
-- them, and go in a later migration. Like 0069's helpers, nothing here sets a
-- search_path: every name is qualified, and the predicate must stay foldable.

CREATE OR REPLACE FUNCTION pc49.gold_receipt_locked(p_key uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pc49.gold_txn t
                  WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
                    AND t.voided_at IS NULL
                    AND pc49.correction_blocked_code(t.id) IS NOT NULL)
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
     AND (p_method IS NULL OR pc49.gold_txn_paid_with(t.id, p_method))
     AND (p_status IS NULL
          OR (p_status = 'correctable'
              AND NOT pc49.gold_receipt_locked(coalesce(t.receipt_id, t.id)))
          OR (p_status = 'locked'
              AND pc49.gold_receipt_locked(coalesce(t.receipt_id, t.id))))
     AND (p_query IS NULL
          OR pc49.fold_search(p_query) = ''
          OR pc49.fold_search(t.doc_no) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.partner_code) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.remarks) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.fold_search(t.item_desc) LIKE '%' || pc49.fold_search(p_query) || '%'
          OR pc49.partner_phone_matches(t.partner_code, p_query))
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_lines(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'lineNo', coalesce(t.line_no, 1), 'itemDesc', t.item_desc,
           'goldTypeCode', t.gold_type_code, 'scrapDetail', t.scrap_detail,
           'goldPct', t.gold_pct, 'uom', t.uom, 'qty', t.qty,
           'unitPrice', t.unit_price, 'amount', t.amount,
           'blockedCode', pc49.correction_blocked_code(t.id))
         ORDER BY coalesce(t.line_no, 1)), '[]'::jsonb)
    FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
     AND t.voided_at IS NULL
$$;

-- One entry per method, in the order each was first used on the receipt: the
-- items' payments added back together.
CREATE OR REPLACE FUNCTION pc49.gold_receipt_payments(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'seq', m.seq, 'amount', m.amount, 'method', m.method) ORDER BY m.seq), '[]'::jsonb)
    FROM (SELECT gp.method::text AS method,
                 sum(gp.amount) AS amount,
                 row_number() OVER (ORDER BY min(coalesce(t.line_no, 1) * 1000 + gp.seq)) AS seq
            FROM pc49.gold_txn t
            JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
           WHERE (t.receipt_id = p_key OR (t.id = p_key AND t.receipt_id IS NULL))
             AND t.voided_at IS NULL
           GROUP BY gp.method) m
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_sold_by(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'code', s.sales_person_code, 'sharePct', s.share_pct)
         ORDER BY s.share_pct DESC, s.sales_person_code), '[]'::jsonb)
    FROM pc49.gold_txn_sales_person s
   WHERE s.txn_id = (SELECT l.txn_id FROM pc49.receipt_live_lines(p_key) l
                      ORDER BY l.line_no LIMIT 1)
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_ledger(
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
  lines jsonb, payments jsonb, sold_by jsonb, total_count bigint)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  -- Receipts are chosen and paged first, so the work below is done for fifty
  -- receipts, not all of them.
  WITH hit AS (
    SELECT coalesce(t.receipt_id, t.id) AS k,
           max(t.txn_date) AS txn_date,
           max(t.doc_no) AS doc_no,
           max(t.created_at) AS created_at
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
     GROUP BY coalesce(t.receipt_id, t.id)
  ),
  page AS (
    SELECT h.*, count(*) OVER () AS matched
      FROM hit h
     ORDER BY h.txn_date DESC, h.doc_no DESC NULLS LAST, h.created_at DESC, h.k
     LIMIT p_limit OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT p.k, r.id, p.txn_date, p.doc_no, f.txn_type::text, f.partner_code, pa.phone,
         f.sales_person_code, f.remarks, coalesce(r.revision, f.revision),
         (SELECT x ->> 'blockedCode' FROM jsonb_array_elements(ln.lines) x
           WHERE x ->> 'blockedCode' IS NOT NULL
           ORDER BY (x ->> 'lineNo')::int LIMIT 1),
         (SELECT coalesce(sum((x ->> 'amount')::numeric), 0)
            FROM jsonb_array_elements(ln.lines) x),
         jsonb_array_length(ln.lines),
         ln.lines,
         pc49.gold_receipt_payments(p.k),
         pc49.gold_receipt_sold_by(p.k),
         p.matched
    FROM page p
    CROSS JOIN LATERAL (SELECT pc49.gold_receipt_lines(p.k) AS lines) ln
    JOIN LATERAL (SELECT t.* FROM pc49.gold_txn t
                   WHERE (t.receipt_id = p.k OR (t.id = p.k AND t.receipt_id IS NULL))
                     AND t.voided_at IS NULL
                   ORDER BY coalesce(t.line_no, 1) LIMIT 1) f ON true
    LEFT JOIN pc49.gold_receipt r ON r.id = p.k
    LEFT JOIN pc49.partner pa ON pa.code = f.partner_code
   ORDER BY p.txn_date DESC, p.doc_no DESC NULLS LAST, p.created_at DESC, p.k
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_ledger_totals(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_gold   text DEFAULT NULL,
  p_staff  text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_query  text DEFAULT NULL)
RETURNS TABLE (receipt_count bigint, purchases numeric, sales numeric, grams_by_gold jsonb)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH matched AS (
    SELECT coalesce(t.receipt_id, t.id) AS k, t.txn_type, t.amount, t.gold_type_code, t.qty_gram
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
  )
  -- Purchases are stored negative and sales positive (0012); both are reported
  -- as the money that changed hands.
  SELECT (SELECT count(DISTINCT k) FROM matched),
         coalesce((SELECT -sum(amount) FROM matched WHERE txn_type IN ('PO', 'PO_VENDOR')), 0),
         coalesce((SELECT sum(amount) FROM matched WHERE txn_type IN ('SALE', 'PICKUP')), 0),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, g.grams)
                     FROM (SELECT gold_type_code, sum(qty_gram) AS grams FROM matched
                            GROUP BY gold_type_code HAVING sum(qty_gram) <> 0) g), '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION pc49.gold_receipt_locked(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger_match(
  pc49.gold_txn, date, date, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_payments(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_sold_by(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger_totals(
  date, date, text, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0076_the_ledger_lists_receipts')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/sql/receipt-ledger.test.ts --maxWorkers=4`
Expected: PASS, 9 test. Nếu test kế hoạch truy vấn hỏng: tìm trong `gold_receipt_ledger_match` chỗ còn truy vấn con hoặc `SET`, tách ra hàm nhỏ như `gold_receipt_locked`.

Rồi chạy riêng toàn bộ SQL (không chạy lệnh test nào khác cùng lúc): `npx vitest run tests/sql --maxWorkers=4`. Expected: PASS hết.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0076_the_ledger_lists_receipts.sql tests/sql/receipt-ledger.test.ts
git commit -m "feat(receipt): the ledger lists receipts, a receipt matching when any item does"
```

### Task 5: Phép tính của một món, lời từ chối, chữ giao diện

**Files:**
- Modify: `src/components/gold/types.ts` (thêm `ReceiptLine`, `ReceiptRow` ở cuối file)
- Create: `src/components/gold/receiptLine.ts`
- Create: `src/components/gold/receiptErrors.ts`
- Modify: `src/lib/i18n/ui-gold.ts`, `src/lib/i18n/dictionary.ts`
- Test: `tests/lib/receipt-line.test.ts`, `tests/lib/receipt-errors.test.ts`

**Interfaces:**
- Consumes: `amountOf`, `SCRAP_TYPES` (`types.ts`); `Uom` (`@/lib/domain/units`); `t(locale, key)`, `MessageKey` (`@/lib/i18n`); `tests/support/receipt.ts` (Task 2).
- Produces:
  - `types.ts`: `type ReceiptLine`, `type ReceiptRow` (trường như dưới);
  - `receiptLine.ts`: `MAX_RECEIPT_LINES = 30`, `SINGLE_LINE_TYPES: Set<string>`, `signFollowsType(txnType): boolean`, `signedQty(txnType, typed): number`, `type LineField`, `type Figures`, `type Typed`, `fineGrams(uom, qty, goldPct): number | null`, `pricedByFine(uom, goldPct): boolean`, `relate(uom, line: Figures, typed: Typed): Figures`, `receiptTotal(lines): number`, `paymentGap(total, payments): number`, `type LinePayload`, `linePayload(txnType, uom, line): LinePayload`, `lineFromSaved(txnType, line: ReceiptLine): LineField`;
  - `receiptErrors.ts`: `blockedSentence(code, t): string | null`, `describeRefusal(message, t): string`;
  - khoá từ điển `receipt.*` (danh sách trong Step 5).

- [ ] **Step 1: Thêm kiểu phiếu**

Thêm vào cuối `src/components/gold/types.ts`:

```ts
/** One item of a receipt, as the ledger lists it (pc49.gold_receipt_lines, 0076). */
export type ReceiptLine = {
  id: string
  lineNo: number
  itemDesc: string | null
  gold_type_code: string
  scrap_detail: string | null
  gold_pct: number | null
  uom: Uom
  qty: number
  unit_price: number | null
  amount: number
  /** 0071's code when this item cannot be corrected, or null. */
  blockedCode: string | null
}

/**
 * One receipt of the ledger (pc49.gold_receipt_ledger, 0076).
 *
 * A row written before receipts existed, or by the loader, a refining lot or a
 * conversion, is a receipt of one item, and its `key` is its own id. Correcting
 * and cancelling are asked for by `key` either way.
 */
export type ReceiptRow = {
  key: string
  receiptId: string | null
  txn_date: string
  doc_no: string | null
  txn_type: string
  partner_code: string | null
  partner_phone: string | null
  sales_person_code: string | null
  remarks: string | null
  /** What the screen was showing, so a correction can tell if it has moved. */
  revision: number
  /** The first blocked item's code when any item cannot be corrected, or null. */
  blockedCode: string | null
  /** What the items come to, signed as stored: a purchase is negative. */
  amount: number
  lines: ReceiptLine[]
  /** What was paid on the receipt, one entry per method, in the order first used. */
  payments: { seq: number; amount: number; method: string }[]
  /** Who is credited with it, largest share first. */
  soldBy: { code: string; sharePct: number }[]
}
```

- [ ] **Step 2: Viết test hỏng cho phép tính**

Tạo `tests/lib/receipt-line.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  fineGrams, lineFromSaved, linePayload, paymentGap, pricedByFine, receiptTotal, relate,
  signedQty, type Figures,
} from '@/components/gold/receiptLine'
import { amountOf, type ReceiptLine } from '@/components/gold/types'
import { SIX_ITEMS } from '../support/receipt'

const figures = (over: Partial<Figures>): Figures => ({
  qty: null, goldPct: null, finePrice: null, unitPrice: null, total: null, ...over,
})

describe('the sign of a quantity', () => {
  it('comes from the type where the table already fixes it', () => {
    expect(signedQty('PO', 5)).toBe(5)
    expect(signedQty('PO_VENDOR', -5)).toBe(5)
    expect(signedQty('SALE', 5)).toBe(-5)
    expect(signedQty('PICKUP', -5)).toBe(-5)
  })

  it('is kept as typed where it carries meaning', () => {
    expect(signedQty('ON_THE_WAY', -5)).toBe(-5)
    expect(signedQty('MEMO', 5)).toBe(5)
  })
})

describe('fine grams', () => {
  it('are the weight times the purity, for gold weighed in grams', () => {
    expect(fineGrams('GRAM', 9.4, 0.987)).toBeCloseTo(9.2778, 10)
    expect(fineGrams('GRAM', -9.4, 0.987)).toBeCloseTo(9.2778, 10)
    expect(pricedByFine('GRAM', 0.987)).toBe(true)
  })

  it('are not there for gold counted in units, or with no purity', () => {
    expect(fineGrams('OZ', 1, 0.9999)).toBeNull()
    expect(fineGrams('GRAM', 4.5, null)).toBeNull()
    expect(pricedByFine('GRAM', null)).toBe(false)
    expect(pricedByFine('LUONG', 0.9999)).toBe(false)
  })
})

describe('one figure typed, the others following', () => {
  it('works both prices out from the amount on the paper', () => {
    const r = relate('GRAM', figures({ qty: 9.4, goldPct: 0.987, total: 950 }), 'total')
    expect(r.unitPrice).toBe(101.06382979)
    expect(r.finePrice).toBe(102.39)
    expect(r.total).toBe(950)
  })

  it('works the amount out from a price per fine gram, and keeps the price typed', () => {
    const r = relate('GRAM', figures({ qty: 0.6, goldPct: 0.597, finePrice: 100.5 }), 'finePrice')
    expect(r.total).toBe(36)
    expect(r.unitPrice).toBe(60)
    expect(r.finePrice).toBe(100.5)
  })

  it('prices gold counted in units by the unit', () => {
    const r = relate('OZ', figures({ qty: 2, unitPrice: 3970 }), 'unitPrice')
    expect(r.total).toBe(7940)
    expect(r.finePrice).toBeNull()
  })

  it('prices scrap with no purity by the gram, as before', () => {
    const r = relate('GRAM', figures({ qty: 4.5, total: 250 }), 'total')
    expect(r.unitPrice).toBe(55.55555556)
    expect(r.finePrice).toBeNull()
  })

  it('keeps the amount when the weight or the purity changes after it', () => {
    const weighed = relate('GRAM', figures({ qty: 12.5, unitPrice: 25, total: 250 }), 'qty')
    expect(weighed).toMatchObject({ total: 250, unitPrice: 20 })
    const assayed = relate('GRAM',
      figures({ qty: 9.4, goldPct: 0.987, unitPrice: 101.06382979, total: 950 }), 'goldPct')
    expect(assayed).toMatchObject({ total: 950, finePrice: 102.39 })
  })

  it('clears the prices when the amount is cleared', () => {
    const r = relate('GRAM', figures({ qty: 9.4, goldPct: 0.987, finePrice: 102.39, unitPrice: 101, total: null }), 'total')
    expect(r).toMatchObject({ total: null, unitPrice: null, finePrice: null })
  })

  it('gives every item on the paper a price the database will agree with to the cent', () => {
    // write_gold_transaction recomputes the amount from quantity and price and
    // refuses a difference over half a cent (0054).
    for (const item of SIX_ITEMS) {
      const r = relate('GRAM', figures({ qty: item.qty, goldPct: item.goldPct, total: item.total }), 'total')
      expect(amountOf(signedQty('PO', item.qty), r.unitPrice)).toBe(-item.total)
    }
  })
})

describe('the foot of the receipt', () => {
  it('adds the items up to the paper total', () => {
    expect(receiptTotal(SIX_ITEMS.map((i) => ({ total: i.total })))).toBe(8361)
    expect(receiptTotal([{ total: 10 }, undefined, { total: null }])).toBe(10)
  })

  it('says how far the payments are from it, either way', () => {
    expect(paymentGap(8361, [{ amount: 5000 }, { amount: 3361 }])).toBe(0)
    expect(paymentGap(8361, [{ amount: 8000 }, { amount: null }, undefined])).toBe(-361)
    expect(paymentGap(8361, [{ amount: 9000 }])).toBe(639)
  })
})

describe('an item on its way to the database, and back', () => {
  it('carries the sign of the receipt and drops what does not apply', () => {
    expect(linePayload('SALE', 'LUONG', {
      itemDesc: '  ', goldTypeCode: 'RP', scrapDetail: '19-24k/grs', qty: 1, goldPct: null,
      finePrice: null, unitPrice: 5000, total: 5000,
    })).toEqual({
      itemDesc: null, goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5000,
      amount: 5000, scrapDetail: null, goldPct: null,
    })
    expect(linePayload('PO', 'GRAM', {
      itemDesc: ' Thỏi RCM ', goldTypeCode: 'GRAIN', scrapDetail: null, qty: 15.6, goldPct: 0.998,
      finePrice: 122.04, unitPrice: 121.79487179, total: 1900,
    })).toMatchObject({ itemDesc: 'Thỏi RCM', qty: 15.6, amount: -1900, goldPct: 0.998 })
  })

  it('comes back to the form unsigned, with its price per fine gram', () => {
    const saved: ReceiptLine = {
      id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG', scrap_detail: '19-24k/grs',
      gold_pct: 0.987, uom: 'GRAM', qty: 9.4, unit_price: 101.06382979, amount: -950, blockedCode: null,
    }
    expect(lineFromSaved('PO', saved)).toEqual({
      itemDesc: 'Nhẫn 24K (vụn)', goldTypeCode: 'SG', scrapDetail: '19-24k/grs', qty: 9.4,
      goldPct: 0.987, unitPrice: 101.06382979, total: 950, finePrice: 102.39,
    })
    expect(lineFromSaved('SALE', { ...saved, gold_type_code: 'RP', uom: 'LUONG', qty: -1, gold_pct: null, amount: 5000, unit_price: 5000 }))
      .toMatchObject({ qty: 1, total: 5000, finePrice: null })
    expect(lineFromSaved('ON_THE_WAY', { ...saved, qty: -3, gold_pct: null, amount: 0, unit_price: null }))
      .toMatchObject({ qty: -3, total: null })
  })
})
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `npx vitest run tests/lib/receipt-line.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/gold/receiptLine"`.

- [ ] **Step 4: Viết `receiptLine.ts`**

Tạo `src/components/gold/receiptLine.ts`:

```ts
import type { Uom } from '@/lib/domain/units'
import { amountOf, SCRAP_TYPES, type ReceiptLine } from './types'

/** More than this on one receipt is refused by the database too (0074). */
export const MAX_RECEIPT_LINES = 30

/** Deposits and pickups are tied to each other one transaction at a time. */
export const SINGLE_LINE_TYPES = new Set(['DEPOSIT', 'PICKUP'])

/**
 * The receipt types whose sign the table already fixes (0012): a purchase
 * brings gold in, a sale or a pickup takes it out. On these a quantity is
 * typed without a sign and the type supplies it; six items on one receipt were
 * six chances to forget a minus, and the database refused each. Every other
 * type keeps the sign it is typed with, because there the sign is the only
 * thing saying whether the gold is on its way in or out.
 */
const INWARD = new Set(['PO', 'PO_VENDOR'])
const OUTWARD = new Set(['SALE', 'PICKUP'])

export function signFollowsType(txnType: string): boolean {
  return INWARD.has(txnType) || OUTWARD.has(txnType)
}

export function signedQty(txnType: string, typed: number): number {
  if (INWARD.has(txnType)) return Math.abs(typed)
  if (OUTWARD.has(txnType)) return -Math.abs(typed)
  return typed
}

/** One item as the form holds it. The money is unsigned, as on the paper. */
export type LineField = {
  itemDesc: string
  goldTypeCode: string
  scrapDetail: string | null
  qty: number | null
  goldPct: number | null
  finePrice: number | null
  unitPrice: number | null
  total: number | null
}

export type Figures = Pick<LineField, 'qty' | 'goldPct' | 'finePrice' | 'unitPrice' | 'total'>
export type Typed = keyof Figures

const given = (n: number | null | undefined): n is number =>
  n !== null && n !== undefined && !Number.isNaN(n)
const cents = (n: number) => Math.round(n * 100) / 100
/**
 * Eight places, as the form has always kept a price: the database recomputes
 * the amount from quantity and price and refuses half a cent's difference
 * (0054), and 3200 over 34.98 g rounded to cents comes back as 3199.99.
 */
const eightPlaces = (n: number) => Math.round(n * 1e8) / 1e8

/**
 * Grams of fine gold in an item: its weight times its purity.
 *
 * Only for gold weighed in grams, and only when the purity is known. An item
 * with no purity is priced by its weight, as every item was before.
 */
export function fineGrams(
  uom: Uom | '', qty: number | null | undefined, goldPct: number | null | undefined,
): number | null {
  if (uom !== 'GRAM' || !given(qty) || qty === 0 || !given(goldPct) || goldPct <= 0) return null
  return Math.abs(qty) * goldPct
}

/** Whether the item is priced per fine gram, as the paper receipt prices it, or per unit. */
export function pricedByFine(uom: Uom | '', goldPct: number | null | undefined): boolean {
  return uom === 'GRAM' && given(goldPct) && goldPct > 0
}

/**
 * One figure of an item typed; the others follow.
 *
 * The receipt's own amount is the one to trust: 950 over 9.2778 fine grams is
 * 102.3949…, and that price rounded to cents comes back as 949.95. So an amount,
 * once typed, stays, and the prices are worked out from it. A weight or a
 * purity typed afterwards keeps the amount too.
 */
export function relate(uom: Uom | '', line: Figures, typed: Typed): Figures {
  const q = given(line.qty) ? Math.abs(line.qty) : 0
  const fine = fineGrams(uom, line.qty, line.goldPct)

  const fromTotal = (total: number | null): Figures => (given(total) && q
    ? { ...line, total, unitPrice: eightPlaces(total / q), finePrice: fine ? cents(total / fine) : null }
    : { ...line, total: given(total) ? total : null, unitPrice: null, finePrice: null })

  if (typed === 'total') return fromTotal(line.total)
  if (typed === 'finePrice') {
    return given(line.finePrice) && fine
      ? { ...fromTotal(cents(line.finePrice * fine)), finePrice: line.finePrice }
      : { ...line, total: null, unitPrice: null }
  }
  if (typed === 'unitPrice') {
    if (!given(line.unitPrice) || !q) return { ...line, total: null, finePrice: null }
    const total = cents(q * line.unitPrice)
    return { ...line, total, finePrice: fine ? cents(total / fine) : null }
  }
  // A weight or a purity: the money already there stays, and the prices follow.
  if (given(line.total)) return fromTotal(line.total)
  if (given(line.finePrice) && fine) return relate(uom, line, 'finePrice')
  if (given(line.unitPrice)) return relate(uom, line, 'unitPrice')
  return line
}

/** What the items come to, as at the foot of the paper receipt. */
export function receiptTotal(lines: ({ total: number | null } | undefined)[]): number {
  return cents(lines.reduce((sum, l) => sum + (given(l?.total) ? Number(l.total) : 0), 0))
}

/** Paid minus owed: above zero when more was paid than the receipt, below when less. */
export function paymentGap(total: number, payments: ({ amount: number | null } | undefined)[]): number {
  const paid = payments.reduce((sum, p) => sum + (given(p?.amount) ? Number(p.amount) : 0), 0)
  return cents(paid - total)
}

/** An item as save_gold_receipt takes it (0074). */
export type LinePayload = {
  itemDesc: string | null
  goldTypeCode: string
  uom: Uom
  qty: number
  unitPrice: number | null
  amount: number
  scrapDetail: string | null
  goldPct: number | null
}

export function linePayload(txnType: string, uom: Uom, line: LineField): LinePayload {
  const qty = signedQty(txnType, Number(line.qty))
  const unitPrice = given(line.unitPrice) ? line.unitPrice : null
  return {
    itemDesc: line.itemDesc?.trim() || null,
    goldTypeCode: line.goldTypeCode,
    uom,
    qty,
    unitPrice,
    amount: amountOf(qty, unitPrice),
    scrapDetail: SCRAP_TYPES.has(line.goldTypeCode) ? (line.scrapDetail ?? null) : null,
    goldPct: given(line.goldPct) ? line.goldPct : null,
  }
}

/** A saved item, back on the form to be corrected. */
export function lineFromSaved(txnType: string, line: ReceiptLine): LineField {
  const total = Math.abs(line.amount)
  const fine = fineGrams(line.uom, line.qty, line.gold_pct)
  return {
    itemDesc: line.itemDesc ?? '',
    goldTypeCode: line.gold_type_code,
    scrapDetail: line.scrap_detail,
    qty: signFollowsType(txnType) ? Math.abs(line.qty) : line.qty,
    goldPct: line.gold_pct,
    unitPrice: line.unit_price,
    total: line.unit_price === null && total === 0 ? null : total,
    finePrice: fine && total ? cents(total / fine) : null,
  }
}
```

Run: `npx vitest run tests/lib/receipt-line.test.ts`
Expected: PASS, 15 test.

- [ ] **Step 5: Thêm chữ giao diện**

Trong `src/lib/i18n/ui-gold.ts`, khối `vi`: đổi `'txn.total.count': 'Số giao dịch'` thành `'txn.total.count': 'Số phiếu'`, rồi thêm trước dấu `},` đóng khối `vi`:

```ts
    'receipt.lines': 'Các món',
    'receipt.linesHint': 'Mỗi món một dòng, như trên tờ phiếu. Gõ thành tiền thì giá tự tính; gõ giá thì thành tiền tự tính.',
    'receipt.signHint': 'Mua vào và bán ra: gõ số lượng không dấu, loại phiếu tự đặt dấu. Loại khác: gõ cả dấu, dương là vào, âm là ra.',
    'receipt.item': 'Món {0}',
    'receipt.itemDesc': 'Mô tả món',
    'receipt.addItem': 'Thêm món',
    'receipt.removeItem': 'Bỏ món này',
    'receipt.fine': 'Gram tinh',
    'receipt.finePrice': 'Giá/gram tinh',
    'receipt.total': 'Tổng phiếu',
    'receipt.weight': 'Tổng trọng lượng',
    'receipt.gap.over': 'Thanh toán nhiều hơn tổng phiếu {0}',
    'receipt.gap.under': 'Thanh toán còn thiếu {0} so với tổng phiếu',
    'receipt.mixed': 'Nhiều loại ({0} món)',
    'receipt.count': '{0} món',
    'receipt.col.line': 'Món',
    'receipt.err.paymentShort': 'Món {0} chưa có đồng thanh toán nào: tổng thanh toán không tới món này. Mua vào và đặt cọc được ghi sổ theo số tiền đã trả.',
    'receipt.err.blocked': 'Món {0}: {1}',
    'receipt.err.single': 'Đặt cọc và lấy hàng chỉ có một món trên một phiếu.',
    'receipt.err.size': 'Một phiếu có từ 1 đến 30 món.',
    'receipt.err.direction': 'Mọi món trên một phiếu phải cùng chiều. Khách đổi vàng thì lập hai phiếu.',
    'receipt.err.qty': 'Món {0} chưa có số lượng.',
    'receipt.err.conflict': 'Phiếu này vừa được người khác sửa hoặc huỷ. Đóng form, tải lại sổ rồi thử lại.',
```

Khối `en`: đổi `'txn.total.count': 'Transactions'` thành `'txn.total.count': 'Receipts'`, rồi thêm trước dấu `},` đóng khối `en`:

```ts
    'receipt.lines': 'Items',
    'receipt.linesHint': 'One line per item, as on the paper receipt. Type the amount and the price follows, or type the price and the amount follows.',
    'receipt.signHint': 'Purchases and sales: type quantities without a sign; the receipt type sets it. Other types: type the sign, positive in and negative out.',
    'receipt.item': 'Item {0}',
    'receipt.itemDesc': 'Item',
    'receipt.addItem': 'Add an item',
    'receipt.removeItem': 'Remove this item',
    'receipt.fine': 'Fine grams',
    'receipt.finePrice': 'Price per fine gram',
    'receipt.total': 'Receipt total',
    'receipt.weight': 'Total weight',
    'receipt.gap.over': 'Payments are {0} more than the receipt total',
    'receipt.gap.under': 'Payments are {0} short of the receipt total',
    'receipt.mixed': 'Mixed ({0} items)',
    'receipt.count': '{0} items',
    'receipt.col.line': 'Item no.',
    'receipt.err.paymentShort': 'Item {0} gets no payment: the payments on this receipt do not reach it. A purchase or a deposit is booked from what was paid.',
    'receipt.err.blocked': 'Item {0}: {1}',
    'receipt.err.single': 'A deposit or a pickup has one item per receipt.',
    'receipt.err.size': 'A receipt holds from 1 to 30 items.',
    'receipt.err.direction': 'Every item on a receipt moves the same way. An exchange is two receipts.',
    'receipt.err.qty': 'Item {0} has no quantity.',
    'receipt.err.conflict': 'Somebody else has just changed or cancelled this receipt. Close the form, reload the ledger and try again.',
```

Trong `src/lib/i18n/dictionary.ts`: đổi `'txn.form.saveMore': 'Lưu & thêm tiếp'` thành `'txn.form.saveMore': 'Lưu & thêm phiếu tiếp'`, và `'txn.form.saveMore': 'Save & add another'` thành `'txn.form.saveMore': 'Save & add another receipt'`.

- [ ] **Step 6: Viết test hỏng cho lời từ chối**

Tạo `tests/lib/receipt-errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { t, type MessageKey } from '@/lib/i18n'
import { blockedSentence, describeRefusal } from '@/components/gold/receiptErrors'

const say = (key: MessageKey) => t('vi', key)

describe('a refusal from the books, in the reader’s language', () => {
  it('names the item the payments never reached', () => {
    expect(describeRefusal('PAYMENT_SHORT: item 6 is left with no payment; …', say))
      .toBe(say('receipt.err.paymentShort').replace('{0}', '6'))
  })

  it('names the blocked item and says why', () => {
    expect(describeRefusal('LINE_BLOCKED: item 3 REFINING_SOURCE cannot be changed here', say))
      .toBe('Món 3: Phiếu mua này đã được đưa vào một lô phân kim')
    expect(describeRefusal('LINE_BLOCKED: item 2 SOMETHING_NEW cannot be changed here', say))
      .toBe('Món 2: Không sửa được dòng này ở đây')
  })

  it('translates every receipt-wide refusal', () => {
    expect(describeRefusal('RECEIPT_SINGLE: a deposit …', say)).toBe(say('receipt.err.single'))
    expect(describeRefusal('RECEIPT_SIZE: a receipt holds …', say)).toBe(say('receipt.err.size'))
    expect(describeRefusal('RECEIPT_DIRECTION: every item …', say)).toBe(say('receipt.err.direction'))
    expect(describeRefusal('RECEIPT_QTY: item 4 has no quantity', say)).toBe('Món 4 chưa có số lượng.')
    expect(describeRefusal('RECEIPT_VOIDED: this receipt …', say)).toBe(say('txn.blocked.VOIDED'))
    expect(describeRefusal('CONFLICT: somebody else changed …', say)).toBe(say('receipt.err.conflict'))
  })

  it('keeps the two refusals the single form already translated', () => {
    expect(describeRefusal('DEPOSIT is not a valid movement for Scrap Gold: no such flow rule', say))
      .toContain('quy tắc luồng vàng')
    expect(describeRefusal('transaction x produced no journal lines; it has no payments recorded', say))
      .toBe(say('txn.err.noPayments'))
  })

  it('passes anything else through as it came', () => {
    expect(describeRefusal('the period 2019-10 is closed', say)).toBe('the period 2019-10 is closed')
  })

  it('has no sentence for an item nothing blocks', () => {
    expect(blockedSentence(null, say)).toBeNull()
  })
})
```

Run: `npx vitest run tests/lib/receipt-errors.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/gold/receiptErrors"`.

- [ ] **Step 7: Viết `receiptErrors.ts`**

Tạo `src/components/gold/receiptErrors.ts`:

```ts
import type { MessageKey } from '@/lib/i18n'

type Translate = (key: MessageKey) => string

/**
 * Why an item cannot be corrected, in the reader's language.
 *
 * The database answers with a code (0071); a code nobody has written a sentence
 * for yet still reads as a refusal rather than as the code itself.
 */
export function blockedSentence(code: string | null, t: Translate): string | null {
  if (!code) return null
  const key = ('txn.blocked.' + code) as MessageKey
  const sentence = t(key)
  return sentence === key ? t('txn.blocked.OTHER') : sentence
}

/**
 * A refusal from the books, in words the accountant reads.
 *
 * Each refusal somebody can meet at the counter starts with a code (0074,
 * 0075), and the ones about one item carry its number. Anything without a code
 * passes through as it came rather than being guessed at.
 */
export function describeRefusal(message: string, t: Translate): string {
  const short = /PAYMENT_SHORT: item (\d+)/.exec(message)
  if (short) return t('receipt.err.paymentShort').replace('{0}', short[1])

  const blocked = /LINE_BLOCKED: item (\d+) ([A-Z_]+)/.exec(message)
  if (blocked) {
    return t('receipt.err.blocked')
      .replace('{0}', blocked[1])
      .replace('{1}', blockedSentence(blocked[2], t) ?? '')
  }

  const noQty = /RECEIPT_QTY: item (\d+)/.exec(message)
  if (noQty) return t('receipt.err.qty').replace('{0}', noQty[1])

  if (/RECEIPT_VOIDED/.test(message)) return t('txn.blocked.VOIDED')
  if (/RECEIPT_SINGLE/.test(message)) return t('receipt.err.single')
  if (/RECEIPT_SIZE/.test(message)) return t('receipt.err.size')
  if (/RECEIPT_DIRECTION/.test(message)) return t('receipt.err.direction')
  if (/CONFLICT/.test(message)) return t('receipt.err.conflict')
  if (/no journal lines|no payments recorded/.test(message)) return t('txn.err.noPayments')
  if (/is not a valid movement for .*no such flow rule/.test(message)) return t('txn.err.flowRule')
  return message
}
```

- [ ] **Step 8: Chạy test**

Run: `npx vitest run tests/lib/receipt-line.test.ts tests/lib/receipt-errors.test.ts tests/lib/i18n.test.ts tests/lib/txn-ledger-screen.test.tsx`
Expected: PASS (i18n: mọi khoá `vi` đều có `en`; màn sổ cũ vẫn chạy).
Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 9: Commit**

```bash
git add src/components/gold/types.ts src/components/gold/receiptLine.ts src/components/gold/receiptErrors.ts src/lib/i18n/ui-gold.ts src/lib/i18n/dictionary.ts tests/lib/receipt-line.test.ts tests/lib/receipt-errors.test.ts
git commit -m "feat(receipt): an item's figures follow one another, and refusals are said in words"
```

### Task 6: Đọc một dòng sổ, và ba lời gọi lưu/sửa/huỷ phiếu

**Files:**
- Modify: `src/components/gold/ledgerRow.ts` (thêm; `toLedgerRow` giữ đến Task 9)
- Modify: `src/app/(app)/gold-transactions/actions.ts` (thêm; hàm cũ giữ đến Task 9)
- Test: `tests/lib/receipt-row.test.ts`

**Interfaces:**
- Consumes: `ReceiptRow`, `ReceiptLine`, `TXN_TYPES` (`types.ts`); `MAX_RECEIPT_LINES`, `SINGLE_LINE_TYPES` (`receiptLine.ts`); RPC `save_gold_receipt`, `correct_gold_receipt`, `void_gold_receipt` (Task 2–3).
- Produces:
  - `toReceiptRow(r: Record<string, unknown>): ReceiptRow`;
  - `goldSummary(row: Pick<ReceiptRow, 'lines'>, goldName: (code: string) => string, t: (key: MessageKey) => string): string`;
  - `saveReceipt(input: unknown): Promise<SaveResult>` với input `{requestKey, txnDate, txnType, partnerCode, partnerPhone, salesPeople, remarks, payments, lines: LinePayload[]}`;
  - `correctReceipt(input: unknown): Promise<SaveResult>` với input trên cộng `{original, expectedRevision, reason, reversalDate?}`;
  - `voidReceipt(input: unknown): Promise<ReceiptVoidResult>` với input `{key, reason, onDate?}`, trả `{ok: true, lines: number} | {ok: false, message}`.
  - `SaveResult` giữ nguyên hình: `{ok: true, id, docNo, repeated, warning?} | {ok: false, message}`; `id` giờ là id phiếu.

- [ ] **Step 1: Viết test hỏng**

Tạo `tests/lib/receipt-row.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { t, type MessageKey } from '@/lib/i18n'
import { goldSummary, toReceiptRow } from '@/components/gold/ledgerRow'
import type { ReceiptLine } from '@/components/gold/types'

const say = (key: MessageKey) => t('vi', key)
const NAMES: Record<string, string> = { SG: 'Vàng vụn', GRAIN: 'Vàng Grain' }
const gold = (code: string) => NAMES[code] ?? code

const line = (over: Partial<ReceiptLine>): ReceiptLine => ({
  id: 'a', lineNo: 1, itemDesc: null, gold_type_code: 'SG', scrap_detail: null, gold_pct: null,
  uom: 'GRAM', qty: 1, unit_price: 1, amount: -1, blockedCode: null, ...over,
})

describe('a row of the receipt ledger', () => {
  it('reads figures that arrive as text as numbers, and names what is missing null', () => {
    const row = toReceiptRow({
      receipt_key: 'k1', receipt_id: null, txn_date: '2026-09-16', doc_no: 'PC49-2609-010',
      txn_type: 'PO', partner_code: 'Nguyen Van A', partner_phone: null, sales_person_code: 'L.Thanh',
      remarks: null, revision: '3', blocked_code: null, amount: '-2850.00', line_count: 2,
      lines: [
        { id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', goldTypeCode: 'SG', scrapDetail: '19-24k/grs',
          goldPct: '0.9870', uom: 'GRAM', qty: '9.4000', unitPrice: '101.06382979', amount: '-950.00',
          blockedCode: null },
        { id: 'b', lineNo: 2, itemDesc: null, goldTypeCode: 'GRAIN', scrapDetail: null, goldPct: null,
          uom: 'GRAM', qty: 15.6, unitPrice: 121.79487179, amount: -1900, blockedCode: 'REFINING_SOURCE' },
      ],
      payments: [{ seq: 1, amount: '950.00', method: 'CASH' }],
      sold_by: [{ code: 'L.Thanh', sharePct: '100' }],
    })
    expect(row).toMatchObject({ key: 'k1', receiptId: null, revision: 3, amount: -2850, blockedCode: null })
    expect(row.lines[0]).toEqual({
      id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG', scrap_detail: '19-24k/grs',
      gold_pct: 0.987, uom: 'GRAM', qty: 9.4, unit_price: 101.06382979, amount: -950, blockedCode: null,
    })
    expect(row.lines[1]).toMatchObject({ itemDesc: null, gold_pct: null, blockedCode: 'REFINING_SOURCE' })
    expect(row.payments).toEqual([{ seq: 1, amount: 950, method: 'CASH' }])
    expect(row.soldBy).toEqual([{ code: 'L.Thanh', sharePct: 100 }])
  })
})

describe('what a receipt is called in the gold column', () => {
  it('is the gold type for one item', () => {
    expect(goldSummary({ lines: [line({})] }, gold, say)).toBe('Vàng vụn')
  })

  it('counts the items when they are all the same gold', () => {
    expect(goldSummary({ lines: [line({}), line({ id: 'b' })] }, gold, say)).toBe('Vàng vụn · 2 món')
  })

  it('says several kinds when they differ', () => {
    expect(goldSummary({ lines: [line({}), line({ id: 'b', gold_type_code: 'GRAIN' })] }, gold, say))
      .toBe('Nhiều loại (2 món)')
  })
})
```

Run: `npx vitest run tests/lib/receipt-row.test.ts`
Expected: FAIL — `goldSummary is not exported` / `toReceiptRow is not a function`.

- [ ] **Step 2: Viết phần đọc**

Trong `src/components/gold/ledgerRow.ts`, đổi hai dòng import đầu thành:

```ts
import type { Uom } from '@/lib/domain/units'
import type { MessageKey } from '@/lib/i18n'
import type { LedgerRow, ReceiptLine, ReceiptRow } from './types'
```

Thêm vào cuối file:

```ts
/**
 * One row of pc49.gold_receipt_ledger (0076), as the screen and the export read it.
 *
 * The items arrive inside the row as JSON, where a figure may be a number or a
 * string depending on its column, so each goes through Number once, here.
 */
export function toReceiptRow(r: Record<string, unknown>): ReceiptRow {
  const lines = (r.lines ?? []) as Record<string, unknown>[]
  const payments = (r.payments ?? []) as { seq: unknown; amount: unknown; method: unknown }[]
  const soldBy = (r.sold_by ?? []) as { code: unknown; sharePct: unknown }[]
  return {
    key: String(r.receipt_key),
    receiptId: text(r.receipt_id),
    txn_date: String(r.txn_date),
    doc_no: text(r.doc_no),
    txn_type: String(r.txn_type),
    partner_code: text(r.partner_code),
    partner_phone: text(r.partner_phone),
    sales_person_code: text(r.sales_person_code),
    remarks: text(r.remarks),
    revision: Number(r.revision ?? 1),
    blockedCode: text(r.blocked_code),
    amount: Number(r.amount ?? 0),
    lines: lines.map(toReceiptLine),
    payments: payments.map((p) => ({ seq: Number(p.seq), amount: Number(p.amount), method: String(p.method) })),
    soldBy: soldBy.map((p) => ({ code: String(p.code), sharePct: Number(p.sharePct) })),
  }
}

function toReceiptLine(l: Record<string, unknown>): ReceiptLine {
  return {
    id: String(l.id),
    lineNo: Number(l.lineNo ?? 1),
    itemDesc: text(l.itemDesc),
    gold_type_code: String(l.goldTypeCode),
    scrap_detail: text(l.scrapDetail),
    gold_pct: figure(l.goldPct),
    uom: l.uom as Uom,
    qty: Number(l.qty),
    unit_price: figure(l.unitPrice),
    amount: Number(l.amount),
    blockedCode: text(l.blockedCode),
  }
}

/**
 * The gold column of a receipt: the gold type when every item is the same one
 * (with the count when there are several), "Nhiều loại (n món)" when they differ.
 */
export function goldSummary(
  row: Pick<ReceiptRow, 'lines'>,
  goldName: (code: string) => string,
  t: (key: MessageKey) => string,
): string {
  const n = row.lines.length
  if (n === 0) return '—'
  if (new Set(row.lines.map((l) => l.gold_type_code)).size > 1) {
    return t('receipt.mixed').replace('{0}', String(n))
  }
  const name = goldName(row.lines[0].gold_type_code)
  return n === 1 ? name : `${name} · ${t('receipt.count').replace('{0}', String(n))}`
}
```

Run: `npx vitest run tests/lib/receipt-row.test.ts`
Expected: PASS, 4 test.

- [ ] **Step 3: Thêm ba server action**

Trong `src/app/(app)/gold-transactions/actions.ts`, thêm dưới dòng `import { createServerSupabase } from '@/lib/supabase/server'`:

```ts
import { TXN_TYPES } from '@/components/gold/types'
import { MAX_RECEIPT_LINES, SINGLE_LINE_TYPES } from '@/components/gold/receiptLine'
```

Thêm vào cuối file:

```ts
/** One item of a receipt, signed and priced as it will be stored. */
const receiptLineSchema = z.object({
  itemDesc: z.string().trim().max(120).nullable().default(null),
  goldTypeCode: z.string().min(1),
  uom: z.enum(['GRAM', 'OZ', 'LUONG']),
  qty: z.number().refine((n) => n !== 0, 'quantity cannot be zero'),
  unitPrice: z.number().nullable(),
  amount: z.number(),
  scrapDetail: z.string().nullable(),
  goldPct: z.number().positive().max(1, 'purity is a fraction, so 0.583 rather than 58.3')
    .nullable().default(null),
})

const receiptFields = z.object({
  // Stable for the life of one receipt on screen, so a retry after a lost
  // answer is recognised as the same intention rather than a second receipt.
  requestKey: z.string().uuid(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  txnType: z.enum(TXN_TYPES),
  partnerCode: z.string().nullable(),
  partnerPhone: z.string().trim().max(40).nullable().default(null),
  salesPeople: z.array(salesShareSchema).max(10)
    .refine((list) => new Set(list.map((p) => p.code)).size === list.length,
      'the same person is on this order twice')
    .refine((list) => list.length === 0
      || Math.abs(list.reduce((sum, p) => sum + p.sharePct, 0) - 100) < 0.005,
      'the shares on an order must come to 100 percent'),
  remarks: z.string().nullable(),
  payments: z.array(paymentSchema).max(20),
  lines: z.array(receiptLineSchema).min(1).max(MAX_RECEIPT_LINES),
})

// Worded with the database's code, so the screen translates it the same way
// whichever of the two refused.
const ONE_ITEM = 'RECEIPT_SINGLE: a deposit or a pickup is one item'
const oneItemWhenTied = (r: { txnType: string; lines: unknown[] }) =>
  !SINGLE_LINE_TYPES.has(r.txnType) || r.lines.length === 1

const receiptSchema = receiptFields.refine(oneItemWhenTied, ONE_ITEM)
const receiptCorrectionSchema = receiptFields.extend({
  original: z.string().uuid(),
  expectedRevision: z.number().int(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
}).refine(oneItemWhenTied, ONE_ITEM)

type ReceiptInput = z.infer<typeof receiptFields>

/** What the database is sent: the receipt without its key and the customer's number. */
function receiptPayload(r: ReceiptInput) {
  return {
    txnDate: r.txnDate,
    txnType: r.txnType,
    partnerCode: r.partnerCode,
    remarks: r.remarks,
    salesPeople: r.salesPeople,
    payments: r.payments,
    lines: r.lines,
  }
}

/**
 * Files the customer and their number beside the receipt.
 *
 * Beside the money, not inside it: a telephone number that would not file is a
 * warning against a receipt that saved, never a failed save (05-09 handoff).
 */
async function fileCustomer(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  code: string | null, phone: string | null,
): Promise<string | undefined> {
  if (!code) return undefined
  const partner: { code: string; phone?: string } = { code }
  if (phone) partner.phone = phone
  const { error } = await supabase.from('partner').upsert(partner, { onConflict: 'code' })
  return error?.message
}

/**
 * Saves a receipt of one or more items and posts every item (0074).
 *
 * One call and one database transaction: the receipt, its items, the payments
 * divided between them and the postings are all written, or none is.
 */
export async function saveReceipt(input: unknown): Promise<SaveResult> {
  const parsed = receiptSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid receipt' }
  }
  const r = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('save_gold_receipt', {
    p_request_key: r.requestKey,
    p_payload: receiptPayload(r),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { receiptId: string; docNo: string | null; repeated: boolean }
  const warning = await fileCustomer(supabase, r.partnerCode, r.partnerPhone)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.receiptId, docNo: result.docNo, repeated: result.repeated, warning }
}

/**
 * Replaces a receipt, every item of it, with the corrected one (0075).
 *
 * `original` is the key the ledger listed: a receipt, or a transaction from
 * before receipts. Nothing is written until this is called, and the reversal
 * and the replacement happen together. The revision is the one the screen was
 * showing; if somebody has changed the receipt since, the answer is CONFLICT.
 */
export async function correctReceipt(input: unknown): Promise<SaveResult> {
  const parsed = receiptCorrectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid correction' }
  }
  const r = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('correct_gold_receipt', {
    p_request_key: r.requestKey,
    p_original: r.original,
    p_expected_revision: r.expectedRevision,
    p_reason: r.reason,
    p_reversal_date: r.reversalDate,
    p_payload: receiptPayload(r),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { receiptId: string; docNo: string | null; repeated: boolean }
  const warning = await fileCustomer(supabase, r.partnerCode, r.partnerPhone)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.receiptId, docNo: result.docNo, repeated: result.repeated, warning }
}

const receiptVoidSchema = z.object({
  key: z.string().uuid(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export type ReceiptVoidResult = { ok: true; lines: number } | { ok: false; message: string }

/**
 * Cancels a receipt, every item of it (0075).
 *
 * Each item is reversed by void_gold_txn exactly as a single transaction is:
 * the posting reversed rather than deleted, the stock given back as a movement.
 */
export async function voidReceipt(input: unknown): Promise<ReceiptVoidResult> {
  const parsed = receiptVoidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('void_gold_receipt', {
    p_original: parsed.data.key,
    p_reason: parsed.data.reason,
    p_on_date: parsed.data.onDate ?? null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/gold-transactions')
  return { ok: true, lines: Number(data ?? 0) }
}
```

- [ ] **Step 4: Kiểm tra**

Run: `npm run typecheck`
Expected: không lỗi.
Run: `npm run lint`
Expected: không lỗi mới.
Run: `npx vitest run tests/lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/gold/ledgerRow.ts "src/app/(app)/gold-transactions/actions.ts" tests/lib/receipt-row.test.ts
git commit -m "feat(receipt): read a receipt row, and save, correct or cancel a receipt from the screen"
```

### Task 7: Form nhập phiếu

**Files:**
- Create: `src/components/gold/ReceiptForm.tsx`
- Modify: `src/components/gold/Txn.module.css` (thêm ở cuối)

**Interfaces:**
- Consumes: `saveReceipt`, `correctReceipt`, `SaveResult` (Task 6); mọi hàm của `receiptLine.ts`, `describeRefusal` (Task 5); `ReceiptRow`, `GoldTypeOption` và các hằng trong `types.ts`.
- Produces: `ReceiptForm` với đúng props của `TxnForm` cũ, trừ `correcting: ReceiptRow | null`:
  `{ open, onClose, onSaved: (docNo: string | null, stayOpen: boolean) => void, txnDate, goldTypes, salesPeople, partners, correcting }`.
- Nhãn bắt buộc (script bấm theo tên): dialog `Giao dịch mới`/`Sửa giao dịch`; mỗi món là `role="group"` tên `Món N`; trong món: `Mô tả món`, `Loại vàng`, `Nhóm vàng vụn`, `Số lượng`, `Tuổi vàng (0–1)`, `Giá/gram tinh` hoặc `Đơn giá`, `Thành tiền`, nút `Bỏ món này`; nút `Thêm món`; phần thanh toán `section[aria-labelledby="txn-settle-heading"]`.

Không có unit test cho bước này: antd `Modal` vẽ vào portal, `renderToStaticMarkup` không thấy gì. Form được kiểm tra trên trình duyệt ở Task 10 (`verify:receipt`, `verify:grid`, `verify:payments`, `verify:void`, `verify:correct`).

- [ ] **Step 1: Thêm CSS**

Thêm vào cuối `src/components/gold/Txn.module.css`:

```css
/* One item of a receipt: a box of its own inside the items section. */
.line {
  padding: 10px 12px 0;
  border: 1px solid var(--pc-border-default);
  border-radius: 8px;
  background: var(--pc-surface-muted);
}

.line + .line {
  margin-top: 10px;
}

.lineHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.lineNo {
  color: var(--pc-text-heading);
  font-size: 13px;
  font-weight: 650;
}

.fine {
  display: block;
  padding: 4px 0;
  color: var(--pc-text-secondary);
  font-variant-numeric: tabular-nums;
}

.addLine {
  margin: 10px 0 12px;
}

.gap {
  margin-top: 12px;
}

/* The items of a receipt, opened beneath its row in the ledger. */
.lines {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.lines th,
.lines td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--pc-border-default);
  text-align: left;
}

.lines th {
  color: var(--pc-text-secondary);
  font-weight: 600;
}

.lines .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 2: Viết form**

Tạo `src/components/gold/ReceiptForm.tsx`:

```tsx
'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, AutoComplete, Button, Col, Form, Input, InputNumber, Modal,
  Row, Select, Typography,
} from 'antd'
import { Check, ListPlus, Plus, Trash2, X } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { toGrams, type Uom } from '@/lib/domain/units'
import {
  correctReceipt, saveReceipt, type SaveResult,
} from '@/app/(app)/gold-transactions/actions'
import {
  MAX_PAYMENTS, MAX_SALES_ON_ORDER, PAYMENT_METHODS, SALES_SPLIT,
  SCRAP_BANDS, SCRAP_TYPES, TXN_TYPES,
  type GoldTypeOption, type ReceiptRow,
} from './types'
import {
  MAX_RECEIPT_LINES, SINGLE_LINE_TYPES, fineGrams, lineFromSaved, linePayload,
  paymentGap, pricedByFine, receiptTotal, relate,
  type LineField, type Typed,
} from './receiptLine'
import { describeRefusal } from './receiptErrors'
import { normalizeTransactionSearch } from './transactionFilters'
import styles from './Txn.module.css'

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const fineFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 4,
})

type PaymentField = { amount: number | null; method: string | null }

type Values = {
  /** The day the receipt belongs to. */
  txnDate: string
  txnType: string
  partnerCode: string
  partnerPhone: string
  remarks: string
  /** In order: the first name is the lead and takes the larger share. */
  salesPeople: string[]
  /** The items, in the order they are written on the paper. */
  lines: LineField[]
  payments: PaymentField[]
  reason: string
}

const EMPTY_LINE: LineField = {
  itemDesc: '', goldTypeCode: '', scrapDetail: null, qty: null, goldPct: null,
  finePrice: null, unitPrice: null, total: null,
}

/** The figures of an item that follow one another when one is typed. */
const FIGURES: Typed[] = ['qty', 'goldPct', 'finePrice', 'unitPrice', 'total']

/** The types the books will not post without a payment (post_gold_txn, 0015). */
const NEEDS_PAYMENT = new Set(['PO', 'PO_VENDOR', 'DEPOSIT'])

/** The shares an order divides into, by how many people are on it (B6). */
function sharesFor(people: string[]): { code: string; sharePct: number }[] {
  const split = SALES_SPLIT[people.length] ?? []
  return people.map((code, i) => ({ code, sharePct: split[i] ?? 0 }))
}

const asNumber = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value)

/**
 * One receipt, entered as it is written: a customer, how it was paid, and the
 * items on it (spec 2026-09-17). It replaces the one-gold-type form, which made
 * a customer selling six pieces into six transactions typed six times.
 *
 * Shaped by the accountant's answers of 10/09, which still hold per item:
 *
 *   B2  the document number is minted by the database, once per receipt
 *   B3  the paper sometimes carries the amount and sometimes the price, so
 *       either may be typed and the other follows; for gold weighed in grams
 *       with a purity, the price is per fine gram, as on the paper
 *   B5  scrap has exactly two bags, chosen not typed
 *   B6  up to three people on an order, shares fixed by count and position
 *   B12 correcting is one click: the reason is filled in and may be left
 *
 * Correcting reuses this form with every item of the receipt. Nothing is
 * written when it opens: the original stays posted until this is saved, and
 * the reversal and the replacement happen in one database transaction.
 */
export function ReceiptForm({
  open, onClose, onSaved, txnDate, goldTypes, salesPeople, partners, correcting,
}: {
  open: boolean
  onClose: () => void
  /** Called with the number the receipt was given, and whether the form stays open. */
  onSaved: (docNo: string | null, stayOpen: boolean) => void
  txnDate: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
  /** The receipt being replaced, or null when this is a fresh one. */
  correcting: ReceiptRow | null
}) {
  const { locale, t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState(false)
  /**
   * Whether anything has been typed since the form opened or last saved: a
   * form that threw its input away on Esc is somebody believing they entered a
   * receipt that never reached the books.
   */
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  function requestClose() {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  // Reloading or closing the tab loses the same input.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // A refusal is shown at the top of the form and brought into view.
  useEffect(() => {
    if (error) topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  /**
   * Stable for the life of one receipt on this form, so pressing Save twice, or
   * trying again after an answer went missing, is the same receipt rather than
   * a second one. Renewed only once a save has succeeded.
   */
  const requestKey = useRef<string>(crypto.randomUUID())

  const goldName = (g: GoldTypeOption) => (locale === 'vi' ? g.name_vi : g.name_en)
  const uomOf = (code: string): Uom | '' =>
    goldTypes.find((g) => g.code === code)?.native_uom ?? ''
  const phoneOf = (code: string) =>
    partners.find((p) => p.code === code.trim())?.phone ?? ''
  const itemLabel = (n: number) => t('receipt.item').replace('{0}', String(n))

  const initial: Values = useMemo(() => (correcting
    ? {
        txnDate,
        txnType: correcting.txn_type,
        partnerCode: correcting.partner_code ?? '',
        partnerPhone: correcting.partner_phone ?? phoneOf(correcting.partner_code ?? ''),
        remarks: correcting.remarks ?? '',
        salesPeople: correcting.soldBy.map((p) => p.code),
        lines: correcting.lines.map((l) => lineFromSaved(correcting.txn_type, l)),
        payments: correcting.payments.length
          ? correcting.payments.map((p) => ({ amount: p.amount, method: p.method }))
          : [{ amount: null, method: 'CASH' }],
        // Filled in so correcting is one click (B12). Still editable.
        reason: t('txn.correctReason'),
      }
    : {
        txnDate,
        txnType: 'PO',
        partnerCode: '',
        partnerPhone: '',
        remarks: '',
        salesPeople: [],
        lines: [{ ...EMPTY_LINE }],
        payments: [{ amount: null, method: 'CASH' }],
        reason: '',
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [correcting])

  const txnType = (Form.useWatch('txnType', form) ?? initial.txnType) as string
  const lines = (Form.useWatch('lines', form) ?? []) as (LineField | undefined)[]
  const payments = (Form.useWatch('payments', form) ?? []) as (PaymentField | undefined)[]
  const people = (Form.useWatch('salesPeople', form) ?? []) as string[]
  const shares = sharesFor(people)
  const single = SINGLE_LINE_TYPES.has(txnType)
  const total = receiptTotal(lines)
  const gap = paymentGap(total, payments)
  const grams = lines.reduce((sum, l) => {
    const uom = uomOf(l?.goldTypeCode ?? '')
    return uom && l?.qty ? sum + toGrams(Math.abs(Number(l.qty)), uom) : sum
  }, 0)

  /**
   * One figure of item `index` typed: the others follow (B3). Only the figures
   * that follow are written back; the one being typed is left alone, so the
   * cursor stays where it is.
   */
  function typedOn(index: number, typed: Typed, value: number | string | null) {
    const line = {
      ...(form.getFieldValue(['lines', index]) as LineField),
      [typed]: asNumber(value),
    }
    const next = relate(uomOf(line.goldTypeCode), line, typed)
    for (const key of FIGURES) {
      if (key !== typed && next[key] !== line[key]) {
        form.setFieldValue(['lines', index, key], next[key])
      }
    }
  }

  /** A gold type chosen: the unit may have changed, and with it how the item is priced. */
  function goldTyped(index: number, code: string) {
    if (uomOf(code) !== 'GRAM') form.setFieldValue(['lines', index, 'goldPct'], null)
    const line = form.getFieldValue(['lines', index]) as LineField
    typedOn(index, 'qty', line.qty)
  }

  async function submit(stayOpen: boolean) {
    setError(null)
    setWarning(null)
    setLastSaved(null)
    try {
      await form.validateFields()
    } catch {
      // The fields already say what is wrong; scrollToFirstError brings the
      // first of them into view.
      setValidationError(true)
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    // The whole store, not only the fields on screen: an item priced per fine
    // gram keeps its unit price with no field drawn for it.
    const v = form.getFieldsValue(true) as Values

    const body = {
      requestKey: requestKey.current,
      txnDate: v.txnDate,
      txnType: v.txnType,
      partnerCode: v.partnerCode?.trim() || null,
      partnerPhone: v.partnerPhone?.trim() || null,
      salesPeople: sharesFor(v.salesPeople ?? []),
      remarks: v.remarks?.trim() || null,
      payments: (v.payments ?? [])
        .map((p) => ({ amount: Number(p?.amount ?? 0), method: String(p?.method ?? '') }))
        .filter((p) => p.amount > 0 && p.method),
      lines: (v.lines ?? []).map((l) => linePayload(v.txnType, uomOf(l.goldTypeCode) as Uom, l)),
    }

    setSaving(true)
    // Settled rather than awaited bare: a page older than the server, or a lost
    // connection, must stop the spinner and say so (16-09).
    const result = await settleAction((): Promise<SaveResult> => (correcting
      ? correctReceipt({
          ...body,
          original: correcting.key,
          expectedRevision: correcting.revision,
          reason: v.reason,
        })
      : saveReceipt(body)))
    setSaving(false)

    if (!result.ok) {
      setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    // The money is on the books; filing the customer beside it may not be.
    if (result.warning) setWarning(result.warning)

    if (stayOpen && !correcting) {
      // The next receipt: the same day, everything else fresh, and a fresh key
      // so it cannot be mistaken for a retry of this one.
      requestKey.current = crypto.randomUUID()
      form.resetFields()
      form.setFieldValue('txnDate', v.txnDate)
      setDirty(false)
      setLastSaved(result.docNo)
      onSaved(result.docNo, true)
      return
    }
    setDirty(false)
    onSaved(result.docNo, false)
  }

  return (
    <Modal
      open={open}
      width={1040}
      title={t(correcting ? 'txn.form.correctTitle' : 'txn.form.newTitle')}
      onCancel={requestClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" icon={<X size={16} aria-hidden />} onClick={requestClose}>
          {t('txn.form.close')}
        </Button>,
        !correcting && (
          <Button key="more" icon={<ListPlus size={16} aria-hidden />} loading={saving}
                  onClick={() => submit(true)}>
            {t('txn.form.saveMore')}
          </Button>
        ),
        <Button key="save" type="primary" icon={<Check size={16} aria-hidden />} loading={saving}
                onClick={() => submit(false)}>
          {t('txn.save')}
        </Button>,
      ]}
    >
      <Form<Values> form={form} layout="vertical" initialValues={initial}
                    className={styles.form} scrollToFirstError
                    onValuesChange={() => { setDirty(true); setValidationError(false) }}>
        <div ref={topRef} />
        {validationError && (
          <Alert type="error" showIcon role="alert" title={t('txn.form.checkFields')} />
        )}
        {error && (
          <Alert type="error" showIcon title={t('txn.rowError')} description={error}
                 style={{ marginBottom: 12 }} />
        )}
        {warning && (
          <Alert type="warning" showIcon title={t('txn.savedWithWarning')} description={warning}
                 style={{ marginBottom: 12 }} />
        )}
        {lastSaved && (
          <Alert type="success" showIcon style={{ marginBottom: 12 }}
                 title={`${t('txn.form.savedAs')} ${lastSaved}`} />
        )}

        {correcting && (
          <section className={styles.section} aria-labelledby="txn-correction-heading">
            <h3 id="txn-correction-heading" className={styles.sectionHeading}>
              {t('txn.form.correction')}
            </h3>
            <Form.Item
              name="reason"
              label={t('txn.form.reason')}
              extra={t('txn.form.reasonHint')}
              rules={[{ required: true, min: 3, message: t('txn.form.required') }]}
            >
              <Input />
            </Form.Item>
          </section>
        )}

        <section className={styles.section} aria-labelledby="txn-details-heading">
          <h3 id="txn-details-heading" className={styles.sectionHeading}>
            {t('txn.form.details')}
          </h3>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              {/* A correction keeps the day of the receipt it replaces. */}
              <Form.Item name="txnDate" label={t('txn.date')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <Input type="date" disabled={Boolean(correcting)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="txnType" label={t('txn.col.type')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <Select options={TXN_TYPES.map((v) => ({ value: v, label: v }))} />
              </Form.Item>
            </Col>
          </Row>
        </section>

        <section className={styles.section} aria-labelledby="txn-who-heading">
          <h3 id="txn-who-heading" className={styles.sectionHeading}>{t('txn.form.who')}</h3>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="partnerCode" label={t('txn.col.partner')}>
                <AutoComplete
                  options={partners.map((p) => ({ value: p.code }))}
                  filterOption={(input, option) =>
                    normalizeTransactionSearch(option?.value)
                      .includes(normalizeTransactionSearch(input))}
                  onChange={(value) => {
                    // Naming a customer we know brings their number up.
                    const phone = phoneOf(String(value ?? ''))
                    if (phone) form.setFieldValue('partnerPhone', phone)
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="partnerPhone" label={t('txn.col.phone')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="salesPeople" label={t('txn.col.sales')} extra={t('txn.form.split')}>
            <Select
              mode="multiple"
              maxCount={MAX_SALES_ON_ORDER}
              options={salesPeople.map((c) => ({ value: c, label: c }))}
            />
          </Form.Item>
          {shares.length > 1 && (
            <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>
              {shares.map((s) => `${s.code} ${s.sharePct}%`).join(' · ')}
            </Typography.Paragraph>
          )}
        </section>

        <section className={styles.section} aria-labelledby="txn-lines-heading">
          <h3 id="txn-lines-heading" className={styles.sectionHeading}>{t('receipt.lines')}</h3>
          <span className={styles.sectionDescription}>
            {t('receipt.linesHint')} {t('receipt.signHint')}
          </span>
          <Form.List
            name="lines"
            rules={[{
              validator: async (_, list: LineField[] | undefined) => {
                const n = (list ?? []).length
                if (n < 1 || n > MAX_RECEIPT_LINES) throw new Error(t('receipt.err.size'))
                if (SINGLE_LINE_TYPES.has(form.getFieldValue('txnType')) && n > 1) {
                  throw new Error(t('receipt.err.single'))
                }
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field, index) => {
                  const line = lines[index]
                  const code = line?.goldTypeCode ?? ''
                  const uom = uomOf(code)
                  const byFine = pricedByFine(uom, line?.goldPct)
                  const fine = fineGrams(uom, line?.qty, line?.goldPct)
                  return (
                    <div key={field.key} className={styles.line} role="group"
                         aria-label={itemLabel(index + 1)}>
                      <div className={styles.lineHead}>
                        <span className={styles.lineNo}>{itemLabel(index + 1)}</span>
                        <Button type="text" danger size="small"
                                icon={<Trash2 size={16} aria-hidden />}
                                aria-label={t('receipt.removeItem')}
                                disabled={fields.length === 1}
                                onClick={() => remove(field.name)} />
                      </div>
                      <Row gutter={12}>
                        <Col xs={24} sm={10}>
                          <Form.Item name={[field.name, 'itemDesc']} label={t('receipt.itemDesc')}>
                            <Input maxLength={120} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={7}>
                          <Form.Item name={[field.name, 'goldTypeCode']} label={t('txn.col.gold')}
                                     rules={[{ required: true, message: t('txn.form.required') }]}>
                            <Select
                              showSearch
                              optionFilterProp="label"
                              options={goldTypes.map((g) => ({ value: g.code, label: goldName(g) }))}
                              onChange={(value: string) => goldTyped(index, value)}
                            />
                          </Form.Item>
                        </Col>
                        {/* The bag is a choice of two, only for scrap (B5). */}
                        {SCRAP_TYPES.has(code) && (
                          <Col xs={24} sm={7}>
                            <Form.Item name={[field.name, 'scrapDetail']} label={t('txn.form.band')}
                                       preserve={false}>
                              <Select allowClear
                                      options={SCRAP_BANDS.map((b) => ({ value: b, label: b }))} />
                            </Form.Item>
                          </Col>
                        )}
                      </Row>
                      <Row gutter={12}>
                        <Col xs={12} sm={5}>
                          <Form.Item
                            name={[field.name, 'qty']}
                            label={t('txn.col.qty')}
                            rules={[
                              { required: true, message: t('txn.form.required') },
                              {
                                validator: (_, value) => (Number(value) === 0
                                  ? Promise.reject(new Error(t('txn.form.qtyZero')))
                                  : Promise.resolve()),
                              },
                            ]}
                          >
                            <InputNumber style={{ width: '100%' }} step={0.01} controls={false}
                                         suffix={uom || undefined}
                                         onChange={(value) => typedOn(index, 'qty', value)} />
                          </Form.Item>
                        </Col>
                        {uom === 'GRAM' && (
                          <>
                            <Col xs={12} sm={4}>
                              <Form.Item
                                name={[field.name, 'goldPct']}
                                label={t('txn.col.purity')}
                                rules={[{ type: 'number', min: 0, max: 1, message: t('txn.col.purity') }]}
                              >
                                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.001}
                                             controls={false}
                                             onChange={(value) => typedOn(index, 'goldPct', value)} />
                              </Form.Item>
                            </Col>
                            <Col xs={12} sm={4}>
                              <Form.Item label={t('receipt.fine')}>
                                <output className={styles.fine} aria-live="polite">
                                  {fine === null ? '—' : fineFormat.format(fine)}
                                </output>
                              </Form.Item>
                            </Col>
                          </>
                        )}
                        <Col xs={12} sm={uom === 'GRAM' ? 5 : 9}>
                          {byFine ? (
                            <Form.Item name={[field.name, 'finePrice']} label={t('receipt.finePrice')}>
                              <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false}
                                           onChange={(value) => typedOn(index, 'finePrice', value)} />
                            </Form.Item>
                          ) : (
                            <Form.Item name={[field.name, 'unitPrice']} label={t('txn.col.price')}>
                              <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false}
                                           onChange={(value) => typedOn(index, 'unitPrice', value)} />
                            </Form.Item>
                          )}
                        </Col>
                        <Col xs={12} sm={uom === 'GRAM' ? 6 : 10}>
                          <Form.Item name={[field.name, 'total']} label={t('txn.col.amount')}>
                            <InputNumber style={{ width: '100%' }} min={0} step={1} controls={false}
                                         onChange={(value) => typedOn(index, 'total', value)} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  )
                })}
                <Form.ErrorList errors={errors} />
                {/* A deposit and a pickup are one item each (0074). */}
                {!single && fields.length < MAX_RECEIPT_LINES && (
                  <Button type="dashed" block className={styles.addLine}
                          icon={<Plus size={16} aria-hidden />}
                          onClick={() => add({ ...EMPTY_LINE })}>
                    {t('receipt.addItem')}
                  </Button>
                )}
              </>
            )}
          </Form.List>

          <div className={styles.calculatedAmount} aria-live="polite">
            <span>{t('receipt.weight')}: {fineFormat.format(grams)} g</span>
            <strong>{t('receipt.total')}: {money.format(total)}</strong>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="txn-settle-heading">
          <h3 id="txn-settle-heading" className={styles.sectionHeading}>{t('txn.form.settle')}</h3>
          <Form.List
            name="payments"
            rules={[{
              // The books refuse a purchase or a deposit with no payment on it.
              validator: async (_, list: PaymentField[] | undefined) => {
                if (!NEEDS_PAYMENT.has(form.getFieldValue('txnType'))) return
                const complete = (list ?? []).some((p) => Number(p?.amount ?? 0) > 0 && p?.method)
                if (!complete) throw new Error(t('txn.form.paymentRequired'))
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={12} key={field.key} align="middle" className={styles.paymentRow}>
                    <Col xs={24} sm={10}>
                      <Form.Item name={[field.name, 'amount']} label={t('txn.form.payAmount')}>
                        <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
                      </Form.Item>
                    </Col>
                    <Col xs={16} sm={10}>
                      <Form.Item
                        name={[field.name, 'method']}
                        label={t('txn.col.method')}
                        dependencies={[['payments', field.name, 'amount']]}
                        rules={[({ getFieldValue }) => ({
                          // An amount with no method used to be dropped on save.
                          validator: (_, method) => (
                            Number(getFieldValue(['payments', field.name, 'amount']) ?? 0) > 0 && !method
                              ? Promise.reject(new Error(t('txn.form.methodMissing')))
                              : Promise.resolve()),
                        })]}
                      >
                        <Select allowClear
                                options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
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
                <Form.ErrorList errors={errors} />
                {fields.length < MAX_PAYMENTS && (
                  <Button type="dashed" block icon={<Plus size={16} aria-hidden />}
                          onClick={() => add({ amount: null, method: null })}>
                    {t('txn.form.addPayment')}
                  </Button>
                )}
              </>
            )}
          </Form.List>

          {/* Said while typing, not refused: a purchase paid over or under is
              recorded as it happened (spec 2026-09-17). */}
          {total > 0 && Math.abs(gap) >= 0.005 && (
            <Alert type="warning" showIcon role="status" className={styles.gap}
                   title={gap > 0
                     ? t('receipt.gap.over').replace('{0}', money.format(gap))
                     : t('receipt.gap.under').replace('{0}', money.format(-gap))} />
          )}

          <Form.Item name="remarks" label={t('txn.col.remarks')} style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </section>
      </Form>

      <Modal
        open={confirmClose}
        title={t('txn.form.unsavedTitle')}
        okText={t('txn.form.discard')}
        okButtonProps={{ danger: true }}
        cancelText={t('txn.form.keepEditing')}
        onOk={() => { setConfirmClose(false); setDirty(false); onClose() }}
        onCancel={() => setConfirmClose(false)}
      >
        {t('txn.form.unsavedBody')}
      </Modal>
    </Modal>
  )
}
```

- [ ] **Step 3: Kiểm tra**

Run: `npm run typecheck`
Expected: không lỗi. (Nếu `suffix` trên `InputNumber` báo lỗi kiểu, xem `node_modules/antd/es/input-number/index.d.ts` và dùng đúng prop antd 6 đưa ra cho hậu tố.)
Run: `npm run lint`
Expected: không lỗi mới.

- [ ] **Step 4: Commit**

```bash
git add src/components/gold/ReceiptForm.tsx src/components/gold/Txn.module.css
git commit -m "feat(receipt): a form that takes every item on the paper receipt"
```

### Task 8: Sổ giao dịch theo phiếu

**Files:**
- Create: `src/components/gold/ReceiptLines.tsx`
- Modify: `src/components/gold/TxnScreen.tsx` (thay toàn bộ)
- Modify: `src/app/(app)/gold-transactions/page.tsx` (thay toàn bộ)
- Delete: `src/components/gold/TxnForm.tsx`
- Test: `tests/lib/txn-ledger-screen.test.tsx`

**Interfaces:**
- Consumes: `ReceiptForm` (Task 7); `voidReceipt` (Task 6); `toReceiptRow`, `goldSummary` (Task 6); `blockedSentence`, `describeRefusal` (Task 5); `fineGrams` (Task 5); RPC `gold_receipt_ledger`, `gold_receipt_ledger_totals` (Task 4).
- Produces: `TxnScreen` nhận `rows: ReceiptRow[]` (props khác giữ nguyên); `ReceiptLines({ row, goldName })`; `TxnScreen.tsx` export lại `type { GoldTypeOption, ReceiptRow }`.

- [ ] **Step 1: Sửa test màn sổ cho hỏng**

Trong `tests/lib/txn-ledger-screen.test.tsx`:

Đổi `import type { LedgerRow } from '@/components/gold/types'` thành `import type { ReceiptRow } from '@/components/gold/types'`; trong `base` đổi `rows: [] as LedgerRow[],` thành `rows: [] as ReceiptRow[],`.

Thay khối `const sale: LedgerRow = { ... }` bằng:

```tsx
const sale: ReceiptRow = {
  key: '1', receiptId: null, txn_date: '2026-01-08', doc_no: 'PC49-2601-028', txn_type: 'SALE',
  partner_code: 'Thuc Trinh', partner_phone: null, sales_person_code: 'T.Quỳnh', remarks: null,
  revision: 1, blockedCode: null, amount: 5425,
  lines: [{
    id: '1', lineNo: 1, itemDesc: null, gold_type_code: 'RP', scrap_detail: null, gold_pct: null,
    uom: 'LUONG', qty: -1, unit_price: 5425, amount: 5425, blockedCode: null,
  }],
  payments: [{ seq: 1, amount: 5425, method: 'CASH' }],
  soldBy: [{ code: 'T.Quỳnh', sharePct: 100 }],
}
```

Trong test `'says in the reader’s language why a row cannot be corrected'`, đổi `{ ...sale, id: '2', doc_no: 'PC49-2601-029', blockedCode: 'CONVERSION_LEG' }` thành `{ ...sale, key: '2', doc_no: 'PC49-2601-029', blockedCode: 'CONVERSION_LEG' }`.

Thêm test cuối khối `describe`:

```tsx
  it('lists a receipt of several items as one row, named for what is on it', () => {
    const receipt: ReceiptRow = {
      ...sale, key: '3', receiptId: '3', doc_no: 'PC49-2609-010', txn_type: 'PO', amount: -2850,
      lines: [
        { ...sale.lines[0], id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG',
          uom: 'GRAM', qty: 9.4, gold_pct: 0.987, unit_price: 101.06382979, amount: -950 },
        { ...sale.lines[0], id: 'b', lineNo: 2, itemDesc: 'Thỏi RCM', gold_type_code: 'GRAIN',
          uom: 'GRAM', qty: 15.6, gold_pct: 0.998, unit_price: 121.79487179, amount: -1900 },
      ],
    }
    const html = text(<TxnScreen {...base} rows={[receipt]}
      totals={{ count: 1, purchases: 2850, sales: 0, grams: {} }} />)
    expect(html).toContain('PC49-2609-010')
    expect(html).toContain('Nhiều loại (2 món)')
    expect(html).toContain('25.00 g')
    expect(html).toContain('-2,850.00')
    expect(html).toContain('Số phiếu')
  })
```

Run: `npx vitest run tests/lib/txn-ledger-screen.test.tsx`
Expected: FAIL — lỗi kiểu/giá trị vì `TxnScreen` còn đọc `LedgerRow` (`Nhiều loại (2 món)` không có).

- [ ] **Step 2: Bảng món mở rộng**

Tạo `src/components/gold/ReceiptLines.tsx`:

```tsx
'use client'

import { useLocale } from '@/lib/i18n/provider'
import { money, weight } from '@/components/ledger/Ledger'
import { fineGrams } from './receiptLine'
import type { ReceiptRow } from './types'
import styles from './Txn.module.css'

const fineFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 4,
})

/** The items of one receipt, as they were written on the paper. */
export function ReceiptLines({ row, goldName }: {
  row: ReceiptRow
  goldName: (code: string) => string
}) {
  const { t } = useLocale()
  return (
    <table className={styles.lines}>
      <thead>
        <tr>
          <th className={styles.num}>#</th>
          <th>{t('receipt.itemDesc')}</th>
          <th>{t('txn.col.gold')}</th>
          <th className={styles.num}>{t('txn.col.qty')}</th>
          <th className={styles.num}>{t('txn.col.scrap')}</th>
          <th className={styles.num}>{t('receipt.fine')}</th>
          <th className={styles.num}>{t('receipt.finePrice')}</th>
          <th className={styles.num}>{t('txn.col.price')}</th>
          <th className={styles.num}>{t('txn.col.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {row.lines.map((l) => {
          const fine = fineGrams(l.uom, l.qty, l.gold_pct)
          return (
            <tr key={l.id}>
              <td className={styles.num}>{l.lineNo}</td>
              <td>{l.itemDesc ?? '—'}</td>
              <td>{goldName(l.gold_type_code)}{l.scrap_detail ? ` · ${l.scrap_detail}` : ''}</td>
              <td className={styles.num}>{weight.format(l.qty)} {l.uom}</td>
              <td className={styles.num}>{l.gold_pct ?? '—'}</td>
              <td className={styles.num}>{fine === null ? '—' : fineFormat.format(fine)}</td>
              <td className={styles.num}>{fine ? money.format(Math.abs(l.amount) / fine) : '—'}</td>
              <td className={styles.num}>{l.unit_price === null ? '—' : money.format(l.unit_price)}</td>
              <td className={styles.num}>{money.format(l.amount)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Màn sổ đọc phiếu**

Thay toàn bộ `src/components/gold/TxnScreen.tsx` bằng:

```tsx
'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import { Ban, Download, Pencil, Plus } from 'lucide-react'
import { IconAction } from '@/components/ui/IconAction'
import { TxnTypeTag } from './TxnTypeTag'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { toGrams } from '@/lib/domain/units'
import { voidReceipt } from '@/app/(app)/gold-transactions/actions'
import { Page, Stat, Stats, LoadFailed, money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { ReceiptForm } from './ReceiptForm'
import { ReceiptLines } from './ReceiptLines'
import { goldSummary } from './ledgerRow'
import { blockedSentence, describeRefusal } from './receiptErrors'
import { PAYMENT_METHODS, type GoldTypeOption, type ReceiptRow } from './types'
import {
  DEFAULT_PAGE_SIZE, LEDGER_TXN_TYPES, PAGE_SIZES, ledgerSearch, presetRange, singleDay,
  type LedgerQuery, type Preset,
} from './ledgerQuery'
import styles from './Txn.module.css'

export type { GoldTypeOption, ReceiptRow } from './types'

/** What the whole filter matched, not the page on screen (0076). */
export type LedgerTotals = {
  /** Receipts, not items. */
  count: number
  purchases: number
  sales: number
  grams: Record<string, number>
}

const PRESETS: Preset[] = ['today', 'last7', 'thisMonth', 'lastMonth', 'thisYear', 'all']

/** Money going out of the till reads differently from money coming in. */
function Money({ value }: { value: number }) {
  const tone = value === 0 ? undefined : value > 0 ? 'pc-in' : 'pc-out'
  return <span className={tone}>{money.format(value)}</span>
}

/**
 * The gold ledger: every receipt, newest first, filtered as asked.
 *
 * One row per receipt, as the paper has one number, one customer and one
 * payment; its items open beneath it. A transaction from before receipts is a
 * receipt of one item and reads exactly as it did. The filter lives in the
 * address and is applied by the database (0076), so the file behind
 * "Xuất Excel" holds exactly what the filter means.
 */
export function TxnScreen({
  query, today, goldTypes, salesPeople, partners, rows, totals, loadFailed = false,
}: {
  query: LedgerQuery
  /** The server's date, so the quick ranges agree between server and browser. */
  today: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
  rows: ReceiptRow[]
  totals: LedgerTotals
  /**
   * The ledger, its totals, or the gold types did not arrive. Nothing to type
   * into is offered then: an empty list invites somebody to enter the day again.
   */
  loadFailed?: boolean
}) {
  const { locale, t } = useLocale()
  const router = useRouter()

  /** Open with no receipt for a fresh one, with a receipt to replace it. */
  const [editing, setEditing] = useState<{ correcting: ReceiptRow | null } | null>(null)
  const [voidRow, setVoidRow] = useState<ReceiptRow | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // The search box keeps what is being typed; the address keeps what was
  // searched. A search cleared from elsewhere (Xoá bộ lọc) clears the box too.
  const [search, setSearch] = useState(query.q)
  const [searched, setSearched] = useState(query.q)
  if (query.q !== searched) {
    setSearched(query.q)
    if (query.q !== search.trim()) setSearch(query.q)
  }

  const go = (patch: Partial<LedgerQuery>) =>
    router.push(`/gold-transactions${ledgerSearch(query, patch)}`)

  // Searched once typing stops, not on every key.
  useEffect(() => {
    const q = search.trim()
    if (q === query.q) return
    const timer = setTimeout(
      () => router.push(`/gold-transactions${ledgerSearch(query, { q })}`), 400)
    return () => clearTimeout(timer)
  }, [search, query, router])

  const goldName = (code: string) => {
    const g = goldTypes.find((x) => x.code === code)
    return g ? (locale === 'vi' ? g.name_vi : g.name_en) : code
  }

  const hasFilters = Boolean(
    query.from || query.to || query.type || query.gold || query.staff
      || query.method || query.status || query.q,
  )
  const clearFilters = () => router.push('/gold-transactions')
  const activePreset = PRESETS.find((p) => {
    const range = presetRange(p, today)
    return range.from === query.from && range.to === query.to
  })

  /**
   * Which days are being looked at. Native date inputs, because these are the
   * controls that have to keep working on the screen that says a read failed.
   */
  const dateFilters = (
    <div className={styles.dateRange} role="group" aria-label={t('txn.date')}>
      <label className="pc-date-field">
        <span className="pc-date-label">{t('txn.filter.from')}</span>
        <input
          type="date"
          className="pc-date-input"
          value={query.from ?? ''}
          max={query.to ?? undefined}
          aria-label={t('txn.filter.from')}
          onChange={(e) => go({ from: e.target.value || null })}
        />
      </label>
      <label className="pc-date-field">
        <span className="pc-date-label">{t('txn.filter.to')}</span>
        <input
          type="date"
          className="pc-date-input"
          value={query.to ?? ''}
          min={query.from ?? undefined}
          aria-label={t('txn.filter.to')}
          onChange={(e) => go({ to: e.target.value || null })}
        />
      </label>
      <Space size={4} wrap>
        {PRESETS.map((p) => (
          <Button key={p} size="small" type={activePreset === p ? 'primary' : 'default'}
                  onClick={() => go(presetRange(p, today))}>
            {t(`txn.preset.${p}` as const)}
          </Button>
        ))}
      </Space>
    </div>
  )

  const newButton = (
    <Button type="primary" icon={<Plus size={16} aria-hidden />}
            onClick={() => setEditing({ correcting: null })}>
      {t('txn.new')}
    </Button>
  )

  // The same filter, without the page: the file is every matching receipt.
  const exportButton = (
    <Button icon={<Download size={16} aria-hidden />}
            href={`/gold-transactions/export${ledgerSearch(query, { page: 1, size: DEFAULT_PAGE_SIZE })}`}>
      {t('txn.export')}
    </Button>
  )

  async function confirmVoid() {
    if (!voidRow) return
    setVoiding(true)
    const result = await settleAction(() => voidReceipt({ key: voidRow.key, reason: voidReason }))
    setVoiding(false)
    if (!result.ok) {
      setNotice(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      return
    }
    setVoidRow(null)
    setVoidReason('')
    router.refresh()
  }

  if (loadFailed) {
    return (
      <Page titleKey="txn.title">
        <div className={styles.failedFilters}>{dateFilters}</div>
        <LoadFailed />
      </Page>
    )
  }

  /** The only item of a receipt of one, or null. */
  const onlyItem = (r: ReceiptRow) => (r.lines.length === 1 ? r.lines[0] : null)

  // Widths are the design; the columns without one share what is left.
  const columns: ColumnsType<ReceiptRow> = [
    { title: t('txn.date'), dataIndex: 'txn_date', width: 104 },
    {
      title: t('txn.col.doc'), dataIndex: 'doc_no', width: 132,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('txn.col.type'), dataIndex: 'txn_type', width: 112,
      render: (v: string) => <TxnTypeTag type={v} />,
    },
    {
      title: t('txn.col.partner'), dataIndex: 'partner_code', ellipsis: true,
      render: (v: string | null, r) => (
        <>
          <div>{v ?? '—'}</div>
          {r.partner_phone && <Typography.Text type="secondary">{r.partner_phone}</Typography.Text>}
        </>
      ),
    },
    {
      title: t('txn.col.sales'), dataIndex: 'sales_person_code', width: 100,
      render: (v: string | null, r) => (r.soldBy.length > 1
        ? <>{r.soldBy.map((p) => <div key={p.code}>{p.code} {p.sharePct}%</div>)}</>
        : (v ?? '—')),
    },
    {
      title: t('txn.col.gold'), key: 'gold', width: 150,
      render: (_: unknown, r) => {
        const only = onlyItem(r)
        return (
          <>
            <div>{goldSummary(r, goldName, t)}</div>
            {only && (only.scrap_detail || only.gold_pct !== null) && (
              <Typography.Text type="secondary">
                {[only.scrap_detail, only.gold_pct].filter((x) => x !== null && x !== '').join(' · ')}
              </Typography.Text>
            )}
          </>
        )
      },
    },
    {
      title: t('txn.col.qty'), key: 'qty', width: 104, align: 'right',
      render: (_: unknown, r) => {
        const only = onlyItem(r)
        if (!only) {
          // Items counted in different units add up in grams.
          const grams = r.lines.reduce((sum, l) => sum + toGrams(l.qty, l.uom), 0)
          return <>{weight.format(grams)} g</>
        }
        return (
          <>
            <div>{weight.format(only.qty)}</div>
            {only.uom !== 'GRAM' && (
              <Typography.Text type="secondary">{weight.format(toGrams(only.qty, only.uom))} g</Typography.Text>
            )}
          </>
        )
      },
    },
    {
      title: t('txn.col.price'), key: 'price', width: 92, align: 'right',
      render: (_: unknown, r) => {
        const only = onlyItem(r)
        return only && only.unit_price !== null ? money.format(only.unit_price) : '—'
      },
    },
    {
      title: t('txn.col.amount'), dataIndex: 'amount', width: 136, align: 'right',
      render: (v: number, r) => (
        <>
          <div><Money value={v} /></div>
          {r.payments.map((p) => (
            <Typography.Text key={p.seq} type="secondary" style={{ display: 'block' }}>
              {money.format(p.amount)} {p.method}
            </Typography.Text>
          ))}
        </>
      ),
    },
    { title: t('txn.col.remarks'), dataIndex: 'remarks', ellipsis: true },
    {
      // Icons pinned to the right, so Sửa can be pressed without scrolling.
      title: t('txn.col.actions'), key: 'actions', width: 84, fixed: 'right',
      render: (_: unknown, r) => (
        <Space size={2}>
          <IconAction icon={<Pencil size={16} aria-hidden />} label={t('txn.correct')}
                      disabled={Boolean(r.blockedCode)}
                      disabledReason={blockedSentence(r.blockedCode, t)}
                      onClick={() => setEditing({ correcting: r })} />
          <IconAction icon={<Ban size={16} aria-hidden />} label={t('txn.void')} danger
                      onClick={() => setVoidRow(r)} />
        </Space>
      ),
    },
  ]

  const grams = Object.entries(totals.grams)

  return (
    <Page titleKey="txn.title" actions={<Space wrap>{exportButton}{newButton}</Space>}>
      {notice && (
        <Alert type="error" showIcon closable title={notice}
               onClose={() => setNotice(null)} style={{ marginBottom: 16 }} />
      )}
      {toast && (
        <Alert type="success" showIcon closable title={toast}
               onClose={() => setToast(null)} style={{ marginBottom: 16 }} />
      )}

      {dateFilters}

      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t('txn.filter.search')}
        count={rows.length}
        total={totals.count}
        onReset={hasFilters ? clearFilters : undefined}
      >
        <div className={styles.filters} role="group" aria-label={t('txn.filter.label')}>
          <Select
            allowClear
            className={styles.filterSelect}
            value={query.type}
            aria-label={t('txn.filter.type')}
            placeholder={t('txn.filter.type')}
            options={LEDGER_TXN_TYPES.map((value) => ({ value, label: value }))}
            onChange={(value) => go({ type: value ?? null })}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className={styles.filterSelectWide}
            value={query.gold}
            aria-label={t('txn.filter.gold')}
            placeholder={t('txn.filter.gold')}
            options={goldTypes.map((gold) => ({ value: gold.code, label: goldName(gold.code) }))}
            onChange={(value) => go({ gold: value ?? null })}
          />
          <Select
            allowClear
            showSearch
            className={styles.filterSelect}
            value={query.staff}
            aria-label={t('txn.filter.staff')}
            placeholder={t('txn.filter.staff')}
            options={salesPeople.map((value) => ({ value, label: value }))}
            onChange={(value) => go({ staff: value ?? null })}
          />
          <Select
            allowClear
            className={styles.filterSelectWide}
            value={query.method}
            aria-label={t('txn.filter.payment')}
            placeholder={t('txn.filter.payment')}
            options={PAYMENT_METHODS.map((value) => ({ value, label: value }))}
            onChange={(value) => go({ method: value ?? null })}
          />
          <Select
            allowClear
            className={styles.filterSelectWide}
            value={query.status}
            aria-label={t('txn.filter.status')}
            placeholder={t('txn.filter.status')}
            options={[
              { value: 'correctable', label: t('txn.filter.correctable') },
              { value: 'locked', label: t('txn.filter.locked') },
            ]}
            onChange={(value) => go({ status: value ?? null })}
          />
        </div>
      </ListToolbar>

      <Stats>
        <Stat labelKey="txn.total.count" value={totals.count.toLocaleString('en-US')}
              note={t('txn.total.filtered')} />
        <Stat labelKey="txn.total.purchases" value={money.format(totals.purchases)}
              note={t('txn.total.filtered')} tone="out" />
        <Stat labelKey="txn.total.sales" value={money.format(totals.sales)}
              note={t('txn.total.filtered')} tone="in" />
      </Stats>

      {grams.length > 0 && (
        <div className={styles.summaryRow}>
          <Space size={4} wrap>
            <Typography.Text type="secondary">{t('txn.total.movement')}</Typography.Text>
            {grams.map(([code, g]) => (
              <Tag key={code} color={g > 0 ? 'green' : 'red'}>
                {goldName(code)} {weight.format(g)} g
              </Tag>
            ))}
          </Space>
        </div>
      )}

      <DataTable<ReceiptRow>
        rowKey="key"
        columns={columns}
        dataSource={rows}
        // A receipt of several items opens to show them; a receipt of one
        // already shows everything on its row.
        expandable={{
          rowExpandable: (r) => r.lines.length > 1,
          expandedRowRender: (r) => <ReceiptLines row={r} goldName={goldName} />,
        }}
        emptyTitle={hasFilters ? t('txn.filter.empty') : t('txn.empty.all')}
        emptyAction={hasFilters
          ? <Button onClick={clearFilters}>{t('txn.filter.clear')}</Button>
          : newButton}
        // The database pages; the table only shows where in the ledger it is.
        pagination={{
          current: query.page,
          pageSize: query.size,
          total: totals.count,
          pageSizeOptions: [...PAGE_SIZES],
          onChange: (page, size) => go(size !== query.size ? { size, page: 1 } : { page }),
        }}
        style={{ marginTop: 16 }}
      />

      {editing && (
        <ReceiptForm
          open
          // Looking at one day, a new receipt goes on that day; otherwise on
          // today. A correction keeps its day.
          txnDate={editing.correcting?.txn_date ?? singleDay(query) ?? today}
          goldTypes={goldTypes}
          salesPeople={salesPeople}
          partners={partners}
          correcting={editing.correcting}
          onClose={() => setEditing(null)}
          onSaved={(docNo, stayOpen) => {
            setToast(docNo ? `${t('txn.form.savedAs')} ${docNo}` : t('txn.saved'))
            if (!stayOpen) setEditing(null)
            router.refresh()
          }}
        />
      )}

      <Modal
        open={Boolean(voidRow)}
        title={t('txn.void.title')}
        okText={t('txn.void.confirm')}
        okButtonProps={{ danger: true, disabled: voidReason.trim().length < 3, loading: voiding }}
        cancelText={t('txn.form.close')}
        onOk={confirmVoid}
        onCancel={() => { setVoidRow(null); setVoidReason('') }}
      >
        {/* The reason is asked for because the database demands one, and
            because a cancellation nobody explained is re-typed next month.
            Every item of the receipt goes. */}
        <p>{t('txn.voidWhy')}</p>
        {voidRow && (
          <p>
            <TxnTypeTag type={voidRow.txn_type} />
            {voidRow.txn_date} · {voidRow.doc_no ?? '—'} · {goldSummary(voidRow, goldName, t)}
            {' · '}{money.format(voidRow.amount)}
          </p>
        )}
        <Input autoFocus value={voidReason}
               aria-label={t('txn.voidWhy')}
               onChange={(e) => setVoidReason(e.target.value)}
               placeholder={t('txn.correctReason')} />
      </Modal>
    </Page>
  )
}
```

- [ ] **Step 4: Trang đọc `gold_receipt_ledger`**

Thay toàn bộ `src/app/(app)/gold-transactions/page.tsx` bằng:

```tsx
import { TxnScreen, type GoldTypeOption } from '@/components/gold/TxnScreen'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { parseLedgerQuery, rpcArgs } from '@/components/gold/ledgerQuery'
import { toReceiptRow } from '@/components/gold/ledgerRow'

export default async function GoldTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  const role = user?.role ?? null

  if (!can(role, 'goldTxn.write')) {
    return (
      <Forbidden locale={user?.locale} />
    )
  }

  // The filter is the address: every day, newest first, unless it says
  // otherwise. An old `?date=` link opens on that one day.
  const query = parseLedgerQuery(await searchParams)
  const today = new Date().toISOString().slice(0, 10)
  const supabase = await createServerSupabase()
  const args = rpcArgs(query)

  const [goldTypesResult, salesResult, partnerResult, ledgerResult, totalsResult] =
    await Promise.all([
      supabase.from('gold_type')
        .select('code, name_vi, name_en, native_uom')
        .eq('is_active', true)
        .order('sort_order'),
      supabase.from('sales_person').select('code').eq('is_active', true).order('code'),
      // Who has been traded with, and how to reach them, offered as suggestions
      // so the codes converge on one spelling instead of drifting.
      supabase.from('partner').select('code, phone').eq('is_active', true).order('code'),
      // One page of receipts, with the count of every receipt the filter
      // matched (0076). The database pages and filters.
      supabase.rpc('gold_receipt_ledger',
        { ...args, p_limit: query.size, p_offset: (query.page - 1) * query.size }),
      // The totals of the whole filter, not of the page on screen.
      supabase.rpc('gold_receipt_ledger_totals', args),
    ])

  const totals = ((totalsResult.data ?? []) as Record<string, unknown>[])[0]

  return (
    <TxnScreen
      query={query}
      today={today}
      // Rows that did not arrive must not be offered as an empty ledger: that
      // is how the same purchase gets typed in twice.
      loadFailed={Boolean(ledgerResult.error || totalsResult.error || goldTypesResult.error)}
      goldTypes={(goldTypesResult.data ?? []) as GoldTypeOption[]}
      salesPeople={(salesResult.data ?? []).map((s: { code: string }) => s.code)}
      partners={(partnerResult.data ?? []) as { code: string; phone: string | null }[]}
      rows={((ledgerResult.data ?? []) as Record<string, unknown>[]).map(toReceiptRow)}
      totals={{
        count: Number(totals?.receipt_count ?? 0),
        purchases: Number(totals?.purchases ?? 0),
        sales: Number(totals?.sales ?? 0),
        grams: (totals?.grams_by_gold ?? {}) as Record<string, number>,
      }}
    />
  )
}
```

- [ ] **Step 5: Bỏ form cũ**

Run: `git rm src/components/gold/TxnForm.tsx`
Run: `grep -rn "TxnForm" src tests` (công cụ Grep)
Expected: không còn kết quả.

- [ ] **Step 6: Chạy test và kiểm tra**

Run: `npx vitest run tests/lib/txn-ledger-screen.test.tsx`
Expected: PASS, 6 test.
Run: `npm run typecheck` rồi `npm run lint`
Expected: không lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/components/gold/ReceiptLines.tsx src/components/gold/TxnScreen.tsx "src/app/(app)/gold-transactions/page.tsx" tests/lib/txn-ledger-screen.test.tsx
git commit -m "feat(receipt): the ledger shows one row a receipt, its items beneath"
```

### Task 9: Excel mỗi món một dòng, và bỏ phần đọc/ghi cũ

**Files:**
- Modify: `src/components/gold/ledgerCsv.ts` (thay toàn bộ)
- Modify: `src/app/(app)/gold-transactions/export/route.ts` (thay toàn bộ)
- Modify: `src/components/gold/ledgerRow.ts`, `src/components/gold/types.ts`, `src/app/(app)/gold-transactions/actions.ts` (xoá phần cũ)
- Test: `tests/lib/ledger-csv.test.ts` (thay toàn bộ)

**Interfaces:**
- Consumes: `ReceiptRow` (Task 5), `toReceiptRow` (Task 6), `fineGrams` (Task 5), RPC `gold_receipt_ledger` (Task 4).
- Produces: `ledgerSheet(receipts: ReceiptRow[], locale: Locale, goldName: (code: string) => string): Sheet`, cột: Ngày, Số CT, Món, Mô tả món, Loại, Khách / NCC, SĐT khách, Sales, Loại vàng, Tuổi vàng, Số lượng, ĐVT, Gram, Gram tinh, Đơn giá, Thành tiền, Thanh toán, Ghi chú.

- [ ] **Step 1: Viết test hỏng**

Thay toàn bộ `tests/lib/ledger-csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ledgerSheet } from '@/components/gold/ledgerCsv'
import { toCsv } from '@/lib/export/csv'
import type { ReceiptRow } from '@/components/gold/types'

const receipt: ReceiptRow = {
  key: 'r1', receiptId: 'r1', txn_date: '2026-09-16', doc_no: 'PC49-2609-010', txn_type: 'PO',
  partner_code: 'Nguyen Van A', partner_phone: '090 123 4567', sales_person_code: 'T.Quỳnh',
  remarks: 'Giao, "gấp"', revision: 1, blockedCode: null, amount: -2850,
  lines: [
    { id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG', scrap_detail: '19-24k/grs',
      gold_pct: 0.987, uom: 'GRAM', qty: 9.4, unit_price: 101.06382979, amount: -950, blockedCode: null },
    { id: 'b', lineNo: 2, itemDesc: 'Thỏi RCM', gold_type_code: 'GRAIN', scrap_detail: null,
      gold_pct: 0.998, uom: 'GRAM', qty: 15.6, unit_price: 121.79487179, amount: -1900, blockedCode: null },
  ],
  payments: [{ seq: 1, amount: 950, method: 'CASH' }, { seq: 2, amount: 1900, method: 'BANKWIRE' }],
  soldBy: [{ code: 'T.Quỳnh', sharePct: 80 }, { code: 'L.Thanh', sharePct: 20 }],
}

const NAMES: Record<string, string> = { SG: 'Vàng vụn', GRAIN: 'Vàng Grain', RP: 'Rồng Phụng' }
const gold = (code: string) => NAMES[code] ?? code

describe('the gold ledger as a file', () => {
  it('writes one line per item, the receipt repeated on each', () => {
    const sheet = ledgerSheet([receipt], 'vi', gold)
    expect(sheet.header).toEqual([
      'Ngày', 'Số CT', 'Món', 'Mô tả món', 'Loại', 'Khách / NCC', 'SĐT khách', 'Sales',
      'Loại vàng', 'Tuổi vàng', 'Số lượng', 'ĐVT', 'Gram', 'Gram tinh', 'Đơn giá',
      'Thành tiền', 'Thanh toán', 'Ghi chú',
    ])
    expect(sheet.rows).toEqual([
      ['2026-09-16', 'PC49-2609-010', 1, 'Nhẫn 24K (vụn)', 'PO', 'Nguyen Van A', '090 123 4567',
        'T.Quỳnh 80% · L.Thanh 20%', 'Vàng vụn', '19-24k/grs · 0.987', 9.4, 'GRAM', 9.4, 9.2778,
        101.06382979, -950, '950 CASH · 1900 BANKWIRE', 'Giao, "gấp"'],
      ['2026-09-16', 'PC49-2609-010', 2, 'Thỏi RCM', 'PO', 'Nguyen Van A', '090 123 4567',
        'T.Quỳnh 80% · L.Thanh 20%', 'Vàng Grain', '0.998', 15.6, 'GRAM', 15.6, 15.5688,
        121.79487179, -1900, null, 'Giao, "gấp"'],
    ])
  })

  it('adds up, down the amount column, to what the receipts came to', () => {
    const rows = ledgerSheet([receipt], 'vi', gold).rows
    expect(rows.reduce((sum, r) => sum + Number(r[15]), 0)).toBe(-2850)
  })

  it('leaves a cell empty rather than writing a word for nothing', () => {
    const bare: ReceiptRow = {
      ...receipt, partner_code: null, partner_phone: null, sales_person_code: null, soldBy: [],
      payments: [], remarks: null,
      lines: [{ ...receipt.lines[0], itemDesc: null, unit_price: null, gold_pct: null, scrap_detail: null,
                gold_type_code: 'RP', uom: 'LUONG', qty: -1, amount: 5425 }],
    }
    const [line] = ledgerSheet([bare], 'vi', gold).rows
    expect(line[3]).toBeNull()
    expect(line[5]).toBeNull()
    expect(line[7]).toBeNull()
    expect(line[9]).toBeNull()
    expect(line[12]).toBe(-37.5)
    expect(line[13]).toBeNull()
    expect(line[14]).toBeNull()
    expect(line[16]).toBeNull()
  })

  it('survives the CSV writer with its commas and quotes intact', () => {
    const csv = toCsv([ledgerSheet([receipt], 'vi', gold)])
    expect(csv.split('\r\n')[1]).toContain('"Giao, ""gấp"""')
  })

  it('heads the columns in English for an English reader', () => {
    expect(ledgerSheet([], 'en', gold).header.slice(0, 2)).toEqual(['Date', 'Doc no.'])
  })
})
```

Run: `npx vitest run tests/lib/ledger-csv.test.ts`
Expected: FAIL — tiêu đề và dòng không khớp (`ledgerSheet` còn đọc `LedgerRow`).

- [ ] **Step 2: Viết `ledgerCsv.ts`**

Thay toàn bộ `src/components/gold/ledgerCsv.ts`:

```ts
/**
 * The gold ledger as a block of a CSV file.
 *
 * Pure: receipts in, a Sheet out; the route sends it. One line per item, as the
 * books hold them, so the amount column adds up to what the receipts came to.
 * The receipt's number, day and customer are repeated on every line so a
 * filtered or sorted sheet still says whose item it is; what was paid is on
 * the first line only, because repeated it would read as paid again. Figures
 * stay numbers, and something that is not there is an empty cell.
 */
import { t, type Locale, type MessageKey } from '@/lib/i18n'
import type { Sheet } from '@/lib/export/csv'
import { toGrams } from '@/lib/domain/units'
import { fineGrams } from './receiptLine'
import type { ReceiptRow } from './types'

const HEADINGS: MessageKey[] = [
  'txn.date', 'txn.col.doc', 'receipt.col.line', 'receipt.itemDesc', 'txn.col.type',
  'txn.col.partner', 'txn.col.phone', 'txn.col.sales', 'txn.col.gold', 'txn.col.scrap',
  'txn.col.qty', 'txn.col.uom', 'txn.col.grams', 'receipt.fine', 'txn.col.price',
  'txn.col.amount', 'txn.col.pay', 'txn.col.remarks',
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
      const paid = r.payments.map((p) => `${p.amount} ${p.method}`).join(' · ')
      return r.lines.map((l, i) => {
        const scrap = [l.scrap_detail, l.gold_pct].filter((x) => x !== null && x !== '').join(' · ')
        const fine = fineGrams(l.uom, l.qty, l.gold_pct)
        return [
          r.txn_date, r.doc_no, l.lineNo, l.itemDesc, r.txn_type,
          r.partner_code, r.partner_phone, sales || null, goldName(l.gold_type_code), scrap || null,
          l.qty, l.uom, toGrams(l.qty, l.uom), fine === null ? null : Math.round(fine * 10000) / 10000,
          l.unit_price, l.amount, i === 0 ? (paid || null) : null, r.remarks,
        ]
      })
    }),
  }
}
```

Run: `npx vitest run tests/lib/ledger-csv.test.ts`
Expected: PASS, 5 test.

- [ ] **Step 3: Route xuất file đọc phiếu**

Thay toàn bộ `src/app/(app)/gold-transactions/export/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { csvBytes, reportFileName, toCsv } from '@/lib/export/csv'
import type { Locale } from '@/lib/i18n'
import { parseLedgerQuery, rpcArgs } from '@/components/gold/ledgerQuery'
import { ledgerSheet } from '@/components/gold/ledgerCsv'
import { toReceiptRow } from '@/components/gold/ledgerRow'
import type { ReceiptRow } from '@/components/gold/types'

/**
 * The API answers with at most a thousand rows and does not say it cut the
 * rest, so the ledger is read a thousand receipts at a time until a short batch.
 */
const BATCH = 1000

/**
 * The gold ledger, filtered exactly as the screen was, as a file: every
 * matching receipt, one line per item. The same filter module and the same
 * database function as the screen (0076), so the two cannot disagree.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!can(user?.role ?? null, 'goldTxn.write')) {
    return new NextResponse('Not permitted', { status: 403 })
  }
  const locale: Locale = user?.locale ?? 'vi'
  const query = parseLedgerQuery(Object.fromEntries(request.nextUrl.searchParams))
  const supabase = await createServerSupabase()

  const goldTypes = await supabase.from('gold_type').select('code, name_vi, name_en')
  const names = new Map(((goldTypes.data ?? []) as { code: string; name_vi: string; name_en: string }[])
    .map((g) => [g.code, locale === 'vi' ? g.name_vi : g.name_en]))

  const receipts: ReceiptRow[] = []
  for (let offset = 0; ; offset += BATCH) {
    const { data, error } = await supabase.rpc('gold_receipt_ledger',
      { ...rpcArgs(query), p_limit: BATCH, p_offset: offset })
    // A file that stops halfway is worse than no file: it gets summed as if it
    // were whole.
    if (error) {
      return new NextResponse(`Could not read the ledger: ${error.message}`, { status: 500 })
    }
    const batch = (data ?? []) as Record<string, unknown>[]
    receipts.push(...batch.map(toReceiptRow))
    if (batch.length < BATCH) break
  }

  const sheet = ledgerSheet(receipts, locale, (code) => names.get(code) ?? code)
  const stamp = query.from || query.to
    ? `${query.from ?? 'dau'}_${query.to ?? 'nay'}`
    : 'tat-ca'

  return new NextResponse(csvBytes(toCsv([sheet])) as BodyInit, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reportFileName('giao-dich-vang', stamp)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
```

- [ ] **Step 4: Bỏ phần cũ không còn ai dùng**

1. `src/components/gold/ledgerRow.ts`: xoá hàm `toLedgerRow` cùng khối chú thích ngay trên nó; sửa import thành `import type { ReceiptLine, ReceiptRow } from './types'`.
2. `src/components/gold/types.ts`: xoá `export type SavedRow = { ... }` và `export type LedgerRow = SavedRow & { ... }` cùng chú thích của chúng.
3. `src/app/(app)/gold-transactions/actions.ts`: xoá `rowSchema`, `export type TxnRowInput`, `docNoOf`, `saveTransaction`, `correctionSchema`, `correctTransaction`, `voidSchema`, `export type VoidResult`, `voidTransaction`, cùng chú thích của từng cái. Giữ `PAYMENT_METHODS`, `paymentSchema`, `salesShareSchema`, `export type SaveResult` và mọi thứ Task 6 đã thêm.
4. Kiểm tra không còn ai gọi: dùng Grep với mẫu `toLedgerRow|LedgerRow\b|SavedRow|saveTransaction|correctTransaction|voidTransaction|TxnRowInput` trên `src tests scripts`.
   Expected: chỉ còn `LedgerRow` trong `src/components/reports/ReportView.tsx` (kiểu khác, của màn báo cáo — không đụng).

- [ ] **Step 5: Chạy toàn bộ test thường và kiểm tra**

Run: `npx vitest run tests/lib`
Expected: PASS.
Run: `npm run typecheck` rồi `npm run lint`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/components/gold/ledgerCsv.ts "src/app/(app)/gold-transactions/export/route.ts" src/components/gold/ledgerRow.ts src/components/gold/types.ts "src/app/(app)/gold-transactions/actions.ts" tests/lib/ledger-csv.test.ts
git commit -m "feat(receipt): the Excel file has a line per item; the single-row readers go"
```

### Task 10: Kiểm tra trên trình duyệt

**Files:**
- Create: `scripts/support/receipts.mjs`
- Create: `scripts/verify-receipt.mjs`
- Modify: `package.json` (thêm `verify:receipt`)
- Modify: `scripts/verify-payments.mjs`, `scripts/verify-void.mjs`, `scripts/verify-correct.mjs`, `scripts/verify-txn-form.mjs`, `scripts/verify-ledger.mjs`, `scripts/verify-live.mjs`

**Interfaces:**
- Consumes: migration 0073–0076 trên database thật; màn hình Task 7–9; `openPage`, `signIn` (`scripts/support/page.mjs`), `accountFor` (`scripts/support/accounts.mjs`), `until`, `untilRowIs` (`scripts/support/until.mjs`).
- Produces: `removeReceipts(db, day, partner = null)` trong `scripts/support/receipts.mjs`; lệnh `npm run verify:receipt`.

- [ ] **Step 1: Hàm dọn phiếu thử**

Tạo `scripts/support/receipts.mjs`:

```js
/**
 * Takes a check's receipts off the day it wrote them on.
 *
 * Called after the check has deleted its lines, which point at the receipts.
 * A correction points at the receipt it replaced, so that link goes first.
 * Production never deletes a receipt; this exists so a check does not leave
 * its practice receipts in the client's books.
 */
export async function removeReceipts(db, day, partner = null) {
  const where = partner === null ? 'txn_date = $1' : 'txn_date = $1 AND partner_code = $2'
  const params = partner === null ? [day] : [day, partner]
  await db.query(`UPDATE pc49.gold_receipt SET corrects_receipt_id = NULL WHERE ${where}`, params)
  await db.query(`DELETE FROM pc49.gold_receipt WHERE ${where}`, params)
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'gold_receipt'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.gold_receipt)`)
}
```

- [ ] **Step 2: Script nhập đúng tờ phiếu 6 món**

Tạo `scripts/verify-receipt.mjs`:

```js
// A receipt of several items, typed the way the counter asked for it.
//
//   "nguoi ta ban 1 lan 6 mon la app dang bat nhap 6 lan"
//
// The paper receipt from 17-09, entered whole: six pieces bought from one
// customer, 8,361.00, paid 5,000 in cash and the rest by wire. Then the ledger
// is read the way the accountant reads it (one row, six items beneath), and
// the receipt is corrected (the pendant taken off) and cancelled.
//
//   npm run verify:receipt      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { until, untilRowIs } from './support/until.mjs'
import { removeReceipts } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-10-08'
const PERIOD = '2019-10'
const PARTNER = 'verify-receipt customer'
const SCREEN = `${BASE}/gold-transactions?date=${DAY}`

/** The six items on the paper: weight, purity, and the amount the receipt says. */
const ITEMS = [
  { desc: 'Nhẫn 24K (vụn)', gold: 'Vàng vụn', band: '19-24k/grs', qty: '9.40', purity: '0.987', total: '950' },
  { desc: 'Mũ 24K (vụn)', gold: 'Vàng vụn', band: '19-24k/grs', qty: '7.50', purity: '0.981', total: '825' },
  { desc: 'Thỏi RCM', gold: 'Vàng Grain', band: null, qty: '15.60', purity: '0.998', total: '1900' },
  { desc: 'Bi 24K (vụn)', gold: 'Vàng vụn', band: '19-24k/grs', qty: '37.50', purity: '0.990', total: '4125' },
  { desc: 'Xu Suisse 24K', gold: 'Vàng Grain', band: null, qty: '5.00', purity: '0.990', total: '525' },
  { desc: 'Mặt dây 14K (vụn)', gold: 'Vàng vụn', band: '10-18k/grs', qty: '0.60', purity: '0.597', total: '36' },
]

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes on its day, and the customer it invents. */
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
  // Unposted first: a posted entry's lines are immutable. Reversals go before
  // the entries they point at.
  await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL', [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [PERIOD])
  await db.query('DELETE FROM pc49.gold_price_daily WHERE price_date = $1', [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
}

/**
 * Clicks an option in whichever dropdown is open, scrolled to and pressed: an
 * option drawn below the dialog's scrolling body never counts as visible.
 */
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

const item = (form, n) => form.getByRole('group', { name: `Món ${n}`, exact: true })
const items = (form) => form.getByRole('group', { name: /^Món \d+$/ })
const shown = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ')

try {
  await cleanUp()
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'SG', 62.50), ($1, 'GRAIN', 139.20)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = excluded.market_price`, [DAY])

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- The receipt, typed once ---------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)

  for (const [i, it] of ITEMS.entries()) {
    if (i > 0) await form.getByRole('button', { name: 'Thêm món' }).click()
    const group = item(form, i + 1)
    await group.waitFor()
    await group.getByLabel('Mô tả món', { exact: true }).fill(it.desc)
    await choose(page, group, 'Loại vàng', it.gold)
    if (it.band) await choose(page, group, 'Nhóm vàng vụn', it.band)
    await group.getByLabel('Số lượng', { exact: true }).fill(it.qty)
    await group.getByLabel('Tuổi vàng (0–1)', { exact: true }).fill(it.purity)
    await group.getByLabel('Thành tiền', { exact: true }).fill(it.total)
  }

  const first = item(form, 1)
  const finePrice = Number((await first.getByLabel('Giá/gram tinh', { exact: true }).inputValue())
    .replace(/,/g, ''))
  check('the price per fine gram follows from the amount', Math.abs(finePrice - 102.39) < 0.006, `${finePrice}`)
  check('and the fine grams are worked out', (await shown(first)).includes('9.2778'))
  check('six items on the form', (await items(form).count()) === 6, `${await items(form).count()}`)
  check('adding up to the paper total', (await shown(form)).includes('8,361.00'))

  const settle = form.locator('section[aria-labelledby="txn-settle-heading"]')
  const amounts = () => settle.getByLabel('Số tiền', { exact: true })
  await amounts().nth(0).fill('5000')
  await settle.getByRole('button', { name: 'Thêm hình thức thanh toán' }).click()
  await until(async () => ((await amounts().count()) === 2 ? true : null))
  await amounts().nth(1).fill('3361')
  await settle.getByLabel('Hình thức', { exact: true }).nth(1).click()
  await pickOption(page, 'BANKWIRE')
  check('paid in full, the form shows no difference',
    (await settle.getByText(/Thanh toán (còn thiếu|nhiều hơn)/).count()) === 0)

  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const saved = await untilRowIs(db,
    `SELECT r.id, r.doc_no, count(t.id)::int AS items, count(t.journal_entry_id)::int AS posted,
            count(DISTINCT t.doc_no)::int AS numbers, coalesce(-sum(t.amount), 0)::float8 AS total
       FROM pc49.gold_receipt r JOIN pc49.gold_txn t ON t.receipt_id = r.id
      WHERE r.txn_date = $1 AND r.partner_code = $2 AND r.voided_at IS NULL
      GROUP BY r.id`, [DAY, PARTNER], (r) => r.posted === 6)
  check('one receipt saves, its six items posted', saved !== null,
    saved ? `${saved.doc_no}, ${saved.items} items` : '(nothing posted)')
  if (!saved) throw new Error('the receipt did not save')
  check('under one number', saved.numbers === 1, `${saved.numbers} numbers`)
  check('for the paper total', saved.total === 8361, `${saved.total}`)

  const paid = await db.query(
    `SELECT gp.method::text AS method, sum(gp.amount)::float8 AS total
       FROM pc49.gold_txn t JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
      WHERE t.receipt_id = $1 GROUP BY 1 ORDER BY 1`, [saved.id])
  check('the payments are divided without losing a cent',
    paid.rows.length === 2
      && paid.rows[0].method === 'BANKWIRE' && paid.rows[0].total === 3361
      && paid.rows[1].method === 'CASH' && paid.rows[1].total === 5000,
    paid.rows.map((r) => `${r.total} ${r.method}`).join(' + '))

  // ---- One row in the ledger -----------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  const rows = page.locator('.ant-table-tbody tr.ant-table-row')
  check('the ledger lists the receipt once', (await rows.count()) === 1, `${await rows.count()} rows`)
  const row = rows.first()
  const rowText = await shown(row)
  check('as several kinds of gold, six items', rowText.includes('Nhiều loại (6 món)'), rowText.slice(0, 140))
  check('with the paper total', rowText.includes('8,361.00'))
  await row.locator('.ant-table-row-expand-icon').click()
  const expanded = page.locator('.ant-table-expanded-row').first()
  await expanded.waitFor()
  check('and its items open beneath it', (await shown(expanded)).includes('Thỏi RCM'))

  // ---- Corrected: the pendant was not sold after all -----------------------
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click()
  const fix = page.getByRole('dialog', { name: 'Sửa giao dịch', exact: true }).last()
  await fix.waitFor()
  check('the correction opens holding all six items', (await items(fix).count()) === 6,
    `${await items(fix).count()}`)
  await item(fix, 6).getByRole('button', { name: 'Bỏ món này' }).click()
  await until(async () => ((await items(fix).count()) === 5 ? true : null))
  const fixSettle = fix.locator('section[aria-labelledby="txn-settle-heading"]')
  await fixSettle.getByLabel('Số tiền', { exact: true }).nth(1).fill('3325')
  await fix.getByLabel('Lý do sửa', { exact: true }).fill('Khách giữ lại mặt dây')
  await fix.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const fixed = await untilRowIs(db,
    `SELECT r.id, r.doc_no, r.corrects_receipt_id AS corrects, count(t.journal_entry_id)::int AS posted
       FROM pc49.gold_receipt r JOIN pc49.gold_txn t ON t.receipt_id = r.id
      WHERE r.txn_date = $1 AND r.partner_code = $2 AND r.voided_at IS NULL
      GROUP BY r.id`, [DAY, PARTNER], (r) => r.corrects === saved.id && r.posted === 5)
  check('the corrected receipt has five items, posted', fixed !== null, fixed ? '' : '(not corrected)')
  if (!fixed) throw new Error('the correction did not save')
  check('and keeps its number', fixed.doc_no === saved.doc_no, fixed.doc_no)
  const old = await db.query(
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_receipt WHERE id = $1) AS receipt,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE receipt_id = $1 AND voided_at IS NULL) AS live`,
    [saved.id])
  check('the original is cancelled, every item of it',
    old.rows[0].receipt === true && old.rows[0].live === 0, `${old.rows[0].live} live items`)

  // ---- Cancelled -----------------------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Huỷ', exact: true }).first().click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiểm tra huỷ cả phiếu')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  const cancelled = await untilRowIs(db,
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_receipt WHERE id = $1) AS receipt,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE receipt_id = $1 AND voided_at IS NULL) AS live`,
    [fixed.id], (r) => r.receipt === true && r.live === 0)
  check('cancelling takes every item off the books at once', cancelled !== null)
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('and the ledger lists nothing for the day',
    (await page.locator('.ant-table-tbody tr.ant-table-row').count()) === 0)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date = $1) AS receipts,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.gold_price_daily WHERE price_date = $1) AS prices,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.receipts, r.entries, r.prices, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.receipts} receipts, ${r.entries} entries, ${r.prices} prices, ${r.partners} customers`)
  await db.end()
}

console.log(failures === 0 ? '\nALL RECEIPT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
```

Trong `package.json`, thêm sau dòng `"verify:ledger": ...` (nhớ thêm dấu phẩy cuối dòng đó):

```json
    "verify:receipt": "node --env-file=.env.local scripts/verify-receipt.mjs"
```

- [ ] **Step 3: Cập nhật các script đang chạm form và sổ**

1. `scripts/verify-payments.mjs`: thêm `import { removeReceipts } from './support/receipts.mjs'` dưới các import; trong `cleanUp()`, ngay sau vòng `for (const t of txns.rows) { ... }`, thêm `await removeReceipts(db, DAY)`.
2. `scripts/verify-void.mjs`: như trên (import; `await removeReceipts(db, DAY)` ngay sau vòng `for`).
3. `scripts/verify-correct.mjs`: như trên; rồi thay khối kiểm tra `linked` (từ `// The replacement says what it replaces` đến hết lời gọi `check('and the replacement records which row it replaced', ...)`) bằng:

```js
  // The replacement is a receipt that says which receipt it replaces, under
  // the same number, so the pair can be read back later (0075).
  const linked = await db.query(
    `SELECT fr.corrects_receipt_id::text AS corrects, wt.receipt_id::text AS original,
            ft.doc_no = wt.doc_no AS same_number
       FROM pc49.gold_txn ft JOIN pc49.gold_receipt fr ON fr.id = ft.receipt_id
       CROSS JOIN pc49.gold_txn wt
      WHERE ft.id = $1 AND wt.id = $2`, [fixed?.id, wrong.id])
  check('and the replacement records which receipt it replaced',
    Boolean(linked.rows[0]?.original) && linked.rows[0]?.corrects === linked.rows[0]?.original,
    linked.rows[0]?.corrects ?? '(not linked)')
  check('under the same number', linked.rows[0]?.same_number === true)
```

4. `scripts/verify-txn-form.mjs`: thêm import `removeReceipts`; trong `cleanUp()`, sau vòng `for (const row of made.rows) { ... }`, thêm `await removeReceipts(db, DAY, PARTNER)`; trong `fillPurchase`, đổi `form.getByLabel('Tổng tiền', { exact: true })` thành `form.getByLabel('Thành tiền', { exact: true })`.
5. `scripts/verify-ledger.mjs`: thay hai truy vấn `expected` và `everything` bằng:

```js
// The screen counts receipts and the file has a line per item (0076).
const expected = (await db.query(
  `SELECT count(DISTINCT coalesce(receipt_id, id))::int AS receipts,
          count(*)::int AS items,
          coalesce(-sum(amount) FILTER (WHERE txn_type IN ('PO', 'PO_VENDOR')), 0)::numeric(18,2)::text AS purchases
     FROM pc49.gold_txn WHERE voided_at IS NULL AND txn_date BETWEEN $1 AND $2`, [FROM, TO])).rows[0]
const everything = (await db.query(
  `SELECT count(DISTINCT coalesce(receipt_id, id))::int AS n
     FROM pc49.gold_txn WHERE voided_at IS NULL`)).rows[0].n
```

   rồi đổi mọi `stat('Số giao dịch')` thành `stat('Số phiếu')`; `'opening the ledger counts every live transaction'` thành `'opening the ledger counts every live receipt'`; trong kiểm tra tháng Giêng đổi `expected.n` thành `expected.receipts` (hai chỗ); trong kiểm tra file CSV đổi `expected.n` thành `expected.items` (hai chỗ) và tên kiểm tra thành `'holding every January item, not just the first page'`.
6. `scripts/verify-live.mjs`: trong kiểm tra `'nothing in the books is dated before the ledger begins'`, thêm dòng `+ (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date < '2025-01-01')` ngay sau dòng `gold_txn`.

- [ ] **Step 4: Đưa migration lên database thật**

Không chạy song song lệnh nào khác. Migration chỉ thêm (bảng, cột trống được, hàm mới, `write_gold_transaction` nhận thêm trường tuỳ chọn), nên bản đang chạy trên Production vẫn dùng được.

Run (nguyên văn): `npm run migrate`
Expected: áp dụng `0073_a_receipt_holds_several_items`, `0074_a_receipt_is_saved_whole`, `0075_a_receipt_is_corrected_whole`, `0076_the_ledger_lists_receipts`, không lỗi.
Run: `npm run verify:live`
Expected: mọi dòng PASS (số migration khớp số file).

- [ ] **Step 5: Chạy bản build trên máy**

Run: `npm run build`
Expected: build xong, không lỗi.

Khởi động server như một tác vụ nền riêng (Bash `run_in_background: true`):
`node node_modules/next/dist/bin/next start -p 3149`
Chờ bằng Monitor tới khi `curl -s -o /dev/null -w "%{http_code}" http://localhost:3149/login` trả `200`, rồi xác nhận trang có nội dung PC49.

- [ ] **Step 6: Chạy các kiểm tra, mỗi lệnh ghi ra file**

Đặt `S=` thư mục scratchpad của phiên. Chạy lần lượt, không pipe, sau mỗi lệnh đọc file kết quả bằng Read:

```bash
PC49_BASE_URL=http://localhost:3149 npm run verify:receipt > "$S/verify-receipt.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:payments > "$S/verify-payments.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:void > "$S/verify-void.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:correct > "$S/verify-correct.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:grid > "$S/verify-grid.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:ledger > "$S/verify-ledger.txt" 2>&1; echo "exit=$?"
```

Expected: mỗi lệnh `exit=0`, file kết thúc bằng `ALL … CHECKS PASSED`. Một kiểm tra hỏng: đọc file, sửa đúng nguyên nhân (theo superpowers:systematic-debugging), build lại, chạy lại kiểm tra đó.

Sau cùng: `npm run verify:live` → mọi dòng PASS (không sót dữ liệu thử năm 2019). Dừng tác vụ nền của server (chỉ tác vụ đã tạo ở Step 5).

- [ ] **Step 7: Commit**

```bash
git add scripts/support/receipts.mjs scripts/verify-receipt.mjs package.json scripts/verify-payments.mjs scripts/verify-void.mjs scripts/verify-correct.mjs scripts/verify-txn-form.mjs scripts/verify-ledger.mjs scripts/verify-live.mjs
git commit -m "test(receipt): the six-item receipt is typed, corrected and cancelled in the browser"
```

### Task 11: Cổng kiểm tra, đẩy lên, kiểm tra trên Production

**Files:** không sửa file nào (trừ khi cổng hỏng).

**Interfaces:**
- Consumes: mọi task trước; migration đã có trên database thật (Task 10 Step 4).
- Produces: bản chạy trên `https://pc49-accounting.vercel.app` có phiếu nhiều món.

- [ ] **Step 1: Cổng đầy đủ**

Chạy lần lượt, không lệnh nào song song:

```bash
npx vitest run tests/sql --maxWorkers=4
npx vitest run tests/lib
npm run typecheck
npm run lint
npm run build
```

Expected: tất cả PASS / không lỗi. Hỏng ở đâu thì sửa ở task tương ứng, commit riêng, chạy lại cả cổng.

- [ ] **Step 2: Không có dấu vết công cụ AI**

```bash
git log origin/main..HEAD --format=%B | grep -ciE 'claude|codex|co-authored'
git diff origin/main..HEAD | grep -ciE 'claude|codex'
```

Expected: cả hai in `0`. Khác `0`: sửa nội dung hoặc message trước khi đẩy (commit mới sửa file; message thì hỏi người dùng trước khi viết lại lịch sử).

- [ ] **Step 3: Chờ ngoài giờ nhập liệu**

Run: `date -u +%H:%M`
Chỉ đẩy khi từ `08:00` UTC trở đi (15:00 giờ VN) và trước `04:00` UTC hôm sau. Sớm hơn: dừng, báo người dùng giờ sẽ đẩy.

- [ ] **Step 4: Đẩy lên**

Chạy riêng một lệnh:

```bash
git push origin main
```

Theo dõi bản triển khai: `gh api repos/quocviet-IT/PC49-Accounting-web-app/deployments --jq '.[0] | {sha, created_at}'` cho tới khi `sha` là HEAD vừa đẩy, rồi `gh api repos/quocviet-IT/PC49-Accounting-web-app/deployments/<id>/statuses --jq '.[0].state'` là `success`.

- [ ] **Step 5: Kiểm tra trên Production**

Mỗi lệnh ghi ra file trong scratchpad rồi đọc:

```bash
PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:receipt > "$S/prod-receipt.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:ledger > "$S/prod-ledger.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:payments > "$S/prod-payments.txt" 2>&1; echo "exit=$?"
npm run verify:live
```

Expected: `exit=0` cả ba, `verify:live` PASS hết.

- [ ] **Step 6: Báo người dùng**

Nói ngắn gọn bằng tiếng Việt: đã có phiếu nhiều món; người dùng **tải lại trang (F5) một lần**; kết quả kiểm tra trên Production; phần "transfer" (nhập quy đổi vàng) là thiết kế riêng làm tiếp theo.

---

## Ghi chú cho người thực hiện

- **Dấu số lượng:** mua vào/bán ra gõ không dấu, loại phiếu đặt dấu (CHECK của 0012 vốn đã cố định dấu cho các loại này). `DEPOSIT`, `MEMO`, `ON_THE_WAY` giữ dấu như gõ, vì dấu ở đó mang nghĩa vào/ra.
- **Huỷ một lần lấy hàng:** `void_gold_receipt` cho phép `DEPOSIT_PICKUP`, vì phải huỷ lần lấy hàng trước rồi mới huỷ được đơn cọc. Mọi mã khoá khác chặn cả phiếu.
- **Lọc theo trạng thái sửa:** tính ở cấp phiếu. Một món bị khoá thì cả phiếu thuộc "Không thể sửa".
- **Thẻ tổng khi có lọc loại vàng:** chỉ cộng các món khớp lọc, còn dòng sổ vẫn hiện đủ cả phiếu. Hai con số này khác nhau là đúng thiết kế.

