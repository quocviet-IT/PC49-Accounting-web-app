# Quy đổi vàng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kế toán nhập được một lần quy đổi vàng (RA loại này, VÀO loại khác, cân trọng lượng) ngay trong sổ giao dịch vàng; mỗi phiên là một dòng sổ, sửa và huỷ cả phiên.

**Architecture:**
- Dùng lại bảng `gold_conversion` và các vế `TRANSFER_OUT` / `TRANSFER_IN` / `RA_RP` trên `gold_txn`, thêm số phiếu, đối tác, phiên bản, huỷ và lý do lệch.
- Ba hàm `save/correct/void_gold_conversion` ghi cả phiên trong một giao dịch và ghi sổ từng vế.
- Sổ nhóm theo `coalesce(receipt_id, conversion_id, id)`.
- Form mới `ConversionForm` có hai cột RA/VÀO và ô cân bằng.
- Sửa kèm hai lỗi về vế chuyển vàng: vế quy đổi bị tính là "ở nhà phân kim", và vế lô phân kim sửa được từ sổ.
- Đặc tả: `docs/superpowers/specs/2026-09-17-quy-doi-vang-design.md`.

**Tech Stack:** PostgreSQL/Supabase (plpgsql, RLS), PGlite + vitest, Next.js 16 server actions, React 19, antd 6 (Form.List, Table expandable), zod 4, Playwright.

## Global Constraints

- Loại phiên nhập từ màn hình: `TRANSFER` (Quy đổi) hoặc `RA_RP` (Ra RP). Phiên `REFINING_SEND` / `REFINING_RECEIVE` không sửa/huỷ ở đây (`CONVERSION_REFINING`).
- Vế: `TRANSFER` → RA là `TRANSFER_OUT` (qty âm), VÀO là `TRANSFER_IN` (qty dương); `RA_RP` → cả hai bên `RA_RP`, RA chỉ `GRAIN`, VÀO chỉ `RP`. Thành tiền 0, không đơn giá.
- Gram = |qty| × `uom_factor` (GRAM 1, LUONG 37.5, OZ 31.105). Lệch % = |gram VÀO − gram RA| ÷ gram RA × 100. Vượt `CONVERSION_WEIGHT_TOLERANCE_PCT` (hiện 0.5) thì bắt buộc `varianceReason`.
- Mỗi bên 1–30 dòng.
- Mã từ chối: `CONVERSION_SIDES`, `CONVERSION_QTY: out|in N`, `CONVERSION_RA_RP`, `CONVERSION_UNBALANCED: out X in Y pct Z tolerance T`, `CONVERSION_REFINING`, `CONVERSION_VOIDED`, `LINE_BLOCKED: out|in N CODE`, và dùng lại `CONFLICT`, `REQUEST_KEY_REUSED`.
- Mã khoá sửa mới `REFINING_LEG` đứng **sau** mọi mã cũ trong `correction_blocked_code`, để không mã nào cũ đổi.
- Chỉ vế có `refining_lot_id` mới sinh movement `AT_REFINERY`.
- Phiên nạp từ bảng tính (`doc_no` trống) giữ số nhỏ nhất của các vế khi sửa; sổ hiện ghi chú của vế đầu thay cho `note` (là khoá nạp như `2026-05-08#1`).
- Không đổi hàm lưu/sửa/huỷ phiếu (0074–0075), trừ phần khoá sổ trong 0080.
- Nhãn script bấm theo tên: nút `Quy đổi vàng`; dialog `Quy đổi vàng` / `Sửa quy đổi` / `Huỷ giao dịch`; nhóm dòng `Ra N` / `Vào N`; trường `Loại phiên`, `Loại vàng`, `Số lượng`, `Lý do lệch`, `Lý do sửa`, `Khách / NCC`; nút `Thêm dòng ra`, `Thêm dòng vào`, `Bỏ dòng này`, `Lưu`, `Sửa`, `Huỷ`.
- Mọi lời gọi server action từ màn hình qua `settleAction`; mọi chữ qua từ điển, đủ `vi` và `en`.
- Test SQL chạy **riêng**: `npx vitest run tests/sql/<file> --maxWorkers=4`.
- Ghi database thật chỉ bằng `npm run migrate` (nguyên văn, không pipe), **sau 08:00 UTC** (15:00 giờ VN). Script `verify:*` ghi output ra file trong scratchpad, không pipe vào `head`/`grep`; chạy `npm run verify:live` sau cùng.
- Server local: `node node_modules/next/dist/bin/next start -p 3149`, tác vụ nền riêng; không dừng tiến trình theo cổng.
- File có tiếng Việt viết bằng Write/Edit, không dùng heredoc.
- Commit và nội dung đẩy lên không có dòng đồng tác giả hay tên công cụ AI. Đẩy lên `main` = triển khai Production: chỉ đẩy ngoài 04:00–08:00 UTC, `git push origin main` chạy riêng.

## File Structure

| File | Trách nhiệm |
|---|---|
| `supabase/migrations/0077_a_conversion_has_a_number.sql` | cột mới `gold_conversion`, trigger phiên bản và audit, `REFINING_LEG`, sửa `record_inventory_movement` |
| `supabase/migrations/0078_a_conversion_is_saved_whole.sql` | `conversion_line_grams`, `write_gold_conversion`, `conversion_answer`, `save_gold_conversion` |
| `supabase/migrations/0079_a_conversion_is_corrected_whole.sql` | `refuse_blocked_conversion_legs`, `correct_gold_conversion`, `void_gold_conversion` |
| `supabase/migrations/0080_the_ledger_lists_conversions.sql` | khoá sổ `coalesce(receipt_id, conversion_id, id)`, `gold_receipt_blocked_code`, sổ trả thêm cột quy đổi |
| `tests/support/conversion.ts` | các phiên mẫu (Grain ra RP, phiên Nini) |
| `tests/sql/conversion-entry.test.ts` | movement, khoá sửa, lưu, sửa, huỷ phiên |
| `tests/sql/conversion-ledger.test.ts` | sổ theo phiên |
| `src/components/gold/conversionLine.ts` | phép tính thuần: gram, cân bằng, loại vàng mỗi bên, payload |
| `src/components/gold/receiptErrors.ts` | thêm dịch mã từ chối của quy đổi |
| `src/components/gold/ConversionForm.tsx` | form nhập/sửa phiên |
| `src/components/gold/types.ts`, `ledgerRow.ts` | `ConversionInfo`, `side`, tóm tắt cột loại vàng |
| `src/app/(app)/gold-transactions/actions.ts` | `saveConversion`, `correctConversion`, `voidConversion` |
| `src/components/gold/TxnScreen.tsx`, `ReceiptLines.tsx`, `ledgerCsv.ts`, `page.tsx` | sổ, dòng mở rộng, Excel, dữ liệu quy tắc luồng và mức cho phép |
| `scripts/verify-conversion.mjs`, `scripts/support/receipts.mjs` | kiểm tra trên trình duyệt, dọn phiên thử |

---

### Task 1: Phiên có số, vế chuyển vàng về đúng chỗ

**Files:**
- Create: `supabase/migrations/0077_a_conversion_has_a_number.sql`
- Create: `tests/sql/conversion-entry.test.ts`
- Modify: `tests/sql/gold-ledger.test.ts:171` (`toHaveLength(8)` → `toHaveLength(9)`)
- Modify: `src/lib/i18n/dictionary.ts` (thêm `txn.blocked.REFINING_LEG` vi và en)
- Modify: `docs/superpowers/specs/2026-09-17-quy-doi-vang-design.md` (ghi thêm việc sửa movement)

**Interfaces:**
- Produces:
  - cột `gold_conversion.doc_no, partner_code, variance_reason, revision, voided_at, void_reason, corrects_conversion_id, updated_at, updated_by`;
  - `correction_blocked_code(uuid)` trả thêm `'REFINING_LEG'`;
  - `record_inventory_movement` chỉ ghi `AT_REFINERY` khi `refining_lot_id IS NOT NULL`.

- [ ] **Step 1: Viết test hỏng**

Tạo `tests/sql/conversion-entry.test.ts`:

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

/** A leg written straight into the table, as the loader and the refining screen write them. */
async function rawLeg(v: {
  type: string; gold: string; uom: string; qty: number
  conversionId?: string | null; lotId?: string | null; doc?: string | null; date?: string
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount,
                                conversion_id, refining_lot_id, doc_no)
     VALUES ($1, $2::pc49.txn_type, $3, $4::pc49.uom, $5, 0, $6, $7, $8) RETURNING id`,
    [v.date ?? '2026-06-03', v.type, v.gold, v.uom, v.qty, v.conversionId ?? null,
     v.lotId ?? null, v.doc ?? null])
  return r.rows[0].id
}

async function rawConversion(kind = 'TRANSFER', note: string | null = null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_conversion (conv_date, kind, note)
     VALUES ('2026-06-03', $1::pc49.conversion_kind, $2) RETURNING id`, [kind, note])
  return r.rows[0].id
}

describe('where a transfer leg leaves the gold', () => {
  it('keeps a conversion inside the vault: nothing goes to the refinery', async () => {
    const c = await rawConversion()
    const out = await rawLeg({ type: 'TRANSFER_OUT', gold: 'GRAIN', uom: 'GRAM', qty: -37.5, conversionId: c })
    const into = await rawLeg({ type: 'TRANSFER_IN', gold: 'RP', uom: 'LUONG', qty: 1, conversionId: c })
    await db.query(`SELECT pc49.post_gold_txn($1)`, [out])
    await db.query(`SELECT pc49.post_gold_txn($1)`, [into])
    const moves = await db.query<{ refinery: number; on_hand: string }>(
      `SELECT count(*) FILTER (WHERE m.bucket = 'AT_REFINERY')::int AS refinery,
              coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'ON_HAND'), 0)::float8::text AS on_hand
         FROM pc49.inventory_movement m WHERE m.source_id IN ($1, $2)`, [out, into])
    expect(moves.rows[0]).toEqual({ refinery: 0, on_hand: '0' })
  })

  it('still sends a refining lot to the refinery', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.MOVE') RETURNING id`)
    const leg = await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -30, lotId: lot.rows[0].id })
    await db.query(`SELECT pc49.post_gold_txn($1)`, [leg])
    const moves = await db.query<{ g: string }>(
      `SELECT coalesce(sum(qty_gram), 0)::float8::text AS g FROM pc49.inventory_movement
        WHERE source_id = $1 AND bucket = 'AT_REFINERY'`, [leg])
    expect(moves.rows[0].g).toBe('30')
  })
})

describe('what may not be corrected from the ledger', () => {
  it('names a refining lot leg, after every older reason', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.BLOCK') RETURNING id`)
    const leg = await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -12, lotId: lot.rows[0].id })
    const r = await db.query<{ code: string; reason: string }>(
      `SELECT pc49.correction_blocked_code($1) AS code, pc49.correction_blocked_reason($1) AS reason`, [leg])
    expect(r.rows[0]).toEqual({
      code: 'REFINING_LEG', reason: 'this row belongs to a refining lot; correct it on the refining screen',
    })
  })
})

describe('a conversion as a record of its own', () => {
  it('moves its revision whenever it changes', async () => {
    const c = await rawConversion()
    await db.query(`UPDATE pc49.gold_conversion SET note = 'doi lai' WHERE id = $1`, [c])
    const r = await db.query<{ revision: number }>(
      `SELECT revision FROM pc49.gold_conversion WHERE id = $1`, [c])
    expect(r.rows[0].revision).toBe(2)
  })

  it('is not cancelled without a reason', async () => {
    const c = await rawConversion()
    await expect(db.query(
      `UPDATE pc49.gold_conversion SET voided_at = now() WHERE id = $1`, [c]))
      .rejects.toThrow(/gold_conversion_void_needs_reason/)
  })
})
```

Trong `tests/sql/gold-ledger.test.ts`, đổi `expect(codes).toHaveLength(8)` thành `expect(codes).toHaveLength(9)`.

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/conversion-entry.test.ts --maxWorkers=4`
Expected: FAIL — `refinery: 1` (vế quy đổi đang sinh `AT_REFINERY`), `code: null`, `column "revision" does not exist`, constraint chưa có.

- [ ] **Step 3: Viết migration**

Tạo `supabase/migrations/0077_a_conversion_has_a_number.sql`:

```sql
-- 0077_a_conversion_has_a_number.sql
-- A conversion becomes something a person enters, numbers, corrects and
-- cancels, and posting one stops sending gold to the refinery.
--
-- Until now every conversion came from the spreadsheet loader, which grouped a
-- day's transfer rows under one key (0063). "cai transfer dau?" (17-09) asked
-- where to enter one. The screen needs what a receipt has (0073): a number, a
-- partner, a revision that moves with any change, a cancellation with a
-- reason, a link from a correction to what it corrects, and a place for the
-- reason a person gives when the weights do not meet, beside the variance_note
-- 0014's trigger writes.
--
-- Two faults are fixed on the way, both about transfer rows:
--
--   record_inventory_movement   sent every TRANSFER_OUT to AT_REFINERY (0021).
--                               Right for a refining lot; wrong for Grain turned
--                               into Rong Phung, where the Grain went on being
--                               counted as owned while the RP was counted too.
--                               Only a refining lot's leg goes there now. None of
--                               the 81 loaded conversion legs is posted yet, so
--                               no recorded movement changes.
--   correction_blocked_code     a refining lot's legs (refining_lot_id, 0056)
--                               could be corrected from the ledger like a
--                               purchase. They answer REFINING_LEG, checked after
--                               every older code so no older answer changes.

ALTER TABLE pc49.gold_conversion
  ADD COLUMN IF NOT EXISTS doc_no                 text,
  ADD COLUMN IF NOT EXISTS partner_code           text,
  ADD COLUMN IF NOT EXISTS variance_reason        text,
  ADD COLUMN IF NOT EXISTS revision               int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS voided_at              timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason            text,
  ADD COLUMN IF NOT EXISTS corrects_conversion_id uuid REFERENCES pc49.gold_conversion (id),
  ADD COLUMN IF NOT EXISTS updated_at             timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by             uuid;

ALTER TABLE pc49.gold_conversion
  DROP CONSTRAINT IF EXISTS gold_conversion_void_needs_reason;
ALTER TABLE pc49.gold_conversion
  ADD CONSTRAINT gold_conversion_void_needs_reason CHECK (
    voided_at IS NULL OR btrim(coalesce(void_reason, '')) <> '');

CREATE INDEX IF NOT EXISTS gold_conversion_date_idx ON pc49.gold_conversion (conv_date);

-- The revision rule of a transaction (0055).
DROP TRIGGER IF EXISTS gold_conversion_revision ON pc49.gold_conversion;
CREATE TRIGGER gold_conversion_revision
  BEFORE UPDATE ON pc49.gold_conversion
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_bump_revision();

DROP TRIGGER IF EXISTS audit_gold_conversion ON pc49.gold_conversion;
CREATE TRIGGER audit_gold_conversion
  AFTER INSERT OR UPDATE OR DELETE ON pc49.gold_conversion
  FOR EACH ROW EXECUTE FUNCTION pc49.audit_trigger();

-- 0071's checks, in 0071's order, and one more at the end.
CREATE OR REPLACE FUNCTION pc49.correction_blocked_code(p_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  t pc49.gold_txn;
BEGIN
  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_id;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF t.voided_at IS NOT NULL THEN RETURN 'VOIDED'; END IF;

  IF t.conversion_id IS NOT NULL THEN RETURN 'CONVERSION_LEG'; END IF;
  IF t.deposit_ref_id IS NOT NULL THEN RETURN 'DEPOSIT_PICKUP'; END IF;
  IF EXISTS (SELECT 1 FROM pc49.gold_txn p WHERE p.deposit_ref_id = p_id
              AND p.voided_at IS NULL) THEN
    RETURN 'DEPOSIT_PICKED_UP';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_receipt r WHERE r.gold_txn_id = p_id) THEN
    RETURN 'REFINING_RECEIPT';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.refining_lot_source s WHERE s.txn_id = p_id) THEN
    RETURN 'REFINING_SOURCE';
  END IF;
  IF EXISTS (SELECT 1 FROM pc49.cash_txn c WHERE c.gold_txn_id = p_id) THEN
    RETURN 'CASH_LINK';
  END IF;
  IF t.refining_lot_id IS NOT NULL THEN RETURN 'REFINING_LEG'; END IF;

  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION pc49.correction_blocked_reason(p_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pc49, public AS $$
  SELECT CASE pc49.correction_blocked_code(p_id)
    WHEN 'NOT_FOUND'         THEN 'there is no such transaction'
    WHEN 'VOIDED'            THEN 'this transaction has already been cancelled'
    WHEN 'CONVERSION_LEG'    THEN 'this is one leg of a conversion; correct the conversion instead'
    WHEN 'DEPOSIT_PICKUP'    THEN 'this is the pickup for a deposit; the two are corrected together'
    WHEN 'DEPOSIT_PICKED_UP' THEN 'a pickup has already been recorded against this deposit'
    WHEN 'REFINING_RECEIPT'  THEN 'this row came back from a refining lot'
    WHEN 'REFINING_SOURCE'   THEN 'this purchase has been picked into a refining lot'
    WHEN 'CASH_LINK'         THEN 'this is tied to a cash movement'
    WHEN 'REFINING_LEG'      THEN 'this row belongs to a refining lot; correct it on the refining screen'
  END
$$;

-- 0021's body. The one change is the condition on the AT_REFINERY leg.
CREATE OR REPLACE FUNCTION pc49.record_inventory_movement(p_txn_id uuid)
RETURNS int LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  t       pc49.gold_txn;
  v_price numeric;
  v_value numeric;
  v_n     int := 0;
BEGIN
  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_txn_id;
  IF NOT FOUND OR t.voided_at IS NOT NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM pc49.inventory_movement
              WHERE source_type = 'GOLD_TXN' AND source_id = p_txn_id) THEN
    RETURN 0;   -- already recorded
  END IF;

  v_price := pc49.cogs_price(t.txn_date, t.gold_type_code);
  v_value := CASE WHEN v_price IS NULL THEN NULL
                  ELSE round(abs(t.qty) * v_price, 2) END;

  -- ON_HAND leg. Every type except a pickup or a straight on-the-way order
  -- touches it, and qty_gram already carries the sign: a purchase is positive,
  -- a sale negative.
  IF t.txn_type IN ('PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'TRANSFER_IN',
                    'TRANSFER_OUT', 'RA_RP', 'MEMO') THEN
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'ON_HAND', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;
  END IF;

  -- The second leg, for the types that move gold between buckets rather than in
  -- or out of the business.
  IF t.txn_type = 'DEPOSIT' THEN
    -- Sold on paper, still in the shop.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'DEPOSIT_HELD', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'PICKUP' THEN
    -- The customer collects: the gold finally leaves the premises.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'DEPOSIT_HELD', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'CANCEL' THEN
    -- The order falls through: the gold goes back on the shelf.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'DEPOSIT_HELD', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id),
           (t.txn_date, t.gold_type_code, 'ON_HAND', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 2;

  ELSIF t.txn_type = 'TRANSFER_OUT' AND t.refining_lot_id IS NOT NULL THEN
    -- Away to the refinery. It has left the vault but PC49 still owns it. A
    -- conversion's transfer out has no second leg: the gold became another
    -- kind of gold in the vault, which its TRANSFER_IN leg records.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'AT_REFINERY', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'MEMO' THEN
    -- Lent out. The source admits it does not track whether these come back;
    -- keeping them in their own bucket is what makes that answerable.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'ON_MEMO', -t.qty_gram, -t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;

  ELSIF t.txn_type = 'ON_THE_WAY' THEN
    -- Ordered from a vendor, not yet received: owned but not yet in the vault.
    INSERT INTO pc49.inventory_movement
      (move_date, gold_type_code, bucket, qty_gram, qty_native, uom,
       unit_cost, provisional_value, source_type, source_id)
    VALUES (t.txn_date, t.gold_type_code, 'ON_THE_WAY', t.qty_gram, t.qty, t.uom,
            v_price, v_value, 'GOLD_TXN', t.id);
    v_n := v_n + 1;
  END IF;

  RETURN v_n;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0077_a_conversion_has_a_number')
ON CONFLICT (version) DO NOTHING;
```

Trong `src/lib/i18n/dictionary.ts`, ngay sau dòng `'txn.blocked.CASH_LINK': 'Dòng này gắn với một khoản thu chi tiền',` thêm:

```ts
    'txn.blocked.REFINING_LEG': 'Dòng này thuộc một lô phân kim; hãy sửa ở màn Phân kim',
```

và ngay sau dòng `'txn.blocked.CASH_LINK': 'This is tied to a cash movement',` (khối `en`) thêm:

```ts
    'txn.blocked.REFINING_LEG': 'This row belongs to a refining lot; correct it on the refining screen',
```

Trong `docs/superpowers/specs/2026-09-17-quy-doi-vang-design.md`, mục "Các vế", thay dòng `- Tồn kho đi theo \`inventory_movement\` như mọi giao dịch.` bằng:

```markdown
- Tồn kho đi theo `inventory_movement` như mọi giao dịch. Sửa kèm: `record_inventory_movement` (0021) ghi thêm `AT_REFINERY` cho **mọi** `TRANSFER_OUT`, nên một lần đổi Grain ra Rồng Phụng làm tổng vàng sở hữu tăng đúng số gram đã đổi. Từ nay chỉ vế có `refining_lot_id` mới vào `AT_REFINERY`.
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/sql/conversion-entry.test.ts tests/sql/gold-ledger.test.ts tests/sql/conversion.test.ts tests/sql/refining.test.ts tests/sql/inventory.test.ts --maxWorkers=4`
Expected: PASS hết (conversion-entry 5 test).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0077_a_conversion_has_a_number.sql tests/sql/conversion-entry.test.ts tests/sql/gold-ledger.test.ts src/lib/i18n/dictionary.ts docs/superpowers/specs/2026-09-17-quy-doi-vang-design.md
git commit -m "feat(conversion): a conversion is numbered, and its transfer out stays in the vault"
```

### Task 2: Lưu một phiên quy đổi

**Files:**
- Create: `supabase/migrations/0078_a_conversion_is_saved_whole.sql`
- Create: `tests/support/conversion.ts`
- Modify: `tests/sql/conversion-entry.test.ts` (thêm import và khối `describe` ở cuối)

**Interfaces:**
- Consumes: cột mới của `gold_conversion` (Task 1); `next_doc_no(date)` (0057); `post_gold_txn(uuid)` (0015); `request_outcome` (0054).
- Produces:
  - `pc49.conversion_line_grams(p_line jsonb) RETURNS numeric`;
  - `pc49.write_gold_conversion(p_payload jsonb, p_doc_no text DEFAULT NULL, p_corrects uuid DEFAULT NULL) RETURNS jsonb` → `{conversionId, docNo, firstTxnId}`;
  - `pc49.conversion_answer(p_first_txn uuid) RETURNS jsonb` → `{conversionId, docNo}`;
  - `pc49.save_gold_conversion(p_request_key text, p_payload jsonb) RETURNS jsonb` → `{conversionId, docNo, repeated}`;
  - payload: `{convDate, kind: 'TRANSFER'|'RA_RP', partnerCode, note, varianceReason, out: [{goldTypeCode, uom, qty}], in: [{goldTypeCode, uom, qty}]}`, `qty` không dấu;
  - `tests/support/conversion.ts`: `type ConvLine`, `type ConvBase`, `GRAIN_TO_RP`, `NINI`, `conversionPayload(base, over?) → string`.

- [ ] **Step 1: Dữ liệu test dùng chung**

Tạo `tests/support/conversion.ts`:

```ts
/**
 * Two conversions from the client's own books, as the screen sends them.
 *
 *   GRAIN_TO_RP   "Transfer 637.5gr vang Grain ra 17L VRP" (07-06)
 *   NINI          "Dua 4L VRP ... doi Nini 2oz CS, 1oz Other, 56.7gr vang Grain" (08-05):
 *                 150 g out, 150.015 g in, 0.01 percent apart
 */
export type ConvLine = { goldTypeCode: string; uom: 'GRAM' | 'OZ' | 'LUONG'; qty: number }

export type ConvBase = {
  kind: 'TRANSFER' | 'RA_RP'
  partnerCode?: string | null
  out: ConvLine[]
  in: ConvLine[]
}

export const GRAIN_TO_RP: ConvBase = {
  kind: 'TRANSFER',
  out: [{ goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 637.5 }],
  in: [{ goldTypeCode: 'RP', uom: 'LUONG', qty: 17 }],
}

export const NINI: ConvBase = {
  kind: 'TRANSFER',
  partnerCode: 'Nini',
  out: [{ goldTypeCode: 'RP', uom: 'LUONG', qty: 4 }],
  in: [
    { goldTypeCode: 'CS', uom: 'OZ', qty: 2 },
    { goldTypeCode: 'OTH', uom: 'OZ', qty: 1 },
    { goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 56.7 },
  ],
}

export function conversionPayload(base: ConvBase, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    convDate: '2026-06-03',
    partnerCode: null,
    note: 'quy doi',
    varianceReason: null,
    ...base,
    ...over,
  })
}
```

- [ ] **Step 2: Viết test hỏng**

Trong `tests/sql/conversion-entry.test.ts`, thêm dưới dòng `import { createTestDb, asRole } from '../support/db'`:

```ts
import { GRAIN_TO_RP, NINI, conversionPayload } from '../support/conversion'
```

Thêm vào cuối file:

```ts
type SavedConversion = { conversionId: string; docNo: string; repeated: boolean }

async function saveConversion(key: string, body: string, as = KT): Promise<SavedConversion> {
  const r = await asRole(db, as, () => db.query<{ r: SavedConversion }>(
    `SELECT pc49.save_gold_conversion($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

type Leg = { txn_type: string; gold_type_code: string; qty: string; grams: string; doc_no: string; posted: boolean }

async function legsOf(conversionId: string): Promise<Leg[]> {
  const r = await db.query<Leg>(
    `SELECT txn_type::text, gold_type_code, qty::float8::text AS qty, qty_gram::float8::text AS grams,
            doc_no, journal_entry_id IS NOT NULL AS posted
       FROM pc49.gold_txn WHERE conversion_id = $1
      ORDER BY (qty > 0), line_no`, [conversionId])
  return r.rows
}

const conversionCount = async () => (await db.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM pc49.gold_conversion`)).rows[0].n

describe('saving a conversion', () => {
  it('writes one conversion and its legs under one number, every leg posted', async () => {
    const saved = await saveConversion('grain-to-rp', conversionPayload(GRAIN_TO_RP))
    const conv = await db.query<{ doc_no: string; kind: string; completed: boolean; variance: string | null }>(
      `SELECT doc_no, kind::text, completed_at IS NOT NULL AS completed, variance_note AS variance
         FROM pc49.gold_conversion WHERE id = $1`, [saved.conversionId])
    expect(conv.rows[0]).toEqual({ doc_no: saved.docNo, kind: 'TRANSFER', completed: true, variance: null })
    expect(saved.docNo).toMatch(/^PC49-2606-\d{3}$/)

    const legs = await legsOf(saved.conversionId)
    expect(legs.map((l) => [l.txn_type, l.gold_type_code, l.qty])).toEqual([
      ['TRANSFER_OUT', 'GRAIN', '-637.5'], ['TRANSFER_IN', 'RP', '17'],
    ])
    expect(legs.every((l) => l.doc_no === saved.docNo && l.posted)).toBe(true)
  })

  it('weighs ounces and luong in grams, and finds the Nini exchange in balance', async () => {
    const saved = await saveConversion('nini', conversionPayload(NINI))
    const legs = await legsOf(saved.conversionId)
    expect(legs.map((l) => [l.gold_type_code, Number(l.grams)])).toEqual([
      ['RP', -150], ['CS', 62.21], ['OTH', 31.105], ['GRAIN', 56.7],
    ])
    const conv = await db.query<{ variance: string | null; partner: string }>(
      `SELECT variance_note AS variance, partner_code AS partner FROM pc49.gold_conversion WHERE id = $1`,
      [saved.conversionId])
    expect(conv.rows[0]).toEqual({ variance: null, partner: 'Nini' })
  })

  it('refuses weights that do not meet, unless somebody says why', async () => {
    const short = { ...NINI, in: [NINI.in[0], NINI.in[1], { goldTypeCode: 'GRAIN', uom: 'GRAM' as const, qty: 50 }] }
    const before = await conversionCount()
    await expect(saveConversion('short', conversionPayload(short)))
      .rejects.toThrow(/CONVERSION_UNBALANCED: out 150\.0000 in 143\.3150/)
    expect(await conversionCount()).toBe(before)

    const saved = await saveConversion('short-explained',
      conversionPayload(short, { varianceReason: 'hao hut khi nau' }))
    const conv = await db.query<{ note: string | null; reason: string }>(
      `SELECT variance_note AS note, variance_reason AS reason FROM pc49.gold_conversion WHERE id = $1`,
      [saved.conversionId])
    expect(conv.rows[0].note).toMatch(/percent difference/)
    expect(conv.rows[0].reason).toBe('hao hut khi nau')
  })

  it('writes Ra RP as Ra RP, and only from Grain into Rong Phung', async () => {
    const raRp = {
      kind: 'RA_RP' as const,
      out: [{ goldTypeCode: 'GRAIN', uom: 'GRAM' as const, qty: 600 }],
      in: [{ goldTypeCode: 'RP', uom: 'LUONG' as const, qty: 16 }],
    }
    const saved = await saveConversion('ra-rp', conversionPayload(raRp))
    expect((await legsOf(saved.conversionId)).map((l) => l.txn_type)).toEqual(['RA_RP', 'RA_RP'])

    await expect(saveConversion('ra-rp-wrong', conversionPayload({
      ...raRp, out: [{ goldTypeCode: '9999', uom: 'LUONG', qty: 16 }],
    }))).rejects.toThrow(/CONVERSION_RA_RP/)
  })

  it('needs something on both sides, and a quantity on every line', async () => {
    await expect(saveConversion('one-side', conversionPayload({ ...GRAIN_TO_RP, in: [] })))
      .rejects.toThrow(/CONVERSION_SIDES/)
    await expect(saveConversion('no-qty', conversionPayload({
      ...GRAIN_TO_RP, in: [{ goldTypeCode: 'RP', uom: 'LUONG', qty: 0 }],
    }))).rejects.toThrow(/CONVERSION_QTY: in 1/)
  })

  it('is one conversion however many times it is saved', async () => {
    const body = conversionPayload(GRAIN_TO_RP, { note: 'hai lan' })
    const first = await saveConversion('twice', body)
    const again = await saveConversion('twice', body)
    expect(first.repeated).toBe(false)
    expect(again).toEqual({ conversionId: first.conversionId, docNo: first.docNo, repeated: true })
    await expect(saveConversion('twice', conversionPayload(GRAIN_TO_RP, { note: 'khac' })))
      .rejects.toThrow(/REQUEST_KEY_REUSED/)
  })

  it('is refused to somebody who may only read', async () => {
    await expect(saveConversion('supervisor', conversionPayload(GRAIN_TO_RP), GS)).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/conversion-entry.test.ts --maxWorkers=4`
Expected: 5 test của Task 1 PASS; khối mới FAIL — `function pc49.save_gold_conversion(unknown, jsonb) does not exist`.

- [ ] **Step 4: Viết migration**

Tạo `supabase/migrations/0078_a_conversion_is_saved_whole.sql`:

```sql
-- 0078_a_conversion_is_saved_whole.sql
-- Saving a conversion: gold out, gold in, weighed, numbered and posted in one call.
--
--   conversion_line_grams   a line's weight in grams, by its unit
--   write_gold_conversion   the body: checks, the conversion row, its legs, the
--                           posting, and completion so 0014's trigger weighs it
--   conversion_answer       what a repeated request is answered with
--   save_gold_conversion    the request key around the body (0054)
--
-- Refusals start with a code the screen translates:
--
--   CONVERSION_KIND         a kind this screen does not write
--   CONVERSION_SIDES        a side with no lines, or more than 30
--   CONVERSION_QTY          a line with no quantity: "out 2", "in 1"
--   CONVERSION_RA_RP        Ra RP with anything but Grain out and Rong Phung in
--   CONVERSION_UNBALANCED   grams out and in further apart than
--                           CONVERSION_WEIGHT_TOLERANCE_PCT allows, with no
--                           reason given; carries both weights, the percent and
--                           the tolerance so the screen can say them
--
-- Legs carry no money and no price, as the 81 loaded legs do, and post as
-- weight only (0015). A leg's sign comes from its side, never from what was typed.

CREATE OR REPLACE FUNCTION pc49.conversion_line_grams(p_line jsonb)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT abs((p_line ->> 'qty')::numeric) * f.gram_per_unit
    FROM pc49.uom_factor f
   WHERE f.uom = (p_line ->> 'uom')::pc49.uom
$$;

CREATE OR REPLACE FUNCTION pc49.write_gold_conversion(
  p_payload  jsonb,
  p_doc_no   text DEFAULT NULL,
  p_corrects uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_kind   text := p_payload ->> 'kind';
  v_date   date := (p_payload ->> 'convDate')::date;
  v_out    jsonb := coalesce(p_payload -> 'out', '[]'::jsonb);
  v_in     jsonb := coalesce(p_payload -> 'in', '[]'::jsonb);
  v_no     int;
  v_ni     int;
  v_out_g  numeric;
  v_in_g   numeric;
  v_pct    numeric;
  v_tol    numeric;
  v_doc    text;
  v_conv   uuid;
  v_line   jsonb;
  v_txn    uuid;
  v_first  uuid;
  v_i      int;
BEGIN
  IF v_kind IS NULL OR v_kind NOT IN ('TRANSFER', 'RA_RP') THEN
    RAISE EXCEPTION 'CONVERSION_KIND: a conversion entered here is TRANSFER or RA_RP, not %', v_kind;
  END IF;
  IF jsonb_typeof(v_out) <> 'array' OR jsonb_typeof(v_in) <> 'array' THEN
    RAISE EXCEPTION 'CONVERSION_SIDES: a conversion has lines out and lines in';
  END IF;
  v_no := jsonb_array_length(v_out);
  v_ni := jsonb_array_length(v_in);
  IF v_no < 1 OR v_ni < 1 OR v_no > 30 OR v_ni > 30 THEN
    RAISE EXCEPTION 'CONVERSION_SIDES: each side holds 1 to 30 lines; this one has % out and % in', v_no, v_ni;
  END IF;
  FOR v_i IN 1..v_no LOOP
    IF coalesce(nullif(v_out -> (v_i - 1) ->> 'qty', '')::numeric, 0) = 0 THEN
      RAISE EXCEPTION 'CONVERSION_QTY: out % has no quantity', v_i;
    END IF;
  END LOOP;
  FOR v_i IN 1..v_ni LOOP
    IF coalesce(nullif(v_in -> (v_i - 1) ->> 'qty', '')::numeric, 0) = 0 THEN
      RAISE EXCEPTION 'CONVERSION_QTY: in % has no quantity', v_i;
    END IF;
  END LOOP;
  IF v_kind = 'RA_RP'
     AND (EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) l WHERE l ->> 'goldTypeCode' <> 'GRAIN')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_in) l WHERE l ->> 'goldTypeCode' <> 'RP')) THEN
    RAISE EXCEPTION 'CONVERSION_RA_RP: Ra RP turns Grain into Rong Phung and nothing else';
  END IF;

  SELECT coalesce(sum(pc49.conversion_line_grams(l)), 0) INTO v_out_g
    FROM jsonb_array_elements(v_out) l;
  SELECT coalesce(sum(pc49.conversion_line_grams(l)), 0) INTO v_in_g
    FROM jsonb_array_elements(v_in) l;
  SELECT value INTO v_tol FROM pc49.system_param WHERE key = 'CONVERSION_WEIGHT_TOLERANCE_PCT';
  v_pct := abs(v_in_g - v_out_g) / v_out_g * 100;
  IF v_pct > coalesce(v_tol, 0)
     AND btrim(coalesce(p_payload ->> 'varianceReason', '')) = '' THEN
    RAISE EXCEPTION 'CONVERSION_UNBALANCED: out % in % pct % tolerance %',
      round(v_out_g, 4), round(v_in_g, 4), round(v_pct, 4), v_tol;
  END IF;

  -- A correction keeps the number of what it corrects (0057).
  v_doc := coalesce(nullif(btrim(p_doc_no), ''), pc49.next_doc_no(v_date));

  INSERT INTO pc49.gold_conversion
    (conv_date, kind, note, doc_no, partner_code, variance_reason,
     corrects_conversion_id, created_by, updated_by)
  VALUES (v_date, v_kind::pc49.conversion_kind,
          nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
          v_doc,
          nullif(btrim(coalesce(p_payload ->> 'partnerCode', '')), ''),
          nullif(btrim(coalesce(p_payload ->> 'varianceReason', '')), ''),
          p_corrects, v_actor, v_actor)
  RETURNING id INTO v_conv;

  FOR v_i IN 1..v_no LOOP
    v_line := v_out -> (v_i - 1);
    INSERT INTO pc49.gold_txn
      (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code, remarks,
       conversion_id, doc_no, line_no, created_by)
    VALUES (v_date,
            (CASE WHEN v_kind = 'RA_RP' THEN 'RA_RP' ELSE 'TRANSFER_OUT' END)::pc49.txn_type,
            v_line ->> 'goldTypeCode', (v_line ->> 'uom')::pc49.uom,
            -abs((v_line ->> 'qty')::numeric), 0,
            nullif(btrim(coalesce(p_payload ->> 'partnerCode', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
            v_conv, v_doc, v_i, v_actor)
    RETURNING id INTO v_txn;
    PERFORM pc49.post_gold_txn(v_txn);
    IF v_i = 1 THEN v_first := v_txn; END IF;
  END LOOP;

  FOR v_i IN 1..v_ni LOOP
    v_line := v_in -> (v_i - 1);
    INSERT INTO pc49.gold_txn
      (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code, remarks,
       conversion_id, doc_no, line_no, created_by)
    VALUES (v_date,
            (CASE WHEN v_kind = 'RA_RP' THEN 'RA_RP' ELSE 'TRANSFER_IN' END)::pc49.txn_type,
            v_line ->> 'goldTypeCode', (v_line ->> 'uom')::pc49.uom,
            abs((v_line ->> 'qty')::numeric), 0,
            nullif(btrim(coalesce(p_payload ->> 'partnerCode', '')), ''),
            nullif(btrim(coalesce(p_payload ->> 'note', '')), ''),
            v_conv, v_doc, v_i, v_actor)
    RETURNING id INTO v_txn;
    PERFORM pc49.post_gold_txn(v_txn);
  END LOOP;

  -- Completed once every leg is in, which is when 0014's trigger weighs it and
  -- writes variance_note if the two sides are further apart than the tolerance.
  UPDATE pc49.gold_conversion SET completed_at = now(), updated_by = v_actor WHERE id = v_conv;

  RETURN jsonb_build_object('conversionId', v_conv, 'docNo', v_doc, 'firstTxnId', v_first);
END $$;

/** What a repeated request is answered with: the conversion its first leg belongs to. */
CREATE OR REPLACE FUNCTION pc49.conversion_answer(p_first_txn uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('conversionId', t.conversion_id, 'docNo', t.doc_no)
    FROM pc49.gold_txn t WHERE t.id = p_first_txn
$$;

CREATE OR REPLACE FUNCTION pc49.save_gold_conversion(
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
    RETURN pc49.conversion_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  v_made := pc49.write_gold_conversion(p_payload);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'save_gold_conversion', v_hash,
          (v_made ->> 'firstTxnId')::uuid);

  RETURN jsonb_build_object('conversionId', v_made -> 'conversionId', 'docNo', v_made -> 'docNo',
                            'repeated', false);
END $$;

GRANT EXECUTE ON FUNCTION pc49.conversion_line_grams(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.write_gold_conversion(jsonb, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.conversion_answer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.save_gold_conversion(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0078_a_conversion_is_saved_whole')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 5: Chạy test**

Run: `npx vitest run tests/sql/conversion-entry.test.ts --maxWorkers=4`
Expected: PASS, 12 test.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0078_a_conversion_is_saved_whole.sql tests/support/conversion.ts tests/sql/conversion-entry.test.ts
git commit -m "feat(conversion): a conversion is weighed, numbered and posted in one call"
```

### Task 3: Sửa và huỷ cả phiên

**Files:**
- Create: `supabase/migrations/0079_a_conversion_is_corrected_whole.sql`
- Modify: `tests/sql/conversion-entry.test.ts` (thêm ở cuối)

**Interfaces:**
- Consumes: `write_gold_conversion`, `conversion_answer` (Task 2); `correction_blocked_code` (Task 1); `void_gold_txn(uuid, text, date)` (0034).
- Produces:
  - `pc49.refuse_blocked_conversion_legs(p_conv uuid) RETURNS void`;
  - `pc49.correct_gold_conversion(p_request_key text, p_original uuid, p_expected_revision int, p_reason text, p_payload jsonb, p_reversal_date date DEFAULT NULL) RETURNS jsonb` → `{conversionId, docNo, repeated, replaced}`;
  - `pc49.void_gold_conversion(p_original uuid, p_reason text, p_on_date date DEFAULT NULL) RETURNS int` (số vế đã huỷ).

- [ ] **Step 1: Viết test hỏng**

Thêm vào cuối `tests/sql/conversion-entry.test.ts`:

```ts
async function correctConversion(key: string, original: string, revision: number, body: string,
  reason = 'bot 1 oz Other'): Promise<SavedConversion & { replaced?: string }> {
  const r = await asRole(db, KT, () => db.query<{ r: SavedConversion & { replaced?: string } }>(
    `SELECT pc49.correct_gold_conversion($1, $2, $3, $4, $5::jsonb) AS r`,
    [key, original, revision, reason, body]))
  return r.rows[0].r
}

async function voidConversion(original: string, reason = 'nhap trung'): Promise<number> {
  const r = await asRole(db, KT, () => db.query<{ n: number }>(
    `SELECT pc49.void_gold_conversion($1, $2) AS n`, [original, reason]))
  return r.rows[0].n
}

const revisionOfConversion = async (id: string) => (await db.query<{ revision: number }>(
  `SELECT revision FROM pc49.gold_conversion WHERE id = $1`, [id])).rows[0].revision

const liveLegs = async (conversionId: string) => (await db.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM pc49.gold_txn WHERE conversion_id = $1 AND voided_at IS NULL`,
  [conversionId])).rows[0].n

/** Nini without the ounce of Other, made up with 31.105 g of Grain. */
const niniCorrected = conversionPayload({
  ...NINI,
  in: [NINI.in[0], { goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 56.7 }, { goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 31.105 }],
})

describe('correcting a conversion', () => {
  it('replaces every leg in one go and keeps the number', async () => {
    const saved = await saveConversion('fix-nini', conversionPayload(NINI))
    const fixed = await correctConversion('fix-nini-it', saved.conversionId,
      await revisionOfConversion(saved.conversionId), niniCorrected)
    expect(fixed.docNo).toBe(saved.docNo)
    expect(fixed.conversionId).not.toBe(saved.conversionId)

    const old = await db.query<{ voided: boolean; why: string }>(
      `SELECT voided_at IS NOT NULL AS voided, void_reason AS why FROM pc49.gold_conversion WHERE id = $1`,
      [saved.conversionId])
    expect(old.rows[0]).toEqual({ voided: true, why: 'bot 1 oz Other' })
    expect(await liveLegs(saved.conversionId)).toBe('0')

    const replacement = await db.query<{ corrects: string; legs: string; posted: string }>(
      `SELECT c.corrects_conversion_id::text AS corrects,
              (SELECT count(*)::text FROM pc49.gold_txn t WHERE t.conversion_id = c.id) AS legs,
              (SELECT count(*)::text FROM pc49.gold_txn t
                WHERE t.conversion_id = c.id AND t.journal_entry_id IS NOT NULL) AS posted
         FROM pc49.gold_conversion c WHERE c.id = $1`, [fixed.conversionId])
    expect(replacement.rows[0]).toEqual({ corrects: saved.conversionId, legs: '4', posted: '4' })
  })

  it('tells the second person to look again rather than overwrite', async () => {
    const saved = await saveConversion('race-conv', conversionPayload(NINI))
    const seen = await revisionOfConversion(saved.conversionId)
    await correctConversion('race-conv-1', saved.conversionId, seen, niniCorrected)
    await expect(correctConversion('race-conv-2', saved.conversionId, seen, niniCorrected))
      .rejects.toThrow(/CONFLICT/)
  })

  it('corrects a loaded conversion under the smallest number its legs carry', async () => {
    const c = await rawConversion('TRANSFER', '2026-06-03#1')
    await rawLeg({ type: 'TRANSFER_OUT', gold: '9999', uom: 'LUONG', qty: -1, conversionId: c, doc: 'PC49-2606-777' })
    await rawLeg({ type: 'TRANSFER_IN', gold: 'GRAIN', uom: 'GRAM', qty: 37.5, conversionId: c, doc: 'PC49-2606-775' })
    const fixed = await correctConversion('fix-loaded', c, await revisionOfConversion(c), conversionPayload({
      kind: 'TRANSFER',
      out: [{ goldTypeCode: '9999', uom: 'LUONG', qty: 1 }],
      in: [{ goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 37.5 }],
    }), 'tach phien nap')
    expect(fixed.docNo).toBe('PC49-2606-775')
    expect(await liveLegs(c)).toBe('0')
  })

  it('leaves a refining lot conversion to the refining screen', async () => {
    const c = await rawConversion('REFINING_SEND')
    await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -10, conversionId: c })
    await expect(correctConversion('fix-refining', c, await revisionOfConversion(c),
      conversionPayload(GRAIN_TO_RP))).rejects.toThrow(/CONVERSION_REFINING/)
    await expect(voidConversion(c)).rejects.toThrow(/CONVERSION_REFINING/)
  })

  it('returns the first correction when asked twice', async () => {
    const saved = await saveConversion('fix-twice-conv', conversionPayload(NINI, { note: 'hai lan sua' }))
    const seen = await revisionOfConversion(saved.conversionId)
    const first = await correctConversion('fix-twice-conv-it', saved.conversionId, seen, niniCorrected)
    const again = await correctConversion('fix-twice-conv-it', saved.conversionId, seen, niniCorrected)
    expect(again).toEqual({ conversionId: first.conversionId, docNo: first.docNo, repeated: true })
  })
})

describe('cancelling a conversion', () => {
  it('cancels every leg at once and gives the stock back', async () => {
    const saved = await saveConversion('cancel-conv', conversionPayload(GRAIN_TO_RP, { note: 'huy' }))
    expect(await voidConversion(saved.conversionId)).toBe(2)
    const state = await db.query<{ live: string; voided: boolean; grams: string }>(
      `SELECT (SELECT count(*)::text FROM pc49.gold_txn
                WHERE conversion_id = $1 AND voided_at IS NULL) AS live,
              (SELECT voided_at IS NOT NULL FROM pc49.gold_conversion WHERE id = $1) AS voided,
              (SELECT coalesce(sum(m.qty_gram), 0)::float8::text
                 FROM pc49.inventory_movement m JOIN pc49.gold_txn t ON t.id = m.source_id
                WHERE t.conversion_id = $1) AS grams`, [saved.conversionId])
    expect(state.rows[0]).toEqual({ live: '0', voided: true, grams: '0' })
    await expect(voidConversion(saved.conversionId)).rejects.toThrow(/CONVERSION_VOIDED/)
  })
})
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/conversion-entry.test.ts --maxWorkers=4`
Expected: 12 test cũ PASS; khối mới FAIL — `function pc49.correct_gold_conversion(...) does not exist`.

- [ ] **Step 3: Viết migration**

Tạo `supabase/migrations/0079_a_conversion_is_corrected_whole.sql`:

```sql
-- 0079_a_conversion_is_corrected_whole.sql
-- Correcting and cancelling a conversion, every leg at once.
--
--   refuse_blocked_conversion_legs   stops at the first leg something else
--                                    points at, naming it "out 2" or "in 1".
--                                    CONVERSION_LEG is not such a thing: it is
--                                    the reason a single leg is corrected here,
--                                    as part of its conversion.
--   correct_gold_conversion          reverses every leg and writes the corrected
--                                    conversion in one transaction, keeping its
--                                    number; a loaded conversion has none of its
--                                    own and keeps the smallest its legs carry,
--                                    which is the one the ledger shows
--   void_gold_conversion             reverses every leg
--
-- A refining lot's conversion (REFINING_SEND, REFINING_RECEIVE) belongs to the
-- refining screen: CONVERSION_REFINING. One already cancelled: CONVERSION_VOIDED.

CREATE OR REPLACE FUNCTION pc49.refuse_blocked_conversion_legs(p_conv uuid)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_leg  record;
  v_code text;
BEGIN
  FOR v_leg IN
    SELECT x.id, x.side, x.n
      FROM (SELECT t.id,
                   CASE WHEN t.qty < 0 THEN 'out' ELSE 'in' END AS side,
                   row_number() OVER (PARTITION BY t.qty < 0
                                      ORDER BY coalesce(t.line_no, 1), t.created_at, t.id) AS n
              FROM pc49.gold_txn t
             WHERE t.conversion_id = p_conv AND t.voided_at IS NULL) x
     ORDER BY x.side DESC, x.n
  LOOP
    v_code := pc49.correction_blocked_code(v_leg.id);
    IF v_code IS NOT NULL AND v_code <> 'CONVERSION_LEG' THEN
      RAISE EXCEPTION 'LINE_BLOCKED: % % % cannot be changed here', v_leg.side, v_leg.n, v_code;
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION pc49.correct_gold_conversion(
  p_request_key       text,
  p_original          uuid,
  p_expected_revision int,
  p_reason            text,
  p_payload           jsonb,
  p_reversal_date     date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_hash  text := md5(p_payload::text);
  v_seen  pc49.request_outcome;
  v_conv  pc49.gold_conversion;
  v_ids   uuid[];
  v_id    uuid;
  v_doc   text;
  v_made  jsonb;
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
    RETURN pc49.conversion_answer(v_seen.txn_id) || jsonb_build_object('repeated', true);
  END IF;

  -- Locked first, the conversion and its legs, so two people correcting it
  -- cannot both win: the second waits, then finds the revision has moved.
  SELECT * INTO v_conv FROM pc49.gold_conversion WHERE id = p_original FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'there is no such conversion'; END IF;
  PERFORM 1 FROM pc49.gold_txn t WHERE t.conversion_id = p_original FOR UPDATE;

  IF v_conv.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'CONFLICT: somebody else changed this conversion; look again before correcting it';
  END IF;
  IF v_conv.kind IN ('REFINING_SEND', 'REFINING_RECEIVE') THEN
    RAISE EXCEPTION 'CONVERSION_REFINING: this conversion belongs to a refining lot; correct it on the refining screen';
  END IF;

  SELECT array_agg(t.id ORDER BY t.created_at, t.id) INTO v_ids
    FROM pc49.gold_txn t WHERE t.conversion_id = p_original AND t.voided_at IS NULL;
  IF v_conv.voided_at IS NOT NULL OR v_ids IS NULL THEN
    RAISE EXCEPTION 'CONVERSION_VOIDED: this conversion has already been cancelled';
  END IF;

  PERFORM pc49.refuse_blocked_conversion_legs(p_original);

  v_doc := coalesce(v_conv.doc_no,
                    (SELECT min(t.doc_no) FROM pc49.gold_txn t WHERE t.conversion_id = p_original));

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pc49.void_gold_txn(v_id, p_reason, p_reversal_date);
  END LOOP;
  UPDATE pc49.gold_conversion
     SET voided_at = now(), void_reason = p_reason, updated_by = v_actor
   WHERE id = p_original;

  v_made := pc49.write_gold_conversion(p_payload, v_doc, p_original);

  INSERT INTO pc49.request_outcome (actor, request_key, operation, payload_hash, txn_id)
  VALUES (v_actor, p_request_key, 'correct_gold_conversion', v_hash,
          (v_made ->> 'firstTxnId')::uuid);

  RETURN jsonb_build_object('conversionId', v_made -> 'conversionId', 'docNo', v_made -> 'docNo',
                            'repeated', false, 'replaced', p_original);
END $$;

CREATE OR REPLACE FUNCTION pc49.void_gold_conversion(
  p_original uuid,
  p_reason   text,
  p_on_date  date DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pc49, public, auth AS $$
DECLARE
  v_conv pc49.gold_conversion;
  v_ids  uuid[];
  v_id   uuid;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'voiding a transaction needs a reason';
  END IF;

  SELECT * INTO v_conv FROM pc49.gold_conversion WHERE id = p_original FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'there is no such conversion'; END IF;
  IF v_conv.kind IN ('REFINING_SEND', 'REFINING_RECEIVE') THEN
    RAISE EXCEPTION 'CONVERSION_REFINING: this conversion belongs to a refining lot; correct it on the refining screen';
  END IF;
  PERFORM 1 FROM pc49.gold_txn t WHERE t.conversion_id = p_original FOR UPDATE;

  SELECT array_agg(t.id ORDER BY t.created_at, t.id) INTO v_ids
    FROM pc49.gold_txn t WHERE t.conversion_id = p_original AND t.voided_at IS NULL;
  IF v_conv.voided_at IS NOT NULL OR v_ids IS NULL THEN
    RAISE EXCEPTION 'CONVERSION_VOIDED: this conversion has already been cancelled';
  END IF;

  PERFORM pc49.refuse_blocked_conversion_legs(p_original);

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pc49.void_gold_txn(v_id, p_reason, p_on_date);
  END LOOP;
  UPDATE pc49.gold_conversion
     SET voided_at = now(), void_reason = p_reason, updated_by = auth.uid()
   WHERE id = p_original;

  RETURN array_length(v_ids, 1);
END $$;

GRANT EXECUTE ON FUNCTION pc49.refuse_blocked_conversion_legs(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION
  pc49.correct_gold_conversion(text, uuid, int, text, jsonb, date) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.void_gold_conversion(uuid, text, date) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0079_a_conversion_is_corrected_whole')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/sql/conversion-entry.test.ts tests/sql/conversion.test.ts tests/sql/void-txn.test.ts --maxWorkers=4`
Expected: PASS (conversion-entry 18 test).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0079_a_conversion_is_corrected_whole.sql tests/sql/conversion-entry.test.ts
git commit -m "feat(conversion): a conversion is corrected and cancelled whole"
```

### Task 4: Sổ nhóm theo phiên quy đổi

**Files:**
- Create: `supabase/migrations/0080_the_ledger_lists_conversions.sql`
- Create: `tests/sql/conversion-ledger.test.ts`

**Interfaces:**
- Consumes: `save_gold_conversion` (Task 2); `save_gold_receipt` (0074); `REFINING_LEG` (Task 1); `tests/support/conversion.ts`, `tests/support/receipt.ts`.
- Produces:
  - khoá sổ `coalesce(receipt_id, conversion_id, id)` trong `receipt_live_lines`, `gold_receipt_locked`, `gold_receipt_ledger_match`, `gold_receipt_lines`, `gold_receipt_payments`, `gold_receipt_sold_by`, `gold_receipt_ledger`, `gold_receipt_ledger_totals`;
  - `pc49.gold_receipt_blocked_code(p_key uuid) RETURNS text`;
  - phần tử `lines` có thêm `side` (`'out'` | `'in'` | `null`); `lineNo` đánh số trong từng bên;
  - `gold_receipt_ledger` trả thêm `conversion_id uuid, conversion_kind text, variance_note text, variance_reason text` (đứng trước `total_count`).

- [ ] **Step 1: Viết test hỏng**

Tạo `tests/sql/conversion-ledger.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDb } from '../support/db'
import { NINI, conversionPayload } from '../support/conversion'
import { SIX_ITEMS, purchaseLine, receiptPayload } from '../support/receipt'

const KT = '11111111-1111-1111-1111-111111111111'

type Row = {
  receipt_key: string; doc_no: string; txn_type: string; partner_code: string | null
  remarks: string | null; revision: number; blocked_code: string | null; amount: string
  line_count: number; total_count: string
  lines: { lineNo: number; side: string | null; goldTypeCode: string }[]
  conversion_id: string | null; conversion_kind: string | null
  variance_note: string | null; variance_reason: string | null
}

type Filters = {
  from?: string; to?: string; type?: string; gold?: string; staff?: string
  method?: string; status?: string; query?: string
}
const ARGS = `p_from => $1, p_to => $2, p_type => $3, p_gold => $4, p_staff => $5,
              p_method => $6, p_status => $7, p_query => $8`
const params = (f: Filters) => [f.from ?? null, f.to ?? null, f.type ?? null, f.gold ?? null,
  f.staff ?? null, f.method ?? null, f.status ?? null, f.query ?? null]

let db: PGlite
const doc = { R: '', B: '', N: '', V: '', I: 'PC49-2604-900', L: 'PC49-2604-950' }
const key = { N: '', I: '' }

async function ledger(f: Filters = {}) {
  const r = await db.query<Row>(
    `SELECT receipt_key, doc_no, txn_type, partner_code, remarks, revision, blocked_code,
            amount::text, line_count, total_count::text, lines,
            conversion_id, conversion_kind, variance_note, variance_reason
       FROM pc49.gold_receipt_ledger(${ARGS})`, params(f))
  return r.rows
}
const docs = async (f: Filters = {}) => (await ledger(f)).map((r) => r.doc_no)
const row = async (docNo: string) => (await ledger()).find((r) => r.doc_no === docNo) as Row

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'accountant@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
  `)
  const call = async <T>(sql: string, args: unknown[]) =>
    (await asRole(db, KT, () => db.query<{ r: T }>(sql, args))).rows[0].r

  // R: a receipt of one item.
  const r = await call<{ docNo: string }>(`SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, ['R',
    receiptPayload({ txnDate: '2026-04-10', partnerCode: 'KHACH R', lines: [purchaseLine(SIX_ITEMS[0])],
                     payments: [{ amount: 950, method: 'CASH' }] })])
  // B: a transaction saved before receipts.
  const b = await call<{ txnId: string }>(`SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`, ['B',
    JSON.stringify({ txnDate: '2026-04-11', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM', qty: 10,
      unitPrice: 50, amount: -500, partnerCode: 'KHACH B', scrapDetail: null, goldPct: null,
      remarks: null, payments: [{ amount: 500, method: 'CASH' }], salesPeople: [] })])
  // N: the Nini exchange.
  const n = await call<{ conversionId: string; docNo: string }>(
    `SELECT pc49.save_gold_conversion($1, $2::jsonb) AS r`,
    ['N', conversionPayload(NINI, { convDate: '2026-04-12', note: 'doi voi Nini' })])
  // V: a melt that came up short, explained.
  const v = await call<{ docNo: string }>(`SELECT pc49.save_gold_conversion($1, $2::jsonb) AS r`, ['V',
    conversionPayload({ kind: 'TRANSFER',
      out: [{ goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 1000 }],
      in: [{ goldTypeCode: 'PT', uom: 'GRAM', qty: 900 }] },
    { convDate: '2026-04-14', varianceReason: 'hao hut' })])

  // I: a conversion as the loader wrote it: no number of its own, each leg its own number.
  const i = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_conversion (conv_date, kind, note)
     VALUES ('2026-04-15', 'TRANSFER', '2026-04-15#1') RETURNING id`)
  for (const [type, gold, uom, qty, d] of [
    ['TRANSFER_OUT', '9999', 'LUONG', -1, 'PC49-2604-901'],
    ['TRANSFER_IN', 'GRAIN', 'GRAM', 37.5, 'PC49-2604-900'],
  ] as const) {
    await db.query(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount,
                                  conversion_id, doc_no, remarks)
       VALUES ('2026-04-15', $1, $2, $3, $4, 0, $5, $6, 'Transfer 1L vang 9999 ra 37.5gr vang Grain')`,
      [type, gold, uom, qty, i.rows[0].id, d])
  }

  // L: a refining lot's transfer out, a row of its own.
  const lot = await db.query<{ id: string }>(
    `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.CONV') RETURNING id`)
  await db.query(
    `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount, refining_lot_id, doc_no)
     VALUES ('2026-04-16', 'TRANSFER_OUT', 'SG', 'GRAM', -30, 0, $1, 'PC49-2604-950')`, [lot.rows[0].id])

  const bDoc = await db.query<{ doc_no: string }>(`SELECT doc_no FROM pc49.gold_txn WHERE id = $1`, [b.txnId])
  Object.assign(doc, { R: r.docNo, B: bDoc.rows[0].doc_no, N: n.docNo, V: v.docNo })
  Object.assign(key, { N: n.conversionId, I: i.rows[0].id })
}, 180_000)

afterAll(async () => { await db?.close() })

describe('the ledger, a conversion a row', () => {
  it('lists each conversion once, beside receipts and single rows', async () => {
    const rows = await ledger()
    expect(rows.map((r) => r.doc_no)).toEqual([doc.L, doc.I, doc.V, doc.N, doc.B, doc.R])
    expect(rows.map((r) => r.line_count)).toEqual([1, 2, 2, 4, 1, 1])
    expect(rows.map((r) => r.conversion_id !== null)).toEqual([false, true, true, true, false, false])
  })

  it('shows a conversion by its own number, partner and note, its legs by side', async () => {
    const n = await row(doc.N)
    expect(n).toMatchObject({
      receipt_key: key.N, conversion_kind: 'TRANSFER', partner_code: 'Nini',
      remarks: 'doi voi Nini', variance_note: null,
    })
    expect(Number(n.amount)).toBe(0)
    expect(n.lines.map((l) => [l.side, l.lineNo, l.goldTypeCode])).toEqual([
      ['out', 1, 'RP'], ['in', 1, 'CS'], ['in', 2, 'OTH'], ['in', 3, 'GRAIN'],
    ])
  })

  it('carries the variance and the reason given for it', async () => {
    const v = await row(doc.V)
    expect(v.variance_note).toMatch(/percent difference/)
    expect(v.variance_reason).toBe('hao hut')
  })

  it('shows a loaded conversion by its smallest number and its legs’ remarks', async () => {
    const i = await row(doc.I)
    expect(i).toMatchObject({
      receipt_key: key.I, remarks: 'Transfer 1L vang 9999 ra 37.5gr vang Grain', revision: 1,
    })
  })

  it('lets a conversion be corrected as a whole, and locks a refining lot leg', async () => {
    expect((await row(doc.N)).blocked_code).toBeNull()
    expect((await row(doc.I)).blocked_code).toBeNull()
    expect((await row(doc.L)).blocked_code).toBe('REFINING_LEG')
    expect(await docs({ status: 'locked' })).toEqual([doc.L])
    expect(await docs({ status: 'correctable' })).toEqual([doc.I, doc.V, doc.N, doc.B, doc.R])
  })

  it('finds a conversion by any one of its legs', async () => {
    expect(await docs({ gold: 'CS' })).toEqual([doc.N])
    expect(await docs({ query: 'nini' })).toEqual([doc.N])
    expect(await docs({ type: 'TRANSFER_IN' })).toEqual([doc.I, doc.V, doc.N])
  })

  it('counts a conversion once', async () => {
    expect((await ledger())[0].total_count).toBe('6')
    const totals = await db.query<{ n: string }>(
      `SELECT receipt_count::text AS n FROM pc49.gold_receipt_ledger_totals(${ARGS})`, params({}))
    expect(totals.rows[0].n).toBe('6')
  })

  it('checks each line inside the query rather than calling a function per row', async () => {
    const plan = await db.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT count(*) FROM pc49.gold_txn t
        WHERE pc49.gold_receipt_ledger_match(t, NULL::date, NULL::date, NULL, NULL, NULL, NULL, NULL, NULL)`)
    expect(plan.rows.map((r) => r['QUERY PLAN']).join(' ')).not.toContain('gold_receipt_ledger_match')
  })

  it('does not let the receipt functions cancel a conversion', async () => {
    await expect(asRole(db, KT, () => db.query(
      `SELECT pc49.void_gold_receipt($1, 'nham cho')`, [key.N]))).rejects.toThrow(/LINE_BLOCKED/)
  })
})
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run tests/sql/conversion-ledger.test.ts --maxWorkers=4`
Expected: FAIL — `column "conversion_id" does not exist` (sổ chưa trả cột quy đổi).

- [ ] **Step 3: Viết migration**

Tạo `supabase/migrations/0080_the_ledger_lists_conversions.sql`:

```sql
-- 0080_the_ledger_lists_conversions.sql
-- A conversion is one row of the gold ledger, as a receipt is.
--
-- The ledger's key becomes coalesce(receipt_id, conversion_id, id) in every
-- function 0075 and 0076 wrote around it. A refining lot's leg has no
-- conversion and stays a row of its own, locked by REFINING_LEG (0077).
--
--   receipt_live_lines          the live lines behind a key, a conversion's legs
--                               too, so a receipt function handed a conversion's
--                               key refuses it: every leg is CONVERSION_LEG
--   gold_receipt_blocked_code   why a row may not be corrected: a receipt's first
--                               blocked item, as 0076 read it; for a conversion,
--                               its legs' codes other than CONVERSION_LEG, and
--                               REFINING_LEG for a refining lot's conversion
--   gold_receipt_locked         that code, not null
--   gold_receipt_lines          each line also says its side of a conversion
--                               ("out", "in"), numbered within the side
--   gold_receipt_ledger         also returns the conversion, its kind and its
--                               variance. A conversion row shows the conversion's
--                               number, partner, note and revision. A loaded
--                               conversion has no number of its own and shows the
--                               smallest of its legs'; its note is the loader's
--                               key, so its first leg's remarks show instead
--   gold_receipt_ledger_totals  counts a conversion once

CREATE OR REPLACE FUNCTION pc49.receipt_live_lines(p_key uuid)
RETURNS TABLE (txn_id uuid, line_no int)
LANGUAGE sql STABLE AS $$
  SELECT t.id, coalesce(t.line_no, 1)
    FROM pc49.gold_txn t
   WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
          OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
     AND t.voided_at IS NULL
   ORDER BY CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END,
            coalesce(t.line_no, 1), t.created_at, t.id
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_blocked_code(p_key uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN c.kind IN ('REFINING_SEND', 'REFINING_RECEIVE') THEN 'REFINING_LEG'
    ELSE (SELECT x.code
            FROM (SELECT pc49.correction_blocked_code(t.id) AS code,
                         CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END AS side_rank,
                         coalesce(t.line_no, 1) AS line_no, t.created_at, t.id
                    FROM pc49.gold_txn t
                   WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
                          OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
                     AND t.voided_at IS NULL) x
           WHERE x.code IS NOT NULL
             AND NOT (c.id IS NOT NULL AND x.code = 'CONVERSION_LEG')
           ORDER BY x.side_rank, x.line_no, x.created_at, x.id
           LIMIT 1)
  END
    FROM (SELECT p_key AS k) q
    LEFT JOIN pc49.gold_conversion c ON c.id = q.k
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_locked(p_key uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT pc49.gold_receipt_blocked_code(p_key) IS NOT NULL
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

CREATE OR REPLACE FUNCTION pc49.gold_receipt_lines(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'lineNo', x.n, 'side', x.side, 'itemDesc', x.item_desc,
           'goldTypeCode', x.gold_type_code, 'scrapDetail', x.scrap_detail,
           'goldPct', x.gold_pct, 'uom', x.uom, 'qty', x.qty,
           'unitPrice', x.unit_price, 'amount', x.amount,
           'blockedCode', pc49.correction_blocked_code(x.id))
         ORDER BY x.side_rank, x.n), '[]'::jsonb)
    FROM (SELECT t.id, t.item_desc, t.gold_type_code, t.scrap_detail, t.gold_pct, t.uom,
                 t.qty, t.unit_price, t.amount,
                 CASE WHEN t.conversion_id IS NULL THEN NULL
                      WHEN t.qty < 0 THEN 'out' ELSE 'in' END AS side,
                 CASE WHEN t.conversion_id IS NOT NULL AND t.qty > 0 THEN 1 ELSE 0 END AS side_rank,
                 row_number() OVER (
                   PARTITION BY (t.conversion_id IS NOT NULL AND t.qty > 0)
                   ORDER BY coalesce(t.line_no, 1), t.created_at, t.id) AS n
            FROM pc49.gold_txn t
           WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
                  OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
             AND t.voided_at IS NULL) x
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_payments(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'seq', m.seq, 'amount', m.amount, 'method', m.method) ORDER BY m.seq), '[]'::jsonb)
    FROM (SELECT gp.method::text AS method,
                 sum(gp.amount) AS amount,
                 row_number() OVER (ORDER BY min(coalesce(t.line_no, 1) * 1000 + gp.seq)) AS seq
            FROM pc49.gold_txn t
            JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
           WHERE (t.receipt_id = p_key OR t.conversion_id = p_key
                  OR (t.id = p_key AND t.receipt_id IS NULL AND t.conversion_id IS NULL))
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

-- The row gains four columns, and a function's result cannot be changed in place.
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
    SELECT coalesce(t.receipt_id, t.conversion_id, t.id) AS k,
           t.txn_type, t.amount, t.gold_type_code, t.qty_gram
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
  )
  SELECT (SELECT count(DISTINCT k) FROM matched),
         coalesce((SELECT -sum(amount) FROM matched WHERE txn_type IN ('PO', 'PO_VENDOR')), 0),
         coalesce((SELECT sum(amount) FROM matched WHERE txn_type IN ('SALE', 'PICKUP')), 0),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, g.grams)
                     FROM (SELECT gold_type_code, sum(qty_gram) AS grams FROM matched
                            GROUP BY gold_type_code HAVING sum(qty_gram) <> 0) g), '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION pc49.gold_receipt_blocked_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger(
  date, date, text, text, text, text, text, text, int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0080_the_ledger_lists_conversions')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Chạy test**

Run: `npx vitest run tests/sql/conversion-ledger.test.ts tests/sql/receipt-ledger.test.ts tests/sql/receipt.test.ts --maxWorkers=4`
Expected: PASS (conversion-ledger 9 test; receipt-ledger 9; receipt 26).

Rồi chạy riêng toàn bộ SQL: `npx vitest run tests/sql --maxWorkers=4`. Expected: PASS hết.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0080_the_ledger_lists_conversions.sql tests/sql/conversion-ledger.test.ts
git commit -m "feat(conversion): the ledger lists a conversion as one row, its legs by side"
```

### Task 5: Phép tính quy đổi, lời từ chối, chữ giao diện

**Files:**
- Modify: `src/components/gold/types.ts` (thêm `side?` vào `ReceiptLine`, `ConversionInfo`, `conversion?` vào `ReceiptRow`)
- Create: `src/components/gold/conversionLine.ts`
- Modify: `src/components/gold/receiptErrors.ts`
- Modify: `src/lib/i18n/ui-gold.ts`
- Test: `tests/lib/conversion-line.test.ts`

**Interfaces:**
- Consumes: `GRAM_PER_UNIT`, `Uom` (`@/lib/domain/units`); `blockedSentence`, `describeRefusal` (`receiptErrors.ts`); `t(locale, key)`, `MessageKey`.
- Produces:
  - `types.ts`: `ReceiptLine.side?: 'out' | 'in' | null`; `type ConversionInfo = { id; kind; varianceNote; varianceReason }`; `ReceiptRow.conversion?: ConversionInfo | null`;
  - `conversionLine.ts`: `MAX_CONVERSION_LINES = 30`, `type ConversionKind`, `type Side`, `RA_RP_GOLD`, `type ConversionLineField`, `lineGrams(uom, qty)`, `type Balance`, `balanceOf(outGrams, inGrams, tolerancePct)`, `sideGoldTypes(rules, kind, side)`, `type ConversionLinePayload`, `conversionLinePayload(uom, line)`, `sidesFromSaved(row)`;
  - `describeRefusal` dịch thêm các mã `CONVERSION_*` và `LINE_BLOCKED: out|in N CODE`;
  - khoá từ điển `txn.newConversion`, `conversion.*` (danh sách ở Step 5).

- [ ] **Step 1: Thêm kiểu**

Trong `src/components/gold/types.ts`, trong `export type ReceiptLine = {`, ngay sau dòng `  blockedCode: string | null` của kiểu đó, thêm:

```ts
  /** Which side of a conversion the leg is on (0080); absent or null on a receipt. */
  side?: 'out' | 'in' | null
```

Ngay trước dòng `/**` mở chú thích của `export type ReceiptRow`, thêm:

```ts
/** What makes a ledger row a conversion (0080). */
export type ConversionInfo = {
  id: string
  kind: string
  /** Written by the database when the two sides are further apart than the tolerance (0014). */
  varianceNote: string | null
  /** Written by the person who saved it, explaining the difference. */
  varianceReason: string | null
}

```

Trong `export type ReceiptRow = {`, ngay sau dòng `  soldBy: { code: string; sharePct: number }[]`, thêm:

```ts
  /** Set when the row is a conversion rather than a receipt (0080). */
  conversion?: ConversionInfo | null
```

- [ ] **Step 2: Viết test hỏng**

Tạo `tests/lib/conversion-line.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { t, type MessageKey } from '@/lib/i18n'
import {
  balanceOf, conversionLinePayload, lineGrams, sideGoldTypes, sidesFromSaved,
} from '@/components/gold/conversionLine'
import { describeRefusal } from '@/components/gold/receiptErrors'
import type { ReceiptLine } from '@/components/gold/types'

const say = (key: MessageKey) => t('vi', key)

const leg = (over: Partial<ReceiptLine>): ReceiptLine => ({
  id: 'a', lineNo: 1, itemDesc: null, gold_type_code: 'GRAIN', scrap_detail: null, gold_pct: null,
  uom: 'GRAM', qty: -1, unit_price: null, amount: 0, blockedCode: 'CONVERSION_LEG', side: 'out', ...over,
})

describe('the weight of a line', () => {
  it('is its quantity in grams, whatever it is counted in', () => {
    expect(lineGrams('LUONG', 17)).toBe(637.5)
    expect(lineGrams('OZ', 2)).toBeCloseTo(62.21, 10)
    expect(lineGrams('GRAM', -56.7)).toBe(56.7)
  })

  it('is nothing until the gold type and quantity are there', () => {
    expect(lineGrams('', 5)).toBe(0)
    expect(lineGrams('GRAM', null)).toBe(0)
  })
})

describe('whether the two sides meet', () => {
  it('finds Grain into Rong Phung exact', () => {
    expect(balanceOf([637.5], [637.5], 0.5)).toEqual({ out: 637.5, in: 637.5, diff: 0, pct: 0, within: true })
  })

  it('finds the Nini exchange a hundredth of a percent apart, inside the tolerance', () => {
    const b = balanceOf([150], [lineGrams('OZ', 2), lineGrams('OZ', 1), 56.7], 0.5)
    expect(b.in).toBeCloseTo(150.015, 10)
    expect(b.pct).toBeCloseTo(0.01, 10)
    expect(b.within).toBe(true)
  })

  it('finds a short melt outside it', () => {
    const b = balanceOf([150], [143.315], 0.5)
    expect(b.pct).toBeCloseTo(4.4567, 3)
    expect(b.within).toBe(false)
  })

  it('cannot weigh anything with nothing out', () => {
    expect(balanceOf([], [10], 0.5)).toMatchObject({ pct: null, within: false })
  })
})

describe('which gold each side may use', () => {
  const rules = [
    { gold_type_code: 'GRAIN', txn_type: 'TRANSFER_OUT' },
    { gold_type_code: 'RP', txn_type: 'TRANSFER_OUT' },
    { gold_type_code: 'RP', txn_type: 'TRANSFER_IN' },
    { gold_type_code: 'CS', txn_type: 'TRANSFER_IN' },
    { gold_type_code: 'RP', txn_type: 'TRANSFER_IN' },
  ]

  it('follows the flow rules for a transfer', () => {
    expect(sideGoldTypes(rules, 'TRANSFER', 'out')).toEqual(['GRAIN', 'RP'])
    expect(sideGoldTypes(rules, 'TRANSFER', 'in')).toEqual(['RP', 'CS'])
  })

  it('is Grain out and Rong Phung in for Ra RP', () => {
    expect(sideGoldTypes(rules, 'RA_RP', 'out')).toEqual(['GRAIN'])
    expect(sideGoldTypes(rules, 'RA_RP', 'in')).toEqual(['RP'])
  })
})

describe('a conversion on its way to the database, and back', () => {
  it('sends quantities without a sign', () => {
    expect(conversionLinePayload('LUONG', { goldTypeCode: 'RP', qty: -4 }))
      .toEqual({ goldTypeCode: 'RP', uom: 'LUONG', qty: 4 })
  })

  it('puts saved legs back on their sides, unsigned', () => {
    expect(sidesFromSaved({ lines: [
      leg({ gold_type_code: 'RP', uom: 'LUONG', qty: -4, side: 'out' }),
      leg({ id: 'b', gold_type_code: 'CS', uom: 'OZ', qty: 2, side: 'in' }),
      leg({ id: 'c', gold_type_code: 'GRAIN', qty: 56.7, side: 'in', lineNo: 2 }),
    ] })).toEqual({
      out: [{ goldTypeCode: 'RP', qty: 4 }],
      in: [{ goldTypeCode: 'CS', qty: 2 }, { goldTypeCode: 'GRAIN', qty: 56.7 }],
    })
  })
})

describe('a conversion refused, in the reader’s language', () => {
  it('says how far apart the weights are and what to do', () => {
    expect(describeRefusal('CONVERSION_UNBALANCED: out 150.0000 in 143.3000 pct 4.4667 tolerance 0.500000', say))
      .toBe('RA 150.00 g, VÀO 143.30 g: lệch 4.47%, vượt mức cho phép 0.5%. Ghi lý do lệch để lưu.')
  })

  it('names the line', () => {
    expect(describeRefusal('CONVERSION_QTY: in 3 has no quantity', say)).toBe('Dòng Vào 3 chưa có số lượng.')
    expect(describeRefusal('LINE_BLOCKED: out 2 CASH_LINK cannot be changed here', say))
      .toBe('Dòng Ra 2: Dòng này gắn với một khoản thu chi tiền')
  })

  it('translates the rest', () => {
    expect(describeRefusal('CONVERSION_SIDES: each side holds …', say)).toBe(say('conversion.err.sides'))
    expect(describeRefusal('CONVERSION_RA_RP: Ra RP turns …', say)).toBe(say('conversion.err.raRp'))
    expect(describeRefusal('CONVERSION_REFINING: this conversion …', say)).toBe(say('txn.blocked.REFINING_LEG'))
    expect(describeRefusal('CONVERSION_VOIDED: this conversion …', say)).toBe(say('txn.blocked.VOIDED'))
  })
})
```

Run: `npx vitest run tests/lib/conversion-line.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/gold/conversionLine"`.

- [ ] **Step 3: Viết `conversionLine.ts`**

Tạo `src/components/gold/conversionLine.ts`:

```ts
import { GRAM_PER_UNIT, type Uom } from '@/lib/domain/units'
import type { ReceiptRow } from './types'

/** More than this on one side is refused by the database too (0078). */
export const MAX_CONVERSION_LINES = 30

export type ConversionKind = 'TRANSFER' | 'RA_RP'
export type Side = 'out' | 'in'

/** Ra RP is Grain melted into Rong Phung, and nothing else (0004's flow rules). */
export const RA_RP_GOLD: Record<Side, string> = { out: 'GRAIN', in: 'RP' }

/** One line of a side as the form holds it. The quantity is unsigned; the side signs it. */
export type ConversionLineField = { goldTypeCode: string; qty: number | null }

/** A line's weight in grams: 37.5 to the luong, 31.105 to the ounce (uom_factor). */
export function lineGrams(uom: Uom | '', qty: number | null | undefined): number {
  if (!uom || qty === null || qty === undefined || Number.isNaN(Number(qty))) return 0
  return Math.abs(Number(qty)) * GRAM_PER_UNIT[uom]
}

export type Balance = {
  out: number
  in: number
  diff: number
  /** The difference as a percent of the grams out, or null with nothing out. */
  pct: number | null
  within: boolean
}

/**
 * Whether the two sides meet: 0014's rule, the difference over the grams out
 * as a percent, against CONVERSION_WEIGHT_TOLERANCE_PCT.
 */
export function balanceOf(outGrams: number[], inGrams: number[], tolerancePct: number): Balance {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
  const out = sum(outGrams)
  const into = sum(inGrams)
  const diff = Math.abs(into - out)
  const pct = out > 0 ? (diff / out) * 100 : null
  // A hair of slack: 150.015 - 150 is not exactly 0.015 in floating point.
  return { out, in: into, diff, pct, within: pct !== null && pct <= tolerancePct + 1e-9 }
}

/**
 * The gold a side may use: the flow rules for that direction on a transfer,
 * Ra RP's fixed pair otherwise. The database checks every leg anyway (0012);
 * this keeps the choice from offering what it would refuse.
 */
export function sideGoldTypes(
  rules: { gold_type_code: string; txn_type: string }[], kind: ConversionKind, side: Side,
): string[] {
  if (kind === 'RA_RP') return [RA_RP_GOLD[side]]
  const type = side === 'out' ? 'TRANSFER_OUT' : 'TRANSFER_IN'
  return [...new Set(rules.filter((r) => r.txn_type === type).map((r) => r.gold_type_code))]
}

/** A line as save_gold_conversion takes it (0078). */
export type ConversionLinePayload = { goldTypeCode: string; uom: Uom; qty: number }

export function conversionLinePayload(uom: Uom, line: ConversionLineField): ConversionLinePayload {
  return { goldTypeCode: line.goldTypeCode, uom, qty: Math.abs(Number(line.qty)) }
}

/** A saved conversion's legs, back on the form: unsigned, each on its side. */
export function sidesFromSaved(row: Pick<ReceiptRow, 'lines'>): Record<Side, ConversionLineField[]> {
  const pick = (side: Side) => row.lines
    .filter((l) => l.side === side)
    .map((l) => ({ goldTypeCode: l.gold_type_code, qty: Math.abs(l.qty) }))
  return { out: pick('out'), in: pick('in') }
}
```

- [ ] **Step 4: Dịch lời từ chối của quy đổi**

Trong `src/components/gold/receiptErrors.ts`, trong hàm `describeRefusal`, ngay sau dòng `export function describeRefusal(message: string, t: Translate): string {`, thêm:

```ts
  // A conversion's refusals (0078, 0079) name a side and a line, or carry the
  // weights, so the sentence can say exactly what to fix.
  const unbalanced = /CONVERSION_UNBALANCED: out ([\d.]+) in ([\d.]+) pct ([\d.]+) tolerance ([\d.]+)/
    .exec(message)
  if (unbalanced) {
    const [, out, into, pct, tolerance] = unbalanced
    return t('conversion.err.unbalanced')
      .replace('{0}', Number(out).toFixed(2))
      .replace('{1}', Number(into).toFixed(2))
      .replace('{2}', Number(pct).toFixed(2))
      .replace('{3}', String(Number(tolerance)))
  }
  const sideName = (side: string) => t(side === 'out' ? 'conversion.side.out' : 'conversion.side.in')
  const legBlocked = /LINE_BLOCKED: (out|in) (\d+) ([A-Z_]+)/.exec(message)
  if (legBlocked) {
    return t('conversion.err.blocked')
      .replace('{0}', sideName(legBlocked[1]))
      .replace('{1}', legBlocked[2])
      .replace('{2}', blockedSentence(legBlocked[3], t) ?? '')
  }
  const legQty = /CONVERSION_QTY: (out|in) (\d+)/.exec(message)
  if (legQty) {
    return t('conversion.err.qty').replace('{0}', sideName(legQty[1])).replace('{1}', legQty[2])
  }
  if (/CONVERSION_SIDES/.test(message)) return t('conversion.err.sides')
  if (/CONVERSION_RA_RP/.test(message)) return t('conversion.err.raRp')
  if (/CONVERSION_REFINING/.test(message)) return t('txn.blocked.REFINING_LEG')
  if (/CONVERSION_VOIDED/.test(message)) return t('txn.blocked.VOIDED')

```

- [ ] **Step 5: Thêm chữ giao diện**

Trong `src/lib/i18n/ui-gold.ts`, khối `vi`, ngay sau dòng `'receipt.err.conflict': ...` của khối `vi`, thêm:

```ts
    'txn.newConversion': 'Quy đổi vàng',
    'conversion.title': 'Quy đổi vàng',
    'conversion.correctTitle': 'Sửa quy đổi',
    'conversion.kind': 'Loại phiên',
    'conversion.kind.TRANSFER': 'Quy đổi',
    'conversion.kind.RA_RP': 'Ra RP',
    'conversion.side.out': 'Ra',
    'conversion.side.in': 'Vào',
    'conversion.out': 'Vàng ra',
    'conversion.in': 'Vàng vào',
    'conversion.addOut': 'Thêm dòng ra',
    'conversion.addIn': 'Thêm dòng vào',
    'conversion.removeLine': 'Bỏ dòng này',
    'conversion.hint': 'Gõ số lượng không dấu; bên RA hay VÀO quyết định dấu. Tổng gram hai bên phải khớp.',
    'conversion.raRpHint': 'Ra RP: Vàng Grain ra, Rồng Phụng vào.',
    'conversion.balance': 'RA {0} g · VÀO {1} g · Lệch {2} g ({3}%)',
    'conversion.balanced': 'Cân',
    'conversion.overTolerance': 'Vượt mức cho phép {0}%',
    'conversion.varianceReason': 'Lý do lệch',
    'conversion.saveMore': 'Lưu & thêm phiên tiếp',
    'conversion.summary': 'Nhiều loại ({0} ra → {1} vào)',
    'conversion.variance': 'Lệch cân',
    'conversion.err.unbalanced': 'RA {0} g, VÀO {1} g: lệch {2}%, vượt mức cho phép {3}%. Ghi lý do lệch để lưu.',
    'conversion.err.sides': 'Mỗi bên RA và VÀO có từ 1 đến 30 dòng.',
    'conversion.err.qty': 'Dòng {0} {1} chưa có số lượng.',
    'conversion.err.raRp': 'Ra RP chỉ có Vàng Grain ra và Rồng Phụng vào.',
    'conversion.err.blocked': 'Dòng {0} {1}: {2}',
```

Khối `en`, ngay sau dòng `'receipt.err.conflict': ...` của khối `en`, thêm:

```ts
    'txn.newConversion': 'Convert gold',
    'conversion.title': 'Convert gold',
    'conversion.correctTitle': 'Correct conversion',
    'conversion.kind': 'Kind',
    'conversion.kind.TRANSFER': 'Transfer',
    'conversion.kind.RA_RP': 'Produce RP',
    'conversion.side.out': 'Out',
    'conversion.side.in': 'In',
    'conversion.out': 'Gold out',
    'conversion.in': 'Gold in',
    'conversion.addOut': 'Add a line out',
    'conversion.addIn': 'Add a line in',
    'conversion.removeLine': 'Remove this line',
    'conversion.hint': 'Type quantities without a sign; the side sets it. The grams on both sides must meet.',
    'conversion.raRpHint': 'Produce RP: Grain out, Rong Phung in.',
    'conversion.balance': 'Out {0} g · In {1} g · Difference {2} g ({3}%)',
    'conversion.balanced': 'Balanced',
    'conversion.overTolerance': 'Over the {0}% tolerance',
    'conversion.varianceReason': 'Reason for the difference',
    'conversion.saveMore': 'Save & add another',
    'conversion.summary': 'Mixed ({0} out → {1} in)',
    'conversion.variance': 'Out of balance',
    'conversion.err.unbalanced': 'Out {0} g, in {1} g: {2}% apart, over the {3}% tolerance. Give a reason for the difference to save.',
    'conversion.err.sides': 'Each side of a conversion holds 1 to 30 lines.',
    'conversion.err.qty': 'Line {0} {1} has no quantity.',
    'conversion.err.raRp': 'Produce RP has only Grain out and Rong Phung in.',
    'conversion.err.blocked': 'Line {0} {1}: {2}',
```

- [ ] **Step 6: Chạy test**

Run: `npx vitest run tests/lib/conversion-line.test.ts tests/lib/receipt-errors.test.ts tests/lib/i18n.test.ts`
Expected: PASS (conversion-line 13 test).
Run: `npm run typecheck`
Expected: không lỗi.

- [ ] **Step 7: Commit**

```bash
git add src/components/gold/types.ts src/components/gold/conversionLine.ts src/components/gold/receiptErrors.ts src/lib/i18n/ui-gold.ts tests/lib/conversion-line.test.ts
git commit -m "feat(conversion): the sides of a conversion are weighed, and its refusals said in words"
```

### Task 6: Đọc dòng quy đổi, và ba lời gọi lưu/sửa/huỷ phiên

**Files:**
- Modify: `src/components/gold/ledgerRow.ts`
- Modify: `src/app/(app)/gold-transactions/actions.ts` (thêm ở cuối, và một dòng import)
- Test: `tests/lib/receipt-row.test.ts`

**Interfaces:**
- Consumes: `ConversionInfo`, `ReceiptLine.side` (Task 5); `MAX_CONVERSION_LINES` (Task 5); RPC `save_gold_conversion`, `correct_gold_conversion`, `void_gold_conversion` (Task 2–3); `SaveResult`, `ReceiptVoidResult`, `fileCustomer`, `receiptVoidSchema` đang có trong `actions.ts`.
- Produces:
  - `toReceiptRow` đặt `conversion` (null với phiếu) và `side` của từng vế;
  - `goldSummary(row: Pick<ReceiptRow, 'lines' | 'conversion'>, goldName, t)`: dòng quy đổi thành `"Vàng Grain → Rồng Phụng"` hoặc `"Nhiều loại (n ra → m vào)"`;
  - `saveConversion(input: unknown): Promise<SaveResult>` với input `{requestKey, convDate, kind, partnerCode, note, varianceReason, out: ConversionLinePayload[], in: ConversionLinePayload[]}`;
  - `correctConversion(input: unknown): Promise<SaveResult>` với input trên cộng `{original, expectedRevision, reason, reversalDate?}`;
  - `voidConversion(input: unknown): Promise<ReceiptVoidResult>` với input `{key, reason, onDate?}`;
  - `SaveResult.id` là id phiên.

- [ ] **Step 1: Viết test hỏng**

Trong `tests/lib/receipt-row.test.ts`:

Thay dòng `const NAMES: Record<string, string> = { SG: 'Vàng vụn', GRAIN: 'Vàng Grain' }` bằng:

```ts
const NAMES: Record<string, string> = { SG: 'Vàng vụn', GRAIN: 'Vàng Grain', RP: 'Rồng Phụng' }
```

Trong test `'reads figures that arrive as text as numbers, and names what is missing null'`, thay khối `expect(row.lines[0]).toEqual({ ... })` bằng:

```ts
    expect(row.lines[0]).toEqual({
      id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG', scrap_detail: '19-24k/grs',
      gold_pct: 0.987, uom: 'GRAM', qty: 9.4, unit_price: 101.06382979, amount: -950, blockedCode: null,
      side: null,
    })
    expect(row.conversion).toBeNull()
```

Thêm vào cuối file:

```ts
describe('a conversion row of the ledger', () => {
  const raw = {
    receipt_key: 'c1', receipt_id: null, txn_date: '2026-06-07', doc_no: 'PC49-2606-040',
    txn_type: 'TRANSFER_OUT', partner_code: null, partner_phone: null, sales_person_code: null,
    remarks: 'Transfer 637.5gr vang Grain ra 17L VRP', revision: 2, blocked_code: null, amount: '0',
    line_count: 2, payments: [], sold_by: [],
    conversion_id: 'c1', conversion_kind: 'TRANSFER', variance_note: null, variance_reason: null,
    lines: [
      { id: 'o', lineNo: 1, side: 'out', itemDesc: null, goldTypeCode: 'GRAIN', scrapDetail: null,
        goldPct: null, uom: 'GRAM', qty: '-637.5000', unitPrice: null, amount: '0.00', blockedCode: 'CONVERSION_LEG' },
      { id: 'i', lineNo: 1, side: 'in', itemDesc: null, goldTypeCode: 'RP', scrapDetail: null,
        goldPct: null, uom: 'LUONG', qty: '17.0000', unitPrice: null, amount: '0.00', blockedCode: 'CONVERSION_LEG' },
    ],
  }

  it('says it is a conversion, and which side each leg is on', () => {
    const row = toReceiptRow(raw)
    expect(row.conversion).toEqual({ id: 'c1', kind: 'TRANSFER', varianceNote: null, varianceReason: null })
    expect(row.lines.map((l) => [l.side, l.qty])).toEqual([['out', -637.5], ['in', 17]])
  })

  it('is named for the gold that went out and came in', () => {
    expect(goldSummary(toReceiptRow(raw), gold, say)).toBe('Vàng Grain → Rồng Phụng')
    const nini = toReceiptRow({
      ...raw,
      lines: [
        { ...raw.lines[0], goldTypeCode: 'RP' },
        { ...raw.lines[1], id: 'a', goldTypeCode: 'CS' },
        { ...raw.lines[1], id: 'b', goldTypeCode: 'OTH' },
        { ...raw.lines[1], id: 'c', goldTypeCode: 'GRAIN' },
      ],
    })
    expect(goldSummary(nini, gold, say)).toBe('Nhiều loại (1 ra → 3 vào)')
  })
})
```

Run: `npx vitest run tests/lib/receipt-row.test.ts`
Expected: FAIL — `side` và `conversion` chưa có; tóm tắt quy đổi ra `"Nhiều loại (2 món)"`.

- [ ] **Step 2: Đọc dòng quy đổi**

Trong `src/components/gold/ledgerRow.ts`:

Trong `toReceiptRow`, ngay sau dòng `    soldBy: soldBy.map((p) => ({ code: String(p.code), sharePct: Number(p.sharePct) })),`, thêm:

```ts
    conversion: r.conversion_id
      ? {
          id: String(r.conversion_id),
          kind: String(r.conversion_kind),
          varianceNote: text(r.variance_note),
          varianceReason: text(r.variance_reason),
        }
      : null,
```

Trong `toReceiptLine`, ngay sau dòng `    blockedCode: text(l.blockedCode),`, thêm:

```ts
    side: l.side === 'out' || l.side === 'in' ? l.side : null,
```

Thay toàn bộ hàm `goldSummary` và chú thích của nó bằng:

```ts
/**
 * The gold column of a row.
 *
 * A receipt: the gold type when every item is the same one (with the count when
 * there are several), "Nhiều loại (n món)" when they differ. A conversion: the
 * gold that went out and the gold that came in, "Vàng Grain → Rồng Phụng", or
 * "Nhiều loại (n ra → m vào)" when either side holds more than one kind.
 */
export function goldSummary(
  row: Pick<ReceiptRow, 'lines' | 'conversion'>,
  goldName: (code: string) => string,
  t: (key: MessageKey) => string,
): string {
  if (row.conversion) {
    const out = row.lines.filter((l) => l.side === 'out')
    const into = row.lines.filter((l) => l.side === 'in')
    const kinds = (lines: ReceiptLine[]) => [...new Set(lines.map((l) => l.gold_type_code))]
    const [outKinds, inKinds] = [kinds(out), kinds(into)]
    if (outKinds.length === 1 && inKinds.length === 1) {
      return `${goldName(outKinds[0])} → ${goldName(inKinds[0])}`
    }
    return t('conversion.summary').replace('{0}', String(out.length)).replace('{1}', String(into.length))
  }
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
Expected: PASS, 6 test.

- [ ] **Step 3: Ba server action của quy đổi**

Trong `src/app/(app)/gold-transactions/actions.ts`, ngay sau dòng `import { MAX_RECEIPT_LINES, SINGLE_LINE_TYPES } from '@/components/gold/receiptLine'`, thêm:

```ts
import { MAX_CONVERSION_LINES } from '@/components/gold/conversionLine'
```

Thêm vào cuối file:

```ts
/** One line of a conversion's side: which gold, in its own unit, how much, unsigned. */
const conversionLineSchema = z.object({
  goldTypeCode: z.string().min(1),
  uom: z.enum(['GRAM', 'OZ', 'LUONG']),
  qty: z.number().positive('quantity must be more than zero'),
})

const conversionFields = z.object({
  // Stable for the life of one conversion on screen, as a receipt's is.
  requestKey: z.string().uuid(),
  convDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['TRANSFER', 'RA_RP']),
  partnerCode: z.string().nullable(),
  note: z.string().nullable(),
  varianceReason: z.string().trim().nullable().default(null),
  out: z.array(conversionLineSchema).min(1).max(MAX_CONVERSION_LINES),
  in: z.array(conversionLineSchema).min(1).max(MAX_CONVERSION_LINES),
})

const conversionCorrectionSchema = conversionFields.extend({
  original: z.string().uuid(),
  expectedRevision: z.number().int(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
})

/** What the database is sent: the conversion without its key. */
function conversionPayload(c: z.infer<typeof conversionFields>) {
  return {
    convDate: c.convDate,
    kind: c.kind,
    partnerCode: c.partnerCode,
    note: c.note,
    varianceReason: c.varianceReason,
    out: c.out,
    in: c.in,
  }
}

/**
 * Saves a conversion: the gold that went out, the gold that came in, weighed
 * against each other and posted leg by leg, in one transaction (0078).
 */
export async function saveConversion(input: unknown): Promise<SaveResult> {
  const parsed = conversionFields.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid conversion' }
  }
  const c = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('save_gold_conversion', {
    p_request_key: c.requestKey,
    p_payload: conversionPayload(c),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { conversionId: string; docNo: string | null; repeated: boolean }
  // Filing the partner keeps the suggestions converging on one spelling.
  const warning = await fileCustomer(supabase, c.partnerCode, null)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.conversionId, docNo: result.docNo, repeated: result.repeated, warning }
}

/**
 * Replaces a conversion, every leg of it, with the corrected one (0079). The
 * revision is the one the screen was showing; CONFLICT if it has moved since.
 */
export async function correctConversion(input: unknown): Promise<SaveResult> {
  const parsed = conversionCorrectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid correction' }
  }
  const c = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('correct_gold_conversion', {
    p_request_key: c.requestKey,
    p_original: c.original,
    p_expected_revision: c.expectedRevision,
    p_reason: c.reason,
    p_reversal_date: c.reversalDate,
    p_payload: conversionPayload(c),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { conversionId: string; docNo: string | null; repeated: boolean }
  const warning = await fileCustomer(supabase, c.partnerCode, null)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.conversionId, docNo: result.docNo, repeated: result.repeated, warning }
}

/** Cancels a conversion, every leg of it (0079). */
export async function voidConversion(input: unknown): Promise<ReceiptVoidResult> {
  const parsed = receiptVoidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('void_gold_conversion', {
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

Run: `npm run typecheck` rồi `npm run lint`
Expected: không lỗi.
Run: `npx vitest run tests/lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/gold/ledgerRow.ts "src/app/(app)/gold-transactions/actions.ts" tests/lib/receipt-row.test.ts
git commit -m "feat(conversion): read a conversion row, and save, correct or cancel a conversion"
```

### Task 7: Form Quy đổi vàng

**Files:**
- Create: `src/components/gold/ConversionForm.tsx`

**Interfaces:**
- Consumes: `saveConversion`, `correctConversion`, `SaveResult` (Task 6); mọi thứ của `conversionLine.ts` (Task 5); `describeRefusal` (Task 5); `GoldTypeOption`, `ReceiptRow`; `normalizeTransactionSearch`; lớp CSS `form`, `section`, `sectionHeading`, `sectionDescription`, `line`, `lineHead`, `lineNo`, `fine`, `addLine`, `calculatedAmount` trong `Txn.module.css`.
- Produces: `ConversionForm` với props
  `{ open: boolean; onClose: () => void; onSaved: (docNo: string | null, stayOpen: boolean) => void; convDate: string; goldTypes: GoldTypeOption[]; partners: { code: string; phone: string | null }[]; flowRules: { gold_type_code: string; txn_type: string }[]; tolerancePct: number; correcting: ReceiptRow | null }`.
- Nhãn bắt buộc: dialog `Quy đổi vàng` / `Sửa quy đổi`; nhóm `Ra N` / `Vào N` (`role="group"`); trường `Loại phiên`, `Khách / NCC`, `Ghi chú`, `Loại vàng`, `Số lượng`, `Lý do lệch`, `Lý do sửa`; nút `Thêm dòng ra`, `Thêm dòng vào`, `Bỏ dòng này`, `Lưu`, `Lưu & thêm phiên tiếp`, `Đóng`.

Không có unit test cho bước này (antd `Modal` vẽ vào portal). Form được kiểm tra trên trình duyệt ở Task 10 (`verify:conversion`).

- [ ] **Step 1: Viết form**

Tạo `src/components/gold/ConversionForm.tsx`:

```tsx
'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, AutoComplete, Button, Col, Form, Input, InputNumber, Modal, Row, Select,
} from 'antd'
import { Check, ListPlus, Plus, Trash2, X } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import type { Uom } from '@/lib/domain/units'
import {
  correctConversion, saveConversion, type SaveResult,
} from '@/app/(app)/gold-transactions/actions'
import type { GoldTypeOption, ReceiptRow } from './types'
import {
  MAX_CONVERSION_LINES, RA_RP_GOLD, balanceOf, conversionLinePayload, lineGrams,
  sideGoldTypes, sidesFromSaved,
  type ConversionKind, type ConversionLineField, type Side,
} from './conversionLine'
import { describeRefusal } from './receiptErrors'
import { normalizeTransactionSearch } from './transactionFilters'
import styles from './Txn.module.css'

const grams = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })
const percent = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Values = {
  convDate: string
  kind: ConversionKind
  partnerCode: string
  note: string
  out: ConversionLineField[]
  in: ConversionLineField[]
  varianceReason: string
  reason: string
}

const SIDES: Side[] = ['out', 'in']
const KINDS: ConversionKind[] = ['TRANSFER', 'RA_RP']

/**
 * One conversion, entered as it happened: the gold that went out and the gold
 * that came in, weighed against each other (spec 2026-09-17, "Quy đổi vàng").
 *
 * The weights are compared as they are typed, in grams whatever the unit, and
 * a difference beyond CONVERSION_WEIGHT_TOLERANCE_PCT asks for a reason rather
 * than refusing: a melt that came up short has to be recordable as it was.
 *
 * Correcting reuses this form with every leg of the conversion. Nothing is
 * written when it opens; the reversal and the replacement happen together.
 */
export function ConversionForm({
  open, onClose, onSaved, convDate, goldTypes, partners, flowRules, tolerancePct, correcting,
}: {
  open: boolean
  onClose: () => void
  /** Called with the number the conversion was given, and whether the form stays open. */
  onSaved: (docNo: string | null, stayOpen: boolean) => void
  convDate: string
  goldTypes: GoldTypeOption[]
  partners: { code: string; phone: string | null }[]
  /** Which gold may go out and come in on a transfer (gold_flow_rule). */
  flowRules: { gold_type_code: string; txn_type: string }[]
  /** CONVERSION_WEIGHT_TOLERANCE_PCT, as a percent. */
  tolerancePct: number
  /** The conversion being replaced, or null when this is a fresh one. */
  correcting: ReceiptRow | null
}) {
  const { locale, t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  function requestClose() {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  // Reloading or closing the tab loses what was typed.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    if (error) topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  /** Stable for the life of one conversion on this form, so saving twice is saving once. */
  const requestKey = useRef<string>(crypto.randomUUID())

  const goldName = (code: string) => {
    const g = goldTypes.find((x) => x.code === code)
    return g ? (locale === 'vi' ? g.name_vi : g.name_en) : code
  }
  const uomOf = (code: string): Uom | '' =>
    goldTypes.find((g) => g.code === code)?.native_uom ?? ''
  const sideName = (side: Side) => t(side === 'out' ? 'conversion.side.out' : 'conversion.side.in')

  const initial: Values = useMemo(() => {
    if (!correcting) {
      return {
        convDate, kind: 'TRANSFER', partnerCode: '', note: '',
        out: [{ goldTypeCode: '', qty: null }], in: [{ goldTypeCode: '', qty: null }],
        varianceReason: '', reason: '',
      }
    }
    const sides = sidesFromSaved(correcting)
    return {
      convDate,
      kind: correcting.conversion?.kind === 'RA_RP' ? 'RA_RP' : 'TRANSFER',
      partnerCode: correcting.partner_code ?? '',
      note: correcting.remarks ?? '',
      out: sides.out.length ? sides.out : [{ goldTypeCode: '', qty: null }],
      in: sides.in.length ? sides.in : [{ goldTypeCode: '', qty: null }],
      varianceReason: correcting.conversion?.varianceReason ?? '',
      // Filled in so correcting is one click (B12). Still editable.
      reason: t('txn.correctReason'),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correcting])

  const kind = (Form.useWatch('kind', form) ?? initial.kind) as ConversionKind
  const outLines = (Form.useWatch('out', form) ?? []) as (ConversionLineField | undefined)[]
  const inLines = (Form.useWatch('in', form) ?? []) as (ConversionLineField | undefined)[]
  const gramsOf = (l: ConversionLineField | undefined) => lineGrams(uomOf(l?.goldTypeCode ?? ''), l?.qty)
  const balance = balanceOf(outLines.map(gramsOf), inLines.map(gramsOf), tolerancePct)
  const weighed = balance.out > 0 && balance.in > 0
  const needsReason = weighed && !balance.within

  /** Ra RP fixes the gold on both sides; a transfer leaves what was chosen. */
  function kindChosen(next: ConversionKind) {
    if (next !== 'RA_RP') return
    for (const side of SIDES) {
      const lines = (form.getFieldValue(side) ?? []) as ConversionLineField[]
      form.setFieldValue(side, lines.map((l) => ({ ...l, goldTypeCode: RA_RP_GOLD[side] })))
    }
  }

  async function submit(stayOpen: boolean) {
    setError(null)
    setLastSaved(null)
    try {
      await form.validateFields()
    } catch {
      setValidationError(true)
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    const v = form.getFieldsValue(true) as Values

    const body = {
      requestKey: requestKey.current,
      convDate: v.convDate,
      kind: v.kind,
      partnerCode: v.partnerCode?.trim() || null,
      note: v.note?.trim() || null,
      // Only when the weights call for one: a reason left over from a
      // difference since typed away is not the record's.
      varianceReason: needsReason ? (v.varianceReason?.trim() || null) : null,
      out: (v.out ?? []).map((l) => conversionLinePayload(uomOf(l.goldTypeCode) as Uom, l)),
      in: (v.in ?? []).map((l) => conversionLinePayload(uomOf(l.goldTypeCode) as Uom, l)),
    }

    setSaving(true)
    const result = await settleAction((): Promise<SaveResult> => (correcting
      ? correctConversion({
          ...body,
          original: correcting.key,
          expectedRevision: correcting.revision,
          reason: v.reason,
        })
      : saveConversion(body)))
    setSaving(false)

    if (!result.ok) {
      setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }

    if (stayOpen && !correcting) {
      // The next conversion: the same day, everything else fresh, a fresh key.
      requestKey.current = crypto.randomUUID()
      form.resetFields()
      form.setFieldValue('convDate', v.convDate)
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
      title={t(correcting ? 'conversion.correctTitle' : 'conversion.title')}
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
            {t('conversion.saveMore')}
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
        {lastSaved && (
          <Alert type="success" showIcon style={{ marginBottom: 12 }}
                 title={`${t('txn.form.savedAs')} ${lastSaved}`} />
        )}

        {correcting && (
          <section className={styles.section} aria-labelledby="conv-correction-heading">
            <h3 id="conv-correction-heading" className={styles.sectionHeading}>
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

        <section className={styles.section} aria-labelledby="conv-details-heading">
          <h3 id="conv-details-heading" className={styles.sectionHeading}>
            {t('txn.form.details')}
          </h3>
          <Row gutter={12}>
            <Col xs={24} sm={6}>
              {/* A correction keeps the day of the conversion it replaces. */}
              <Form.Item name="convDate" label={t('txn.date')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <Input type="date" disabled={Boolean(correcting)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={6}>
              <Form.Item name="kind" label={t('conversion.kind')}>
                <Select
                  options={KINDS.map((k) => ({
                    value: k,
                    label: t(k === 'RA_RP' ? 'conversion.kind.RA_RP' : 'conversion.kind.TRANSFER'),
                  }))}
                  onChange={kindChosen}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="partnerCode" label={t('txn.col.partner')}>
                <AutoComplete
                  options={partners.map((p) => ({ value: p.code }))}
                  filterOption={(input, option) =>
                    normalizeTransactionSearch(option?.value)
                      .includes(normalizeTransactionSearch(input))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label={t('txn.col.remarks')}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </section>

        <section className={styles.section} aria-labelledby="conv-lines-heading">
          <h3 id="conv-lines-heading" className={styles.sectionHeading}>{t('conversion.title')}</h3>
          <span className={styles.sectionDescription}>
            {t('conversion.hint')} {kind === 'RA_RP' ? t('conversion.raRpHint') : ''}
          </span>
          <Row gutter={16}>
            {SIDES.map((side) => {
              const lines = side === 'out' ? outLines : inLines
              const choices = sideGoldTypes(flowRules, kind, side)
                .map((code) => ({ value: code, label: goldName(code) }))
              return (
                <Col xs={24} md={12} key={side}>
                  <h4 className={styles.lineNo}>{t(side === 'out' ? 'conversion.out' : 'conversion.in')}</h4>
                  <Form.List name={side}>
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map((field, index) => {
                          const line = lines[index]
                          const uom = uomOf(line?.goldTypeCode ?? '')
                          const label = `${sideName(side)} ${index + 1}`
                          return (
                            <div key={field.key} className={styles.line} role="group" aria-label={label}>
                              <div className={styles.lineHead}>
                                <span className={styles.lineNo}>{label}</span>
                                <Button type="text" danger size="small"
                                        icon={<Trash2 size={16} aria-hidden />}
                                        aria-label={t('conversion.removeLine')}
                                        disabled={fields.length === 1}
                                        onClick={() => remove(field.name)} />
                              </div>
                              <Row gutter={8}>
                                <Col xs={24} sm={10}>
                                  <Form.Item name={[field.name, 'goldTypeCode']} label={t('txn.col.gold')}
                                             rules={[{ required: true, message: t('txn.form.required') }]}>
                                    <Select showSearch optionFilterProp="label" options={choices}
                                            disabled={kind === 'RA_RP'} />
                                  </Form.Item>
                                </Col>
                                <Col xs={14} sm={8}>
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
                                    <InputNumber style={{ width: '100%' }} min={0} step={0.01}
                                                 controls={false} suffix={uom || undefined} />
                                  </Form.Item>
                                </Col>
                                <Col xs={10} sm={6}>
                                  <Form.Item label={t('txn.col.grams')}>
                                    <output className={styles.fine}>{grams.format(gramsOf(line))}</output>
                                  </Form.Item>
                                </Col>
                              </Row>
                            </div>
                          )
                        })}
                        {fields.length < MAX_CONVERSION_LINES && (
                          <Button type="dashed" block className={styles.addLine}
                                  icon={<Plus size={16} aria-hidden />}
                                  onClick={() => add({
                                    goldTypeCode: kind === 'RA_RP' ? RA_RP_GOLD[side] : '', qty: null,
                                  })}>
                            {t(side === 'out' ? 'conversion.addOut' : 'conversion.addIn')}
                          </Button>
                        )}
                      </>
                    )}
                  </Form.List>
                </Col>
              )
            })}
          </Row>

          <div className={styles.calculatedAmount} aria-live="polite">
            <span>
              {t('conversion.balance')
                .replace('{0}', grams.format(balance.out))
                .replace('{1}', grams.format(balance.in))
                .replace('{2}', grams.format(balance.diff))
                .replace('{3}', balance.pct === null ? '—' : percent.format(balance.pct))}
            </span>
            {weighed && (
              <strong className={balance.within ? 'pc-in' : 'pc-out'}>
                {balance.within
                  ? t('conversion.balanced')
                  : t('conversion.overTolerance').replace('{0}', String(tolerancePct))}
              </strong>
            )}
          </div>

          {needsReason && (
            <Form.Item name="varianceReason" label={t('conversion.varianceReason')}
                       style={{ marginTop: 12 }}
                       rules={[{ required: true, whitespace: true, message: t('txn.form.required') }]}>
              <Input />
            </Form.Item>
          )}
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

- [ ] **Step 2: Kiểm tra**

Run: `npm run typecheck` rồi `npm run lint`
Expected: không lỗi.

- [ ] **Step 3: Commit**

```bash
git add src/components/gold/ConversionForm.tsx
git commit -m "feat(conversion): a form for gold out and gold in, weighed as it is typed"
```

### Task 8: Quy đổi trong sổ giao dịch vàng

**Files:**
- Modify: `src/components/gold/TxnScreen.tsx`
- Modify: `src/components/gold/ReceiptLines.tsx`
- Modify: `src/app/(app)/gold-transactions/page.tsx`
- Test: `tests/lib/txn-ledger-screen.test.tsx`

**Interfaces:**
- Consumes: `ConversionForm` (Task 7); `voidConversion` (Task 6); `goldSummary` có quy đổi (Task 6); `ReceiptRow.conversion`, `ReceiptLine.side` (Task 5); RPC sổ trả cột quy đổi (Task 4).
- Produces: `TxnScreen` nhận thêm `flowRules?: { gold_type_code: string; txn_type: string }[]` (mặc định `[]`) và `tolerancePct?: number` (mặc định `0.5`); nút `Quy đổi vàng`; dòng quy đổi có thẻ loại phiên, cột số lượng là gram ra, thẻ `Lệch cân`; Sửa/Huỷ gọi đúng hàm theo loại dòng.

- [ ] **Step 1: Viết test hỏng**

Trong `tests/lib/txn-ledger-screen.test.tsx`, thêm test cuối khối `describe`:

```tsx
  it('lists a conversion as one row: its kind, gold out into gold in, grams moved', () => {
    const conversion: ReceiptRow = {
      ...sale, key: 'c1', doc_no: 'PC49-2606-040', txn_type: 'TRANSFER_OUT', amount: 0,
      remarks: 'Transfer 637.5gr vang Grain ra 17L VRP', payments: [], soldBy: [],
      conversion: { id: 'c1', kind: 'TRANSFER', varianceNote: 'x', varianceReason: 'hao hut' },
      lines: [
        { ...sale.lines[0], id: 'o', side: 'out', gold_type_code: 'GRAIN', uom: 'GRAM', qty: -637.5,
          unit_price: null, amount: 0, blockedCode: 'CONVERSION_LEG' },
        { ...sale.lines[0], id: 'i', side: 'in', gold_type_code: 'RP', uom: 'LUONG', qty: 17,
          unit_price: null, amount: 0, blockedCode: 'CONVERSION_LEG' },
      ],
    }
    const html = text(<TxnScreen {...base} rows={[conversion]}
      totals={{ count: 1, purchases: 0, sales: 0, grams: {} }} />)
    expect(html).toContain('Quy đổi vàng')
    expect(html).toContain('PC49-2606-040')
    expect(html).toContain('GRAIN → Rồng Phụng')
    expect(html).toContain('637.50 g')
    expect(html).toContain('Lệch cân')
  })
```

(`base.goldTypes` chỉ có RP, nên Grain hiện bằng mã `GRAIN`.)

Run: `npx vitest run tests/lib/txn-ledger-screen.test.tsx`
Expected: FAIL — chưa có nút `Quy đổi vàng`, chưa có thẻ `Lệch cân`.

- [ ] **Step 2: Sổ hiểu dòng quy đổi**

Trong `src/components/gold/TxnScreen.tsx`:

1. Thay dòng `import { Ban, Download, Pencil, Plus } from 'lucide-react'` bằng:

```tsx
import { ArrowLeftRight, Ban, Download, Pencil, Plus } from 'lucide-react'
```

2. Thay dòng `import { voidReceipt } from '@/app/(app)/gold-transactions/actions'` bằng:

```tsx
import { voidConversion, voidReceipt } from '@/app/(app)/gold-transactions/actions'
```

3. Ngay sau dòng `import { ReceiptForm } from './ReceiptForm'` thêm:

```tsx
import { ConversionForm } from './ConversionForm'
```

4. Thay dòng `  query, today, goldTypes, salesPeople, partners, rows, totals, loadFailed = false,` bằng:

```tsx
  query, today, goldTypes, salesPeople, partners, rows, totals, loadFailed = false,
  flowRules = [], tolerancePct = 0.5,
```

5. Ngay sau dòng `  totals: LedgerTotals` (trong khai báo kiểu props) thêm:

```tsx
  /** Which gold may go out and come in on a transfer, for the conversion form. */
  flowRules?: { gold_type_code: string; txn_type: string }[]
  /** CONVERSION_WEIGHT_TOLERANCE_PCT. */
  tolerancePct?: number
```

6. Ngay sau dòng `  const [editing, setEditing] = useState<{ correcting: ReceiptRow | null } | null>(null)` thêm:

```tsx
  /** Open with no row for a fresh conversion, with a conversion row to replace it. */
  const [converting, setConverting] = useState<{ correcting: ReceiptRow | null } | null>(null)
```

7. Ngay sau khối `const newButton = ( ... )` (kết thúc bằng dòng `  )` sau `</Button>`) thêm:

```tsx
  // "cai transfer dau?" (17-09): converting gold is entered beside a receipt.
  const convertButton = (
    <Button icon={<ArrowLeftRight size={16} aria-hidden />}
            onClick={() => setConverting({ correcting: null })}>
      {t('txn.newConversion')}
    </Button>
  )
```

8. Trong `confirmVoid`, thay dòng
`    const result = await settleAction(() => voidReceipt({ key: voidRow.key, reason: voidReason }))`
bằng:

```tsx
    const input = { key: voidRow.key, reason: voidReason }
    const result = await settleAction(() => (voidRow.conversion ? voidConversion(input) : voidReceipt(input)))
```

9. Thay cột loại:

```tsx
    {
      title: t('txn.col.type'), dataIndex: 'txn_type', width: 112,
      render: (v: string) => <TxnTypeTag type={v} />,
    },
```

bằng:

```tsx
    {
      title: t('txn.col.type'), dataIndex: 'txn_type', width: 112,
      render: (v: string, r) => (r.conversion
        ? <Tag color="purple" className="pc-txn-type">
            {t(r.conversion.kind === 'RA_RP' ? 'conversion.kind.RA_RP' : 'conversion.kind.TRANSFER')}
          </Tag>
        : <TxnTypeTag type={v} />),
    },
```

10. Trong cột số lượng, ngay sau dòng `      render: (_: unknown, r) => {` của cột `key: 'qty'`, thêm:

```tsx
        if (r.conversion) {
          // The weight that changed kind: the grams that went out.
          const out = r.lines.filter((l) => l.side === 'out')
            .reduce((sum, l) => sum + Math.abs(toGrams(l.qty, l.uom)), 0)
          return <>{weight.format(out)} g</>
        }
```

11. Trong cột đơn giá, thay dòng `        return only && only.unit_price !== null ? money.format(only.unit_price) : '—'` bằng:

```tsx
        return !r.conversion && only && only.unit_price !== null ? money.format(only.unit_price) : '—'
```

12. Thay cột thành tiền:

```tsx
    {
      title: t('txn.col.amount'), dataIndex: 'amount', width: 136, align: 'right',
      render: (v: number, r) => (
        <>
          <div><Money value={v} /></div>
```

bằng:

```tsx
    {
      title: t('txn.col.amount'), dataIndex: 'amount', width: 136, align: 'right',
      render: (v: number, r) => (r.conversion ? '—' : (
        <>
          <div><Money value={v} /></div>
```

và ngay dòng đóng của cột đó, thay

```tsx
          ))}
        </>
      ),
    },
    { title: t('txn.col.remarks'), dataIndex: 'remarks', ellipsis: true },
```

bằng:

```tsx
          ))}
        </>
      )),
    },
    {
      title: t('txn.col.remarks'), dataIndex: 'remarks', ellipsis: true,
      render: (v: string | null, r) => (
        <>
          {r.conversion?.varianceNote && (
            <Tag color="orange" title={r.conversion.varianceReason ?? r.conversion.varianceNote}>
              {t('conversion.variance')}
            </Tag>
          )}
          {v ?? ''}
        </>
      ),
    },
```

13. Trong cột thao tác, thay `                      onClick={() => setEditing({ correcting: r })} />` bằng:

```tsx
                      onClick={() => (r.conversion
                        ? setConverting({ correcting: r })
                        : setEditing({ correcting: r }))} />
```

14. Thay `    <Page titleKey="txn.title" actions={<Space wrap>{exportButton}{newButton}</Space>}>` bằng:

```tsx
    <Page titleKey="txn.title" actions={<Space wrap>{exportButton}{convertButton}{newButton}</Space>}>
```

15. Ngay sau khối `{editing && ( <ReceiptForm ... /> )}` (kết thúc bằng dòng `      )}` sau `/>`), thêm:

```tsx
      {converting && (
        <ConversionForm
          open
          // A correction keeps its day; a fresh conversion takes the day being
          // looked at, or today.
          convDate={converting.correcting?.txn_date ?? singleDay(query) ?? today}
          goldTypes={goldTypes}
          partners={partners}
          flowRules={flowRules}
          tolerancePct={tolerancePct}
          correcting={converting.correcting}
          onClose={() => setConverting(null)}
          onSaved={(docNo, stayOpen) => {
            setToast(docNo ? `${t('txn.form.savedAs')} ${docNo}` : t('txn.saved'))
            if (!stayOpen) setConverting(null)
            router.refresh()
          }}
        />
      )}
```

- [ ] **Step 3: Vế quy đổi mở ra theo bên**

Trong `src/components/gold/ReceiptLines.tsx`, thay dòng `              <td className={styles.num}>{l.lineNo}</td>` bằng:

```tsx
              <td className={styles.num}>
                {l.side ? `${t(l.side === 'out' ? 'conversion.side.out' : 'conversion.side.in')} ${l.lineNo}` : l.lineNo}
              </td>
```

- [ ] **Step 4: Trang đọc quy tắc luồng và mức cho phép**

Trong `src/app/(app)/gold-transactions/page.tsx`:

Thay dòng `  const [goldTypesResult, salesResult, partnerResult, ledgerResult, totalsResult] =` bằng:

```tsx
  const [goldTypesResult, salesResult, partnerResult, ledgerResult, totalsResult,
    flowResult, toleranceResult] =
```

Ngay sau dòng `      supabase.rpc('gold_receipt_ledger_totals', args),` thêm:

```tsx
      // What the conversion form may offer on each side, and how far apart the
      // two sides may be before a reason is asked for.
      supabase.from('gold_flow_rule').select('gold_type_code, txn_type')
        .in('txn_type', ['TRANSFER_IN', 'TRANSFER_OUT']),
      supabase.from('system_param').select('value')
        .eq('key', 'CONVERSION_WEIGHT_TOLERANCE_PCT').maybeSingle(),
```

Ngay sau dòng `      partners={(partnerResult.data ?? []) as { code: string; phone: string | null }[]}` thêm:

```tsx
      flowRules={(flowResult.data ?? []) as { gold_type_code: string; txn_type: string }[]}
      tolerancePct={Number(toleranceResult.data?.value ?? 0.5)}
```

- [ ] **Step 5: Chạy test và kiểm tra**

Run: `npx vitest run tests/lib/txn-ledger-screen.test.tsx`
Expected: PASS, 7 test.
Run: `npm run typecheck` rồi `npm run lint`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/components/gold/TxnScreen.tsx src/components/gold/ReceiptLines.tsx "src/app/(app)/gold-transactions/page.tsx" tests/lib/txn-ledger-screen.test.tsx
git commit -m "feat(conversion): the ledger offers a conversion beside a receipt, and lists it as one row"
```

### Task 9: Excel ghi bên của vế quy đổi

**Files:**
- Modify: `src/components/gold/ledgerCsv.ts`
- Test: `tests/lib/ledger-csv.test.ts`

**Interfaces:**
- Consumes: `ReceiptLine.side`, `ReceiptRow.conversion` (Task 5).
- Produces: cột "Mô tả món" của vế quy đổi là "Ra" / "Vào" (hoặc "Out" / "In").

- [ ] **Step 1: Viết test hỏng**

Thêm vào cuối khối `describe` trong `tests/lib/ledger-csv.test.ts`:

```ts
  it('writes a conversion a line per leg, saying which side each is on', () => {
    const conversion: ReceiptRow = {
      ...receipt, key: 'c1', receiptId: null, doc_no: 'PC49-2606-040', txn_type: 'TRANSFER_OUT',
      partner_code: null, partner_phone: null, sales_person_code: null, soldBy: [], payments: [],
      remarks: 'Transfer 637.5gr vang Grain ra 17L VRP', amount: 0,
      conversion: { id: 'c1', kind: 'TRANSFER', varianceNote: null, varianceReason: null },
      lines: [
        { ...receipt.lines[0], id: 'o', side: 'out', itemDesc: null, gold_type_code: 'GRAIN',
          scrap_detail: null, gold_pct: null, qty: -637.5, unit_price: null, amount: 0 },
        { ...receipt.lines[0], id: 'i', side: 'in', itemDesc: null, gold_type_code: 'RP',
          scrap_detail: null, gold_pct: null, uom: 'LUONG', qty: 17, unit_price: null, amount: 0 },
      ],
    }
    const rows = ledgerSheet([conversion], 'vi', gold).rows
    expect(rows.map((r) => [r[1], r[3], r[8], r[10], r[15]])).toEqual([
      ['PC49-2606-040', 'Ra', 'Vàng Grain', -637.5, 0],
      ['PC49-2606-040', 'Vào', 'Rồng Phụng', 17, 0],
    ])
  })
```

Run: `npx vitest run tests/lib/ledger-csv.test.ts`
Expected: FAIL — cột 3 là `null` thay vì `Ra` / `Vào`.

- [ ] **Step 2: Ghi bên**

Trong `src/components/gold/ledgerCsv.ts`, thay dòng `          r.txn_date, r.doc_no, l.lineNo, l.itemDesc, r.txn_type,` bằng:

```ts
          r.txn_date, r.doc_no, l.lineNo,
          // A conversion's leg has no description; which side it is on is what
          // somebody filtering the sheet needs.
          l.itemDesc ?? (l.side ? t(locale, l.side === 'out' ? 'conversion.side.out' : 'conversion.side.in') : null),
          r.txn_type,
```

Run: `npx vitest run tests/lib/ledger-csv.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 3: Commit**

```bash
git add src/components/gold/ledgerCsv.ts tests/lib/ledger-csv.test.ts
git commit -m "feat(conversion): the Excel file says which side each conversion leg is on"
```

### Task 10: Kiểm tra trên trình duyệt

**Files:**
- Modify: `scripts/support/receipts.mjs` (thêm `removeConversions`)
- Create: `scripts/verify-conversion.mjs`
- Modify: `package.json` (thêm `verify:conversion`)
- Modify: `scripts/verify-ledger.mjs`, `scripts/verify-live.mjs`

**Interfaces:**
- Consumes: migration 0077–0080 trên database thật; màn hình Task 7–9; `openPage`, `signIn`, `accountFor`, `until`, `untilRowIs`.
- Produces: `removeConversions(db, day)`; lệnh `npm run verify:conversion`.

- [ ] **Step 1: Dọn phiên thử**

Thêm vào cuối `scripts/support/receipts.mjs`:

```js
/**
 * Takes a check's conversions off the day it wrote them on, after its legs.
 * A correction points at the conversion it replaced, so that link goes first.
 */
export async function removeConversions(db, day) {
  await db.query('UPDATE pc49.gold_conversion SET corrects_conversion_id = NULL WHERE conv_date = $1', [day])
  await db.query('DELETE FROM pc49.gold_conversion WHERE conv_date = $1', [day])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'gold_conversion'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.gold_conversion)`)
}
```

- [ ] **Step 2: Script nhập phiên Nini**

Tạo `scripts/verify-conversion.mjs`:

```js
// Converting gold, typed the way the counter asked for it.
//
//   "cai transfer dau?"
//
// The exchange with Nini from 08-05, entered whole: 4 luong of Rong Phung out;
// 2 oz Credit Suisse, 1 oz other gold and 56.7 g of Grain in. The form weighs
// the two sides as they are typed and asks for a reason when they do not meet.
// Then the ledger is read (one row, the legs beneath by side), the stock is
// checked (nothing sent to the refinery), and the conversion is corrected (the
// ounce of other gold made up in Grain) and cancelled.
//
//   npm run verify:conversion      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { until, untilRowIs } from './support/until.mjs'
import { removeConversions } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-05-20'
const PERIOD = '2019-05'
const PARTNER = 'verify-conversion partner'
const SCREEN = `${BASE}/gold-transactions?date=${DAY}`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes on its day, and the partner it invents. */
async function cleanUp() {
  const txns = await db.query('SELECT id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  await db.query('UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  await removeConversions(db, DAY)
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

const group = (form, name) => form.getByRole('group', { name, exact: true })
const legs = (form, side) => form.getByRole('group', { name: new RegExp(`^${side} \\d+$`) })
const shown = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ')
const conversionsOnDay = async () => (await db.query(
  'SELECT count(*)::int AS n FROM pc49.gold_conversion WHERE conv_date = $1', [DAY])).rows[0].n

try {
  await cleanUp()

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- The exchange, typed once --------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Quy đổi vàng' }).first().click()
  const form = page.getByRole('dialog', { name: 'Quy đổi vàng', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  await form.getByLabel('Ghi chú', { exact: true }).fill('Doi voi Nini')

  const out1 = group(form, 'Ra 1')
  await choose(page, out1, 'Loại vàng', 'Rồng Phụng')
  await out1.getByLabel('Số lượng', { exact: true }).fill('4')

  const ins = [['Credit Suisse', '2'], ['Vàng khác', '1'], ['Vàng Grain', '50']]
  for (const [i, [gold, qty]] of ins.entries()) {
    if (i > 0) await form.getByRole('button', { name: 'Thêm dòng vào' }).click()
    const line = group(form, `Vào ${i + 1}`)
    await line.waitFor()
    await choose(page, line, 'Loại vàng', gold)
    await line.getByLabel('Số lượng', { exact: true }).fill(qty)
  }

  // 50 g of Grain where there were 56.7: 4.46 percent short.
  const reason = form.getByLabel('Lý do lệch', { exact: true })
  check('weights that do not meet ask for a reason', (await reason.count()) === 1)
  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()
  await page.waitForTimeout(1500)
  check('and nothing is saved without one', (await conversionsOnDay()) === 0,
    `${await conversionsOnDay()} conversion(s)`)

  await group(form, 'Vào 3').getByLabel('Số lượng', { exact: true }).fill('56.7')
  check('weights that meet ask for nothing', (await form.getByLabel('Lý do lệch', { exact: true }).count()) === 0)
  check('and the form says they balance', (await shown(form)).includes('Cân'))

  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const saved = await untilRowIs(db,
    `SELECT c.id, c.doc_no, c.variance_note, count(t.id)::int AS legs,
            count(t.journal_entry_id)::int AS posted, count(DISTINCT t.doc_no)::int AS numbers
       FROM pc49.gold_conversion c JOIN pc49.gold_txn t ON t.conversion_id = c.id
      WHERE c.conv_date = $1 AND c.voided_at IS NULL
      GROUP BY c.id`, [DAY], (r) => r.posted === 4)
  check('one conversion saves, its four legs posted', saved !== null,
    saved ? `${saved.doc_no}, ${saved.legs} legs` : '(nothing posted)')
  if (!saved) throw new Error('the conversion did not save')
  check('under one number', saved.numbers === 1)
  check('within the tolerance, so no variance is noted', saved.variance_note === null)

  const stock = await db.query(
    `SELECT count(*) FILTER (WHERE m.bucket = 'AT_REFINERY')::int AS refinery,
            coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'ON_HAND'), 0)::float8 AS on_hand
       FROM pc49.inventory_movement m JOIN pc49.gold_txn t ON t.id = m.source_id
      WHERE t.conversion_id = $1`, [saved.id])
  check('nothing is sent to the refinery', stock.rows[0].refinery === 0, `${stock.rows[0].refinery}`)
  check('and the vault holds 0.015 g more, as weighed', Math.abs(stock.rows[0].on_hand - 0.015) < 0.0005,
    `${stock.rows[0].on_hand} g`)

  // ---- One row in the ledger -----------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  const rows = page.locator('.ant-table-tbody tr.ant-table-row')
  check('the ledger lists the conversion once', (await rows.count()) === 1, `${await rows.count()} rows`)
  const row = rows.first()
  const rowText = await shown(row)
  check('as a conversion, one line out into three in',
    rowText.includes('Quy đổi') && rowText.includes('Nhiều loại (1 ra → 3 vào)'), rowText.slice(0, 160))
  check('moving 150 grams', rowText.includes('150.00 g'))
  await row.locator('.ant-table-row-expand-icon').click()
  const expanded = page.locator('.ant-table-expanded-row').first()
  await expanded.waitFor()
  const legsText = await shown(expanded)
  check('and its legs open beneath it, by side', legsText.includes('Ra 1') && legsText.includes('Vào 3'))

  // ---- Corrected: the ounce of other gold was Grain after all --------------
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click()
  const fix = page.getByRole('dialog', { name: 'Sửa quy đổi', exact: true }).last()
  await fix.waitFor()
  check('the correction opens holding every leg',
    (await legs(fix, 'Ra').count()) === 1 && (await legs(fix, 'Vào').count()) === 3)
  await group(fix, 'Vào 2').getByRole('button', { name: 'Bỏ dòng này' }).click()
  await until(async () => ((await legs(fix, 'Vào').count()) === 2 ? true : null))
  await fix.getByRole('button', { name: 'Thêm dòng vào' }).click()
  const added = group(fix, 'Vào 3')
  await added.waitFor()
  await choose(page, added, 'Loại vàng', 'Vàng Grain')
  await added.getByLabel('Số lượng', { exact: true }).fill('31.105')
  await fix.getByLabel('Lý do sửa', { exact: true }).fill('1 oz khac la Grain')
  await fix.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const fixed = await untilRowIs(db,
    `SELECT c.id, c.doc_no, c.corrects_conversion_id AS corrects, count(t.journal_entry_id)::int AS posted
       FROM pc49.gold_conversion c JOIN pc49.gold_txn t ON t.conversion_id = c.id
      WHERE c.conv_date = $1 AND c.voided_at IS NULL
      GROUP BY c.id`, [DAY], (r) => r.corrects === saved.id && r.posted === 4)
  check('the corrected conversion has four legs, posted', fixed !== null, fixed ? '' : '(not corrected)')
  if (!fixed) throw new Error('the correction did not save')
  check('and keeps its number', fixed.doc_no === saved.doc_no, fixed.doc_no)
  const old = await db.query(
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_conversion WHERE id = $1) AS conversion,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE conversion_id = $1 AND voided_at IS NULL) AS live`,
    [saved.id])
  check('the original is cancelled, every leg of it',
    old.rows[0].conversion === true && old.rows[0].live === 0, `${old.rows[0].live} live legs`)

  // ---- Cancelled -----------------------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Huỷ', exact: true }).first().click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiểm tra huỷ cả phiên')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  const cancelled = await untilRowIs(db,
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_conversion WHERE id = $1) AS conversion,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE conversion_id = $1 AND voided_at IS NULL) AS live`,
    [fixed.id], (r) => r.conversion === true && r.live === 0)
  check('cancelling takes every leg off the books at once', cancelled !== null)
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('and the ledger lists nothing for the day',
    (await page.locator('.ant-table-tbody tr.ant-table-row').count()) === 0)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.gold_conversion WHERE conv_date = $1) AS conversions,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.conversions, r.entries, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.conversions} conversions, ${r.entries} entries, ${r.partners} partners`)
  await db.end()
}

console.log(failures === 0 ? '\nALL CONVERSION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
```

Trong `package.json`, thay dòng `    "verify:receipt": "node --env-file=.env.local scripts/verify-receipt.mjs"` bằng:

```json
    "verify:receipt": "node --env-file=.env.local scripts/verify-receipt.mjs",
    "verify:conversion": "node --env-file=.env.local scripts/verify-conversion.mjs"
```

- [ ] **Step 3: Cập nhật hai script đọc sổ**

1. `scripts/verify-ledger.mjs`: đổi cả hai chỗ `count(DISTINCT coalesce(receipt_id, id))` thành `count(DISTINCT coalesce(receipt_id, conversion_id, id))`, và dòng chú thích `// The screen counts receipts and the file has a line per item (0076).` thành `// The screen counts receipts and conversions; the file has a line per item or leg (0080).`
2. `scripts/verify-live.mjs`: ngay sau dòng `        + (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date < '2025-01-01')` thêm:

```js
        + (SELECT count(*)::int FROM pc49.gold_conversion WHERE conv_date < '2025-01-01')
```

Run: `node --check scripts/verify-conversion.mjs && node --check scripts/support/receipts.mjs && node --check scripts/verify-ledger.mjs && node --check scripts/verify-live.mjs`
Expected: không lỗi.

- [ ] **Step 4: Commit**

```bash
git add scripts/support/receipts.mjs scripts/verify-conversion.mjs package.json scripts/verify-ledger.mjs scripts/verify-live.mjs
git commit -m "test(conversion): the Nini exchange is typed, weighed, corrected and cancelled in the browser"
```

- [ ] **Step 5: Đưa migration lên database thật (sau 08:00 UTC)**

Run: `date -u +%H:%M`. Chỉ tiếp tục khi từ `08:00` UTC trở đi (15:00 giờ VN) và trước `04:00` UTC hôm sau; sớm hơn thì dừng, báo người dùng giờ sẽ làm.

Run (nguyên văn, không song song lệnh nào khác): `npm run migrate`
Expected: áp dụng `0077_a_conversion_has_a_number`, `0078_a_conversion_is_saved_whole`, `0079_a_conversion_is_corrected_whole`, `0080_the_ledger_lists_conversions`.
Run: `npm run verify:live`
Expected: mọi dòng PASS.

- [ ] **Step 6: Chạy bản build trên máy và các kiểm tra**

Run: `npm run build` → build xong không lỗi.
Khởi động nền (tác vụ riêng): `node node_modules/next/dist/bin/next start -p 3149`; chờ `http://localhost:3149/login` trả 200 và có chữ PC49.

Chạy lần lượt, mỗi lệnh ghi ra file trong scratchpad (`S=` thư mục scratchpad), đọc file sau mỗi lệnh:

```bash
PC49_BASE_URL=http://localhost:3149 npm run verify:conversion > "$S/verify-conversion.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:receipt > "$S/verify-receipt-2.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:ledger > "$S/verify-ledger-2.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:void > "$S/verify-void-2.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=http://localhost:3149 npm run verify:correct > "$S/verify-correct-2.txt" 2>&1; echo "exit=$?"
```

Expected: mỗi lệnh `exit=0`, file kết thúc bằng `ALL … CHECKS PASSED`. Hỏng thì tìm nguyên nhân (superpowers:systematic-debugging), sửa, build lại, chạy lại.

Sau cùng: `npm run verify:live` → PASS hết. Dừng đúng tác vụ nền của server đã tạo.

### Task 11: Cổng kiểm tra, đẩy lên, kiểm tra trên Production

**Files:** không sửa file nào (trừ khi cổng hỏng).

**Interfaces:**
- Consumes: mọi task trước; migration đã có trên database thật (Task 10 Step 5).
- Produces: bản chạy trên `https://pc49-accounting.vercel.app` có quy đổi vàng.

- [ ] **Step 1: Cổng đầy đủ**

Chạy lần lượt, không lệnh nào song song:

```bash
npx vitest run tests/sql --maxWorkers=4
npx vitest run tests/lib
npm run typecheck
npm run lint
npm run build
```

Expected: tất cả PASS / không lỗi.

- [ ] **Step 2: Không có dấu vết công cụ AI**

```bash
git log origin/main..HEAD --format=%B | grep -ciE 'cl[a]ude|cod[e]x|co-authored'
git diff origin/main..HEAD | grep -ciE 'cl[a]ude|cod[e]x'
```

Expected: cả hai in `0`.

- [ ] **Step 3: Đẩy lên ngoài giờ nhập liệu**

Run: `date -u +%H:%M`. Chỉ đẩy khi ngoài `04:00`–`08:00` UTC (11:00–15:00 giờ VN).

Chạy riêng một lệnh:

```bash
git push origin main
```

Theo dõi triển khai bằng tác vụ nền: lặp `gh api "repos/quocviet-IT/PC49-Accounting-web-app/deployments?per_page=5"` tìm bản có `sha` bắt đầu bằng HEAD vừa đẩy, rồi `gh api "repos/quocviet-IT/PC49-Accounting-web-app/deployments/<id>/statuses" --jq '.[0].state'` tới khi là `success` hoặc `failure`.

- [ ] **Step 4: Kiểm tra trên Production**

Mỗi lệnh ghi ra file rồi đọc:

```bash
PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:conversion > "$S/prod-conversion.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:ledger > "$S/prod-ledger-2.txt" 2>&1; echo "exit=$?"
PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:receipt > "$S/prod-receipt-2.txt" 2>&1; echo "exit=$?"
npm run verify:live
```

Expected: `exit=0` cả ba; `verify:live` PASS hết.

- [ ] **Step 5: Báo người dùng**

Nói ngắn gọn bằng tiếng Việt:
- đã có nút "Quy đổi vàng" trong sổ giao dịch vàng; người dùng **tải lại trang (F5) một lần**;
- 26 phiên quy đổi cũ giờ mỗi phiên một dòng, sửa và huỷ được theo phiên;
- lỗi tồn kho "ở nhà phân kim" đã sửa;
- kết quả kiểm tra trên Production.

---

## Ghi chú cho người thực hiện

- **Phiên nạp từ bảng tính** gộp theo ngày (ví dụ 08/05 có 10 vế). Thiết kế không tách chúng; sửa một phiên như vậy là ghi lại cả phiên dưới số nhỏ nhất của các vế.
- **81 vế quy đổi nạp từ bảng tính chưa ghi sổ**, như gần hết dữ liệu nạp năm 2026. Sửa movement ở 0077 không đổi dòng tồn kho nào đã có; nó chỉ có hiệu lực khi các vế đó (hoặc phiên mới) được ghi sổ.
- **Tiền trong phiên quy đổi** là 0. Ghi sổ theo trọng lượng như `post_gold_txn` đang làm cho mọi vế chuyển vàng.

