# Đổ giao dịch vàng và phân kim 2026 — kế hoạch thực hiện

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa 1.126 giao dịch vàng tháng 1–6/2026 và 3 lô phân kim thật từ Google Sheets vào cơ sở dữ liệu PC49, qua màn hình Nạp dữ liệu, có đối chiếu với con số kế toán đã chốt.

**Architecture:** Bộ phiên dịch (Node) chỉ đổi tên cột và tra bảng, xuất CSV đúng khuôn bộ nạp. Mọi phán xét nằm trong SQL — `stage_import_row` trả dòng xấu kèm mã lý do, `commit_import_batch` ghi phần tốt, `post_import_batch` ghi sổ theo thứ tự ngày. Đặc tả: [`docs/superpowers/specs/2026-09-10-nap-giao-dich-vang-2026-design.md`](../specs/2026-09-10-nap-giao-dich-vang-2026-design.md).

**Tech Stack:** PostgreSQL (migration `supabase/migrations/00NN_*.sql`), vitest + PGlite (`tests/sql/*.test.ts`), Node 24 + Composio Google Sheets cho bộ phiên dịch.

## Global Constraints

- Migration đánh số tiếp theo `0061`; mỗi migration kết thúc bằng `INSERT INTO pc49.schema_migrations (version) VALUES ('<tên tệp không đuôi>') ON CONFLICT DO NOTHING;` và `NOTIFY pgrst, 'reload schema';` nếu có đổi bảng/hàm PostgREST đọc.
- Test SQL chạy bằng PGlite: `npx vitest run tests/sql/<tệp>.test.ts`. Test về **quyền** phải bọc `asRole(db, KT, …)` (`tests/support/db.ts`) vì test thường chạy bằng owner, miễn nhiễm grant.
- Quy ước dấu giữ nguyên: mua `qty > 0, amount <= 0`; bán `qty < 0, amount >= 0`. `gold_txn_payment.amount` luôn dương, chiều nằm ở `direction`.
- Tỷ lệ sales cố định: 1 người `[100]`, 2 người `[80,20]`, 3 người `[60,20,20]`, theo thứ tự viết trong ô.
- Hai nhóm vàng vụn: `10-18k/grs` và `19-24k/grs`, suy từ `scrap_detail` bằng `pc49.scrap_band()` (0058). Không suy từ `gold_pct`.
- Mọi mã lý do mới phải có câu tiếng Việt `imp.why.<MÃ>` và câu tiếng Anh tương ứng trong `src/lib/i18n/dictionary.ts`, nếu không màn hình hiện câu tiếng Anh thô.
- Không chạy `vercel deploy`; anh Việt tự chạy.

---

## File Structure

| Tệp | Trách nhiệm |
|---|---|
| `supabase/migrations/0062_a_transaction_arrives_whole.sql` | Bộ nạp giao dịch mang theo thanh toán và sales; tự tạo khách và sales chưa có |
| `supabase/migrations/0063_a_transfer_says_why.sql` | Gộp chuyển đổi thành phiên quy đổi; nối giao hàng với phiếu cọc; gắn chuyển đổi vào lô phân kim |
| `supabase/migrations/0064_a_batch_reaches_the_books.sql` | `post_import_batch` — ghi sổ cả lô theo thứ tự ngày, báo lại dòng hỏng |
| `supabase/migrations/0065_a_lot_arrives_with_its_bags.sql` | Mỗi dòng nạp phân kim là một túi; lô dựng thẳng ở trạng thái cuối |
| `tests/sql/import-gold.test.ts` | Test cho 0062–0064 |
| `tests/sql/import-refining.test.ts` | Test cho 0065 |
| `scripts/sheet-to-import.mjs` | Đọc Google Sheets → CSV khuôn bộ nạp; chỉ tra bảng, không phán xét |
| `scripts/lib/sheet-map.mjs` | Bảng tra thuần (loại vàng, đơn vị, loại giao dịch, hình thức trả) + hàm chia sales |
| `tests/lib/sheet-map.test.ts` | Test bảng tra |
| `scripts/load-2026.mjs` | Chạy thật: dọn demo, dựng nền, nạp từng lô, ghi sổ, đối chiếu |
| `src/lib/i18n/dictionary.ts` | Câu tiếng Việt/Anh cho mã lý do mới |

---

## Task 1: Giao dịch đến nơi nguyên vẹn — thanh toán và sales

**Files:**
- Create: `supabase/migrations/0062_a_transaction_arrives_whole.sql`
- Create: `tests/sql/import-gold.test.ts`
- Modify: `src/lib/i18n/dictionary.ts` (thêm `imp.why.TOO_MANY_SALES`, `imp.why.BAD_PAYMENT`)

**Interfaces:**
- Consumes: `pc49.stage_import_row(uuid, int, jsonb)`, `pc49.commit_import_batch(uuid, boolean)` (0038), `pc49.import_row`, `pc49.gold_txn_payment`, `pc49.gold_txn_sales_person`
- Produces:
  - Payload khoá mới cho nguồn `GOLD_TXN`: `payments` dạng `AP:CASH:100000|AP:CHECK:40000`, `sales` dạng `N.Ý/T.Quỳnh`
  - `pc49.parse_payments(p_spec text) RETURNS TABLE(seq int, direction pc49.payment_direction, method pc49.payment_method, amount numeric)`
  - `pc49.sales_shares(p_names text) RETURNS TABLE(seq int, code text, share_pct numeric)`
  - Mã lý do mới: `TOO_MANY_SALES`, `BAD_PAYMENT`

- [ ] **Step 1: Viết test đỏ cho thanh toán và sales**

Thêm vào `tests/sql/import-gold.test.ts` (tệp mới, dựng theo mẫu `tests/sql/import-commit.test.ts`):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function batch(source = 'GOLD_TXN'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.import_batch (source, file_name) VALUES ($1, 'test.csv') RETURNING id`,
    [source])
  return r.rows[0].id
}

async function stage(batchId: string, rowNo: number, payload: Record<string, string>) {
  const r = await db.query<{ stage_import_row: string }>(
    `SELECT pc49.stage_import_row($1, $2, $3::jsonb)::text`, [batchId, rowNo, JSON.stringify(payload)])
  return r.rows[0].stage_import_row
}

const buy = {
  txn_date: '2026-01-15', txn_type: 'PO', gold_type_code: 'SG', uom: 'GRAM',
  qty: '10', unit_price: '65', amount: '-650', partner_code: 'Chi Lan',
  scrap_detail: '14k/grs',
}

describe('a transaction arrives with the money and the people on it', () => {
  it('writes the payments the sheet recorded against it', async () => {
    // Không có dòng thanh toán thì post_gold_txn từ chối ghi sổ, nên một
    // giao dịch nạp vào mà thiếu tiền là một giao dịch nằm ngoài sổ.
    const b = await batch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:400|AP:CHECK:250' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ seq: number; direction: string; method: string; amount: string }>(
      `SELECT p.seq, p.direction::text, p.method::text, p.amount::text
         FROM pc49.gold_txn_payment p
         JOIN pc49.import_row r ON r.committed_ref = p.txn_id
        WHERE r.batch_id = $1 ORDER BY p.seq`, [b])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ seq: 1, direction: 'AP', method: 'CASH' })
    expect(Number(r.rows[0].amount)).toBe(400)
    expect(r.rows[1].method).toBe('CHECK')
  })

  it('splits two sales people eighty–twenty, in the order they were written', async () => {
    const b = await batch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:650', sales: 'N.Ý/T.Quỳnh' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ code: string; share: string }>(
      `SELECT s.sales_person_code AS code, s.share_pct::text AS share
         FROM pc49.gold_txn_sales_person s
         JOIN pc49.import_row r ON r.committed_ref = s.txn_id
        WHERE r.batch_id = $1 ORDER BY s.seq`, [b])
    expect(r.rows.map((x) => [x.code, Number(x.share)]))
      .toEqual([['N.Ý', 80], ['T.Quỳnh', 20]])
  })

  it('registers a sales person the system has never seen', async () => {
    // Bảy tên trong sheet chưa có trong hệ thống; chờ khai báo tay là treo
    // 113 dòng giao dịch.
    const b = await batch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:650', sales: 'Q.Nghi' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.sales_person WHERE code = 'Q.Nghi'`)
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('registers a customer the system has never seen', async () => {
    const b = await batch()
    await stage(b, 2, { ...buy, partner_code: 'Nguyễn Văn Mới', payments: 'AP:CASH:650' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.partner WHERE code = 'Nguyễn Văn Mới'`)
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('turns back a row naming four sales people', async () => {
    // Kế toán trả lời: nhiều nhất ba người. Ô thứ tư là lỗi gõ, và đoán tỷ lệ
    // cho nó là tự bịa ra một cách chia hoa hồng chưa từng có.
    const b = await batch()
    const status = await stage(b, 2, { ...buy, sales: 'A/B/C/D' })
    expect(status).toBe('REJECTED')
    const r = await db.query<{ code: string; value: string }>(
      `SELECT reason_code AS code, reason_value AS value FROM pc49.import_row
        WHERE batch_id = $1 AND row_no = 2`, [b])
    expect(r.rows[0].code).toBe('TOO_MANY_SALES')
    expect(r.rows[0].value).toBe('A/B/C/D')
  })

  it('turns back a payment it cannot read', async () => {
    const b = await batch()
    const status = await stage(b, 2, { ...buy, payments: 'AP:VENMO:400' })
    expect(status).toBe('REJECTED')
    const r = await db.query<{ code: string; value: string }>(
      `SELECT reason_code AS code, reason_value AS value FROM pc49.import_row
        WHERE batch_id = $1 AND row_no = 2`, [b])
    expect(r.rows[0].code).toBe('BAD_PAYMENT')
    expect(r.rows[0].value).toBe('AP:VENMO:400')
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/sql/import-gold.test.ts`
Expected: FAIL — 6 test đỏ; hai test lý do báo `reason_code` là `null`, bốn test kia báo không có dòng `gold_txn_payment` / `gold_txn_sales_person` / `sales_person` / `partner`.

- [ ] **Step 3: Viết migration 0062**

Tạo `supabase/migrations/0062_a_transaction_arrives_whole.sql` với, theo thứ tự:

1. `pc49.parse_payments(p_spec text)` — `LANGUAGE sql IMMUTABLE`, tách `p_spec` theo `|`, mỗi phần theo `:`, trả `(seq, direction, method, amount)`. Phần rỗng bị bỏ qua. Ép kiểu enum để chuỗi lạ tự ném lỗi:

```sql
CREATE OR REPLACE FUNCTION pc49.parse_payments(p_spec text)
RETURNS TABLE (seq int, direction pc49.payment_direction,
               method pc49.payment_method, amount numeric)
LANGUAGE sql IMMUTABLE AS $$
  SELECT row_number() OVER (ORDER BY ord)::int,
         split_part(part, ':', 1)::pc49.payment_direction,
         split_part(part, ':', 2)::pc49.payment_method,
         abs(split_part(part, ':', 3)::numeric)
    FROM unnest(string_to_array(coalesce(p_spec, ''), '|'))
         WITH ORDINALITY AS t(part, ord)
   WHERE btrim(part) <> ''
$$;
```

2. `pc49.sales_shares(p_names text)` — tách theo `/` và `,`, bỏ khoảng trắng, bỏ phần rỗng, trả `(seq, code, share_pct)` với tỷ lệ tra từ số người: 1→`{100}`, 2→`{80,20}`, 3→`{60,20,20}`, từ 4 trở lên trả 0 dòng (chỗ gọi phải đã chặn trước).

3. Bổ sung `pc49.stage_import_row` (chép nguyên bản 0031, thêm hai nhánh **trước** khối `IF v_code IS NOT NULL`):

```sql
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
```

   và hai câu tiếng Anh trong khối `CASE v_code`:
   `WHEN 'TOO_MANY_SALES' THEN format('%s names more than three sales people', v_value)`
   `WHEN 'BAD_PAYMENT' THEN format('cannot read the payment %s', v_value)`

4. Bổ sung `pc49.commit_import_batch` (chép nguyên bản 0038; giữ nguyên mọi nhánh khác), trong nhánh `WHEN 'GOLD_TXN'`, **trước** câu `INSERT INTO pc49.gold_txn`:

```sql
        IF coalesce(p ->> 'partner_code', '') <> '' THEN
          INSERT INTO pc49.partner (code) VALUES (p ->> 'partner_code')
          ON CONFLICT (code) DO NOTHING;
        END IF;
        INSERT INTO pc49.sales_person (code, full_name)
        SELECT s.code, s.code FROM pc49.sales_shares(p ->> 'sales') s
        ON CONFLICT (code) DO NOTHING;
```

   `sales_person_code` trên thân giao dịch lấy tên đầu tiên:
   `(SELECT code FROM pc49.sales_shares(p ->> 'sales') WHERE seq = 1)`

   và **sau** khi có `v_ref`:

```sql
        INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, method, amount, paid_at)
        SELECT v_ref, x.seq, x.direction, x.method, x.amount, (p ->> 'txn_date')::date
          FROM pc49.parse_payments(p ->> 'payments') x;

        INSERT INTO pc49.gold_txn_sales_person (txn_id, seq, sales_person_code, share_pct)
        SELECT v_ref, s.seq, s.code, s.share_pct
          FROM pc49.sales_shares(p ->> 'sales') s;
```

5. `NOTIFY pgrst, 'reload schema';` và dòng `schema_migrations`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/sql/import-gold.test.ts`
Expected: PASS 6/6.

- [ ] **Step 5: Thêm câu tiếng Việt cho hai mã lý do**

Trong `src/lib/i18n/dictionary.ts`, cạnh `imp.why.MISSING_QTY`:

```ts
    'imp.why.TOO_MANY_SALES': 'Ô sales ghi {0} — nhiều hơn ba người',
    'imp.why.BAD_PAYMENT': 'Không đọc được hình thức thanh toán {0}',
```

và trong khối tiếng Anh:

```ts
    'imp.why.TOO_MANY_SALES': '{0} names more than three sales people',
    'imp.why.BAD_PAYMENT': 'Cannot read the payment {0}',
```

- [ ] **Step 6: Chạy toàn bộ cổng, rồi commit**

Run: `npx vitest run && npx tsc --noEmit && npx eslint src`
Expected: toàn bộ test xanh (563 + 6), typecheck và lint sạch.

```bash
git add supabase/migrations/0062_a_transaction_arrives_whole.sql tests/sql/import-gold.test.ts src/lib/i18n/dictionary.ts
git commit -m "feat(import): a transaction arrives with its money and its people"
```

---

## Task 2: Chuyển đổi nói được vì sao, và giao hàng tìm được phiếu cọc

**Files:**
- Create: `supabase/migrations/0063_a_transfer_says_why.sql`
- Modify: `tests/sql/import-gold.test.ts` (thêm khối `describe` thứ hai)
- Modify: `src/lib/i18n/dictionary.ts` (thêm `imp.why.NO_CONVERSION`)

**Interfaces:**
- Consumes: `pc49.parse_payments`, `pc49.sales_shares` (Task 1); `pc49.gold_conversion`; ràng buộc `gold_txn_transfer_needs_conversion`, `gold_txn_pickup_needs_deposit`
- Produces: payload khoá mới `conv_key`, `lot_code`, `deposit_key`; mã lý do `NO_CONVERSION`

- [ ] **Step 1: Viết test đỏ**

Thêm vào `tests/sql/import-gold.test.ts`:

```ts
describe('a transfer says why it happened', () => {
  it('makes one conversion out of the rows that share a key', async () => {
    // Sheet ghi chuyển đổi thành các dòng rời trong cùng một ngày. Một phiên
    // quy đổi là cái nối chúng lại, và là cái hệ thống đòi trước khi cho vàng
    // rời loại này sang loại kia.
    const b = await batch()
    await stage(b, 2, { txn_date: '2026-01-05', txn_type: 'TRANSFER_OUT',
      gold_type_code: 'GRAIN', uom: 'GRAM', qty: '-975', amount: '0', conv_key: '2026-01-05#1' })
    await stage(b, 3, { txn_date: '2026-01-05', txn_type: 'TRANSFER_IN',
      gold_type_code: 'RP', uom: 'LUONG', qty: '26', amount: '0', conv_key: '2026-01-05#1' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ n: string; convs: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT t.conversion_id)::text AS convs
         FROM pc49.gold_txn t JOIN pc49.import_row r ON r.committed_ref = t.id
        WHERE r.batch_id = $1`, [b])
    expect(Number(r.rows[0].n)).toBe(2)
    expect(Number(r.rows[0].convs)).toBe(1)
  })

  it('turns back a transfer with nothing to explain it', async () => {
    // Mười ngày trong sáu tháng không cân gram khi gộp cả ngày. Đoán ra một
    // phiên quy đổi cho chúng là bịa ra một việc chưa từng xảy ra.
    const b = await batch()
    const status = await stage(b, 2, { txn_date: '2026-02-11', txn_type: 'TRANSFER_OUT',
      gold_type_code: 'RP', uom: 'LUONG', qty: '-5', amount: '0' })
    expect(status).toBe('REJECTED')
    const r = await db.query<{ code: string }>(
      `SELECT reason_code AS code FROM pc49.import_row WHERE batch_id = $1 AND row_no = 2`, [b])
    expect(r.rows[0].code).toBe('NO_CONVERSION')
  })

  it('hangs a scrap transfer on the refining lot it went to', async () => {
    await db.query(
      `INSERT INTO pc49.refining_lot (lot_code, refinery_name) VALUES ('S26.09', 'Test')`)
    const b = await batch()
    await stage(b, 2, { txn_date: '2026-01-06', txn_type: 'TRANSFER_OUT',
      gold_type_code: 'SG', uom: 'GRAM', qty: '-195.09', amount: '0', lot_code: 'S26.09' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ lot: string }>(
      `SELECT l.lot_code AS lot FROM pc49.gold_txn t
         JOIN pc49.refining_lot l ON l.id = t.refining_lot_id
         JOIN pc49.import_row r ON r.committed_ref = t.id
        WHERE r.batch_id = $1`, [b])
    expect(r.rows[0].lot).toBe('S26.09')
  })

  it('points a pickup at the deposit it settles', async () => {
    // Sheet ghi cả tiền cọc và tiền lấy hàng trên một dòng. Hệ thống ghi đúng
    // như nó xảy ra: nhận cọc hôm nay, giao hàng hôm khác.
    const b = await batch()
    await stage(b, 2, { txn_date: '2026-01-10', txn_type: 'DEPOSIT',
      gold_type_code: 'RP', uom: 'LUONG', qty: '-1', amount: '0',
      partner_code: 'Kelvin Tran', payments: 'AR:CASH:2000', deposit_key: 'd-1' })
    await stage(b, 3, { txn_date: '2026-01-28', txn_type: 'PICKUP',
      gold_type_code: 'RP', uom: 'LUONG', qty: '-1', amount: '5310',
      partner_code: 'Kelvin Tran', payments: 'AR:CASH:3310', deposit_key: 'd-1' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ dep: string; pick: string }>(
      `SELECT d.id::text AS dep, p.deposit_ref_id::text AS pick
         FROM pc49.gold_txn p
         JOIN pc49.import_row rp ON rp.committed_ref = p.id AND rp.row_no = 3
         JOIN pc49.import_row rd ON rd.batch_id = rp.batch_id AND rd.row_no = 2
         JOIN pc49.gold_txn d ON d.id = rd.committed_ref
        WHERE rp.batch_id = $1`, [b])
    expect(r.rows[0].pick).toBe(r.rows[0].dep)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/sql/import-gold.test.ts`
Expected: FAIL — 4 test mới đỏ; ba test đầu báo vi phạm `gold_txn_transfer_needs_conversion`, test cuối báo vi phạm `gold_txn_pickup_needs_deposit`.

- [ ] **Step 3: Viết migration 0063**

Tạo `supabase/migrations/0063_a_transfer_says_why.sql`:

1. Bổ sung `pc49.stage_import_row` (chép bản 0062, thêm nhánh):

```sql
  IF v_code IS NULL AND v_source = 'GOLD_TXN'
     AND (p_payload ->> 'txn_type') IN ('TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP')
     AND coalesce(p_payload ->> 'conv_key', '') = ''
     AND coalesce(p_payload ->> 'lot_code', '') = '' THEN
    v_code := 'NO_CONVERSION'; v_value := p_payload ->> 'txn_date';
  END IF;
```

   câu tiếng Anh: `WHEN 'NO_CONVERSION' THEN format('a transfer on %s with no conversion and no lot to explain it', v_value)`

2. Bổ sung `pc49.commit_import_batch` (chép bản 0062). Khai thêm biến cạnh `v_entries`: `v_convs jsonb := '{}'::jsonb;`, `v_deps jsonb := '{}'::jsonb;`, `v_conv_id uuid;`, `v_lot_id uuid;`, `v_dep_id uuid;`. Trong nhánh `WHEN 'GOLD_TXN'`, trước `INSERT INTO pc49.gold_txn`, dựng `v_conv_id`, `v_lot_id`, `v_dep_id`:

```sql
        v_conv_id := NULL; v_lot_id := NULL; v_dep_id := NULL;

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
            RAISE EXCEPTION 'row % names lot %, which does not exist; load the lots first',
              r.row_no, p ->> 'lot_code';
          END IF;
        END IF;

        IF coalesce(p ->> 'deposit_key', '') <> ''
           AND (p ->> 'txn_type') IN ('PICKUP', 'CANCEL') THEN
          v_dep_id := nullif(v_deps ->> (p ->> 'deposit_key'), '')::uuid;
        END IF;
```

   thêm `conversion_id, refining_lot_id, deposit_ref_id` vào danh sách cột của `INSERT INTO pc49.gold_txn` với giá trị `v_conv_id, v_lot_id, v_dep_id`; và sau khi có `v_ref`, ghi nhớ phiếu cọc:

```sql
        IF coalesce(p ->> 'deposit_key', '') <> '' AND (p ->> 'txn_type') = 'DEPOSIT' THEN
          v_deps := v_deps || jsonb_build_object(p ->> 'deposit_key', v_ref);
        END IF;
```

   Phiếu cọc phải nằm **trước** phiếu giao hàng trong cùng lô — bộ phiên dịch xuất theo thứ tự đó (Task 5), và test bước 1 chứng minh nó chạy.

3. `NOTIFY pgrst, 'reload schema';` và dòng `schema_migrations`.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/sql/import-gold.test.ts`
Expected: PASS 10/10.

- [ ] **Step 5: Câu tiếng Việt cho `NO_CONVERSION`**

```ts
    'imp.why.NO_CONVERSION': 'Chuyển đổi ngày {0} không gắn với phiên quy đổi hay lô phân kim nào',
```
```ts
    'imp.why.NO_CONVERSION': 'A transfer on {0} with no conversion and no lot to explain it',
```

- [ ] **Step 6: Cổng và commit**

Run: `npx vitest run && npx tsc --noEmit && npx eslint src`

```bash
git add supabase/migrations/0063_a_transfer_says_why.sql tests/sql/import-gold.test.ts src/lib/i18n/dictionary.ts
git commit -m "feat(import): a transfer says why, and a pickup finds its deposit"
```

---

## Task 3: Cả lô nạp đi vào sổ

**Files:**
- Create: `supabase/migrations/0064_a_batch_reaches_the_books.sql`
- Modify: `tests/sql/import-gold.test.ts`

**Interfaces:**
- Consumes: `pc49.post_gold_txn(uuid)`, `pc49.import_row.committed_ref`
- Produces: `pc49.post_import_batch(p_batch_id uuid) RETURNS TABLE(row_no int, txn_id uuid, error text)` — trả **những dòng không ghi sổ được**; không dòng nào trả về nghĩa là cả lô đã vào sổ

- [ ] **Step 1: Viết test đỏ**

```ts
describe('a batch reaches the books', () => {
  it('posts every committed transaction, oldest first', async () => {
    const b = await batch()
    await stage(b, 2, { ...buy, txn_date: '2026-01-15', payments: 'AP:CASH:650' })
    await stage(b, 3, { ...buy, txn_date: '2026-01-16', payments: 'AP:CASH:650' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const bad = await db.query(`SELECT * FROM pc49.post_import_batch($1)`, [b])
    expect(bad.rows).toEqual([])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn t
         JOIN pc49.import_row i ON i.committed_ref = t.id
        WHERE i.batch_id = $1 AND t.journal_entry_id IS NOT NULL`, [b])
    expect(Number(r.rows[0].n)).toBe(2)
  })

  it('names the row it could not post instead of stopping', async () => {
    // Một dòng hỏng không được phép chặn 1.125 dòng còn lại; người nạp cần
    // biết dòng nào, ở sheet dòng bao nhiêu.
    const b = await batch()
    await stage(b, 2, { ...buy, txn_date: '2026-01-15', payments: 'AP:CASH:650' })
    await stage(b, 3, { ...buy, txn_date: '2026-01-16' })  // không có thanh toán
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const bad = await db.query<{ row_no: number; error: string }>(
      `SELECT row_no, error FROM pc49.post_import_batch($1)`, [b])
    expect(bad.rows).toHaveLength(1)
    expect(bad.rows[0].row_no).toBe(3)
    expect(bad.rows[0].error).toMatch(/no payments/i)
  })

  it('is safe to run twice', async () => {
    const b = await batch()
    await stage(b, 2, { ...buy, txn_date: '2026-01-15', payments: 'AP:CASH:650' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    await db.query(`SELECT * FROM pc49.post_import_batch($1)`, [b])
    const again = await db.query(`SELECT * FROM pc49.post_import_batch($1)`, [b])
    expect(again.rows).toEqual([])
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/sql/import-gold.test.ts -t "reaches the books"`
Expected: FAIL — `function pc49.post_import_batch(uuid) does not exist`.

- [ ] **Step 3: Viết migration 0064**

```sql
CREATE OR REPLACE FUNCTION pc49.post_import_batch(p_batch_id uuid)
RETURNS TABLE (row_no int, txn_id uuid, error text)
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  r record;
BEGIN
  -- Theo ngày, vì phiếu cọc phải vào sổ trước phiếu giao hàng nó trả.
  FOR r IN
    SELECT i.row_no AS rn, t.id AS tid
      FROM pc49.import_row i
      JOIN pc49.gold_txn t ON t.id = i.committed_ref
     WHERE i.batch_id = p_batch_id
       AND i.status = 'COMMITTED'
       AND t.journal_entry_id IS NULL
       AND t.voided_at IS NULL
     ORDER BY t.txn_date, i.row_no
  LOOP
    BEGIN
      PERFORM pc49.post_gold_txn(r.tid);
    EXCEPTION WHEN others THEN
      -- Một dòng hỏng không chặn cả lô; nó được nêu tên và đi tiếp.
      row_no := r.rn; txn_id := r.tid; error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION pc49.post_import_batch(uuid) TO authenticated;
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/sql/import-gold.test.ts`
Expected: PASS 13/13.

- [ ] **Step 5: Cổng và commit**

Run: `npx vitest run && npx tsc --noEmit && npx eslint src`

```bash
git add supabase/migrations/0064_a_batch_reaches_the_books.sql tests/sql/import-gold.test.ts
git commit -m "feat(import): a whole batch reaches the books, and says which row would not"
```

---

## Task 4: Mỗi dòng nạp phân kim là một túi

**Files:**
- Create: `supabase/migrations/0065_a_lot_arrives_with_its_bags.sql`
- Create: `tests/sql/import-refining.test.ts`

**Interfaces:**
- Consumes: `pc49.refining_lot`, `pc49.refining_lot_line`, `commit_import_batch` nhánh `REFINING_LOT`
- Produces: nguồn `REFINING_LOT` giờ nhận **một dòng cho một túi**, khoá payload: `lot_code`, `status`, `refinery_name`, `sent_date`, `assay_date`, `received_date`, `spot_gold_per_oz_sent`, `spot_pt_per_oz_sent`, `spot_gold_per_oz_assay`, `spot_pt_per_oz_assay`, `fee_pct_gold`, `fee_pct_pt`, `note`, `seq`, `owner_code`, `metal`, `gold_type_code`, `source_desc`, `gross_weight_gram`, `gold_pct`, `assay_weight_gram`, `assay_pct`

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function batch(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.import_batch (source, file_name) VALUES ('REFINING_LOT', 'lots.csv') RETURNING id`)
  return r.rows[0].id
}
const stage = (b: string, n: number, p: Record<string, string>) =>
  db.query(`SELECT pc49.stage_import_row($1, $2, $3::jsonb)`, [b, n, JSON.stringify(p)])

const lot = {
  lot_code: 'S26.01', status: 'ASSAYED', refinery_name: 'CTY4',
  sent_date: '2026-01-06', assay_date: '2026-01-20',
  spot_gold_per_oz_sent: '4498', spot_pt_per_oz_sent: '2170',
  spot_gold_per_oz_assay: '4450', spot_pt_per_oz_assay: '2432',
  fee_pct_gold: '0.5', fee_pct_pt: '5',
}

describe('a lot arrives with its bags', () => {
  it('makes one lot out of the rows that share its code', async () => {
    const b = await batch()
    await stage(b, 2, { ...lot, seq: '1', owner_code: 'PC49', metal: 'PLATINUM',
      gold_type_code: 'PT', gross_weight_gram: '195.09', gold_pct: '0.9999',
      assay_weight_gram: '194.93', assay_pct: '0.9916' })
    await stage(b, 3, { ...lot, seq: '2', owner_code: 'PC49', metal: 'PLATINUM',
      gold_type_code: 'PT', gross_weight_gram: '112.77', gold_pct: '0.9999' })
    await db.query(`SELECT pc49.commit_import_batch($1, false)`, [b])
    const r = await db.query<{ lots: string; bags: string; status: string }>(
      `SELECT (SELECT count(*) FROM pc49.refining_lot WHERE lot_code = 'S26.01')::text AS lots,
              (SELECT count(*) FROM pc49.refining_lot_line l
                 JOIN pc49.refining_lot t ON t.id = l.lot_id
                WHERE t.lot_code = 'S26.01')::text AS bags,
              (SELECT status::text FROM pc49.refining_lot WHERE lot_code = 'S26.01') AS status`)
    expect(r.rows[0]).toMatchObject({ lots: '1', bags: '2', status: 'ASSAYED' })
  })

  it('keeps the assay figures the refinery sent back', async () => {
    const r = await db.query<{ w: string; p: string }>(
      `SELECT l.assay_weight_gram::text AS w, l.assay_pct::text AS p
         FROM pc49.refining_lot_line l JOIN pc49.refining_lot t ON t.id = l.lot_id
        WHERE t.lot_code = 'S26.01' AND l.seq = 1`)
    expect(Number(r.rows[0].w)).toBeCloseTo(194.93, 2)
    expect(Number(r.rows[0].p)).toBeCloseTo(0.9916, 4)
  })

  it('does not book a second set of transfer legs for a lot loaded as sent', async () => {
    // Chân chuyển kho của ba lô này chính là các dòng Transfer kế toán đã ghi
    // trong sheet. Trigger 0056 chỉ chạy khi CẬP NHẬT trạng thái, nên lô dựng
    // thẳng ở trạng thái cuối không sinh thêm chân thứ hai — test này là cái
    // giữ cho điều đó đúng.
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn t
         JOIN pc49.refining_lot l ON l.id = t.refining_lot_id
        WHERE l.lot_code = 'S26.01'`)
    expect(Number(r.rows[0].n)).toBe(0)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/sql/import-refining.test.ts`
Expected: FAIL — test 1 báo `bags: '0'` và `status: 'DRAFT'`; test 2 không có dòng nào.

- [ ] **Step 3: Viết migration 0065**

Bổ sung `pc49.commit_import_batch` (chép bản 0063), thay toàn bộ nhánh `WHEN 'REFINING_LOT'`:

```sql
      WHEN 'REFINING_LOT' THEN
        -- Mỗi dòng là một túi. Lô dựng một lần, ở đúng trạng thái cuối của nó:
        -- trigger sinh chân chuyển kho chỉ chạy khi CẬP NHẬT trạng thái, nên
        -- sổ giữ đúng một bộ chân, là bộ kế toán đã ghi trong sheet.
        SELECT id INTO v_lot_id FROM pc49.refining_lot WHERE lot_code = p ->> 'lot_code';
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
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/sql/import-refining.test.ts`
Expected: PASS 3/3.

- [ ] **Step 5: Cổng và commit**

Run: `npx vitest run && npx tsc --noEmit && npx eslint src`

```bash
git add supabase/migrations/0065_a_lot_arrives_with_its_bags.sql tests/sql/import-refining.test.ts
git commit -m "feat(import): a refining lot arrives with the bags that went in it"
```

---

## Task 5: Bộ phiên dịch sheet → CSV

**Files:**
- Create: `scripts/lib/sheet-map.mjs`
- Create: `tests/lib/sheet-map.test.ts`
- Create: `scripts/sheet-to-import.mjs`

**Interfaces:**
- Produces, từ `scripts/lib/sheet-map.mjs`:
  - `GOLD_TYPE: Record<string,string>` — `'Rong Phung'→'RP'`, `'Scrap gold'→'SG'`, `'Credit Suisse'→'CS'`, `'Maple Leaf'→'ML'`, `'American Eagle'→'AE'`, `'Grain'→'GRAIN'`, `'9999'→'9999'`, `'PT'→'PT'`, `'Other'→'OTH'`
  - `UOM: Record<string,string>` — `'Lượng'→'LUONG'`, `'Oz'→'OZ'`, `'Gram'→'GRAM'`
  - `TXN_TYPE: Record<string,string>` — `'PO'→'PO'`, `'PO(Vendor)'→'PO_VENDOR'`, `'Sale'→'SALE'`, `'Memo'→'MEMO'`, `'Ra RP'→'RA_RP'`
  - `METHOD: Record<string,string>` — `'Cash'→'CASH'`, `'Check'→'CHECK'`, `'Zelle'→'ZELLE'`, `'Bank wire'→'BANKWIRE'`
  - `money(raw: string): number | null` — bỏ `$ , ( )`, ngoặc là số âm
  - `isoDate(raw: string): string | null` — nhận `MM-DD-YYYY` và `M/D/YY`, trả `YYYY-MM-DD`
  - `payments(entries: {direction, method, amount}[]): string` — nối `AP:CASH:400|AP:CHECK:250`, bỏ số 0 và số rỗng
  - `NOTE_NOT_CUSTOMER: RegExp` — nhận ra ô khách thực ra là ghi chú (`send to assay`, `gởi`, `transfer`)

- [ ] **Step 1: Viết test đỏ cho bảng tra**

Tạo `tests/lib/sheet-map.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GOLD_TYPE, UOM, money, isoDate, payments, NOTE_NOT_CUSTOMER } from '../../scripts/lib/sheet-map.mjs'

describe('the sheet, read as the system reads it', () => {
  it('names the nine gold types the way the system does', () => {
    expect(GOLD_TYPE['Rong Phung']).toBe('RP')
    expect(GOLD_TYPE['Scrap gold']).toBe('SG')
    expect(GOLD_TYPE['Credit Suisse']).toBe('CS')
    expect(Object.keys(GOLD_TYPE)).toHaveLength(9)
  })

  it('reads a unit', () => {
    expect(UOM['Lượng']).toBe('LUONG')
    expect(UOM['Oz']).toBe('OZ')
  })

  it('reads money the way the sheet writes it, brackets and all', () => {
    expect(money('-$864,640')).toBe(-864640)
    expect(money('$5,310.00')).toBe(5310)
    expect(money('($55,357.18)')).toBe(-55357.18)
    expect(money('')).toBe(null)
    expect(money('-')).toBe(null)
  })

  it('reads both date shapes the workbooks use', () => {
    // Bảng giao dịch viết 01-31-2026; bảng phân kim viết 1/6/26.
    expect(isoDate('01-31-2026')).toBe('2026-01-31')
    expect(isoDate('1/6/26')).toBe('2026-01-06')
    expect(isoDate('Begin')).toBe(null)
  })

  it('writes a payment spec the loader can read back', () => {
    expect(payments([
      { direction: 'AP', method: 'CASH', amount: -100000 },
      { direction: 'AP', method: 'CHECK', amount: -40000 },
      { direction: 'AP', method: 'CASH', amount: 0 },
    ])).toBe('AP:CASH:100000|AP:CHECK:40000')
    expect(payments([])).toBe('')
  })

  it('knows a customer cell that is really a note', () => {
    // 656 tên trong cột khách, và một số không phải khách.
    expect(NOTE_NOT_CUSTOMER.test('Send to assay')).toBe(true)
    expect(NOTE_NOT_CUSTOMER.test('Transfer 1L vàng 9999 ra 37.5gr vàng Grain')).toBe(true)
    expect(NOTE_NOT_CUSTOMER.test('Kelvin Tran')).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/lib/sheet-map.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/lib/sheet-map.mjs'`.

- [ ] **Step 3: Viết `scripts/lib/sheet-map.mjs`**

Chỉ chứa hằng số và hàm thuần, không đọc mạng, không đọc tệp — đó là lý do nó test được. Nội dung theo đúng danh sách ở **Interfaces** trên.

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/lib/sheet-map.test.ts`
Expected: PASS 6/6.

- [ ] **Step 5: Viết `scripts/sheet-to-import.mjs`**

Đọc Google Sheets (qua Composio, xem `scripts/support/`), xuất vào `import-csv/`:

- `01-gold-txn-2026-01.csv` … `06.csv` — cột: `txn_date,txn_type,gold_type_code,uom,qty,unit_price,amount,partner_code,sales,scrap_detail,gold_pct,payments,conv_key,lot_code,deposit_key,remarks`
- `02-refining-lots.csv` — cột theo Task 4
- `03-opening-inventory.csv` — cột: `as_of,gold_type_code,uom,qty,unit_cost,value,note`

Ba quy tắc bộ phiên dịch tự làm, ghi rõ trong đầu tệp:

1. **Dòng `Pickup` xuất ra hai dòng**: `DEPOSIT` (ngày của dòng, `qty` **âm — cùng dấu với phiếu bán**, `amount` 0, thanh toán `Amount-1st`) rồi `PICKUP` (ngày ở cột `Pickup Date`, `qty` âm, `amount` là toàn bộ giá bán, thanh toán `Amount-2nd`), cùng `deposit_key`. Thứ tự đó là thứ tự bộ nạp cần.

   > Sửa ngày 14-09: bản đầu ghi `qty` dương cho phiếu cọc. `record_inventory_movement` (0021) trừ `ON_HAND` theo `qty` có dấu và cộng `DEPOSIT_HELD` theo dấu ngược lại, nên `qty` dương làm kệ hàng *tăng* một lượng khi bán và ngăn giữ hộ âm hai lượng — tháng 1 riêng RP lệch +225 g trên bảng đối chiếu. Test `leaves the shelf one lượng lower…` trong `import-gold.test.ts` giữ cho điều này đúng.
2. **`conv_key`**: gộp các dòng `Transfer` cùng ngày; chỉ đặt khoá khi tổng gram trong ngày cân bằng (sai số < 0,5 g) và ngày đó không phải là ngày gửi phân kim. Ngày lệch **không có khoá** — để bộ nạp trả lại.
3. **`lot_code`**: dòng `Transfer` của `SG`/`PT` khớp ngày gửi của một lô trong `3.2 PC49 SCRAP GOLD` thì mang mã lô đó.
4. **Kim loại của túi**: `Gold`→`GOLD`, `PT`→`PLATINUM`, và `PD`→`PLATINUM` kèm `source_desc` bắt đầu bằng `PD — ` để trên màn hình đọc ra ngay. Hệ thống chưa biết palladium; đây là quyết định đã chốt ngày 10-09, không phải chỗ tự ý đoán.
5. **Dòng chép sang tab tháng sau** (thêm ngày 14-09): 15 dòng có mặt hai lần — ở tab của chính ngày đó và, giống từng ô, ở tab tháng kế (phiếu cọc chưa giao, phiếu bán chưa thu). Bộ phiên dịch bỏ bản ở tab sau khi mọi cột trừ `deposit_key` giống hệt, bỏ kèm phiếu giao hàng của phiếu cọc chép, và in từng dòng đã bỏ. Dòng khác đi dù một ô, dòng ghi muộn không có bản gốc, và hai dòng giống nhau trong cùng một tab thì giữ. Việc này phải làm trước khi đặt `conv_key`.

In ra bảng tổng kết mỗi tệp: bao nhiêu dòng, bao nhiêu dòng không có `conv_key`, bao nhiêu ô khách là ghi chú.

- [ ] **Step 6: Chạy thử và xem con số**

Run: `node --env-file=.env.local scripts/sheet-to-import.mjs`
Expected: 6 tệp giao dịch tổng **1.126 + 32 = 1.158 dòng** (32 dòng Pickup thành 64) — **sau khi bỏ bản chép: 1.136 dòng** (bỏ 15 bản chép và 7 phiếu giao hàng đi kèm; đo ngày 14-09), 1 tệp phân kim 15 dòng túi PC49, 1 tệp tồn đầu 7 dòng. Bảng tổng kết báo khoảng 10 ngày chuyển đổi không có khoá.

- [ ] **Step 7: Cổng và commit**

Run: `npx vitest run && npx eslint scripts/lib/sheet-map.mjs scripts/sheet-to-import.mjs`

```bash
git add scripts/lib/sheet-map.mjs scripts/sheet-to-import.mjs tests/lib/sheet-map.test.ts
git commit -m "feat(import): read the 2026 workbooks into the loader's shape"
```

---

## Task 6: Chạy thật trên cơ sở dữ liệu

**Files:**
- Create: `scripts/load-2026.mjs`
- Modify: `package.json` (thêm `"load:2026": "node --env-file=.env.local scripts/load-2026.mjs"`)

**Interfaces:**
- Consumes: mọi thứ ở Task 1–5, `pc49.import_expected_figure`, `pc49.import_reconciliation(date)`

- [ ] **Step 1: Áp migration lên cơ sở dữ liệu thật**

Run: `npm run migrate`
Expected: `apply 0062… apply 0063… apply 0064… apply 0065… Applied 4 migration(s).`

- [ ] **Step 2: Dọn demo và rác**

Run: `npm run demo:clear`

Rồi xoá dòng lẻ và lô nạp hỏng bằng một script tạm (`node --env-file=.env.local`):

```js
await db.query(`DELETE FROM pc49.import_batch WHERE committed_at IS NULL`)
await db.query(`DELETE FROM pc49.inventory_movement WHERE source_id IN
                  (SELECT id FROM pc49.gold_txn WHERE doc_no IS NULL)`)
await db.query(`DELETE FROM pc49.gold_txn_payment WHERE txn_id IN
                  (SELECT id FROM pc49.gold_txn WHERE doc_no IS NULL)`)
await db.query(`DELETE FROM pc49.gold_txn WHERE doc_no IS NULL`)
```

Expected: `gold_txn` còn 0 dòng, `import_batch` còn 0 dòng.

- [ ] **Step 3: Dựng chỗ để đặt giao dịch**

Trong `scripts/load-2026.mjs`, bước một:

```js
for (const m of ['01','02','03','04','05','06']) {
  await db.query(`INSERT INTO pc49.accounting_period (period, status)
                  VALUES ($1, 'OPEN') ON CONFLICT (period) DO NOTHING`, [`2026-${m}`])
}
```

Expected: 6 kỳ mở. Sales và khách do bộ nạp tự tạo (Task 1).

- [ ] **Step 4: Khai con số kỳ vọng trước khi nạp chi tiết**

```js
const CLOSING_JAN = {
  RP: 43, ML: 14, CS: 25, '9999': 15, OTH: 2, SG: 132.44, PT: 116.71, GRAIN: 1717.39,
}
for (const [code, qty] of Object.entries(CLOSING_JAN)) {
  await db.query(
    `INSERT INTO pc49.import_expected_figure (as_of, metric, metric_key, expected, source_note)
     VALUES ('2026-01-31', 'INVENTORY_GRAM', $1, $2, 'A.REPORT IN/OUT, cột TỒN CUỐI KÌ')
     ON CONFLICT (as_of, metric, metric_key) DO UPDATE SET expected = excluded.expected`,
    [code, qty])
}
```

> Con số trên là **trọng lượng nguyên**; `INVENTORY_GRAM` so theo gram, nên phải quy đổi trước khi khai: RP ×37,5 · ML/CS/OTH/AE ×31,105 · SG/PT/GRAIN ×1. Quy đổi trong script, không gõ tay hai bộ số.
>
> Sửa ngày 14-09: bản đầu ghi ×31,1. Đó là số chia khi **định giá**; khối lượng dùng 31,105, đúng như `uom_factor` và `src/lib/domain/units.ts`. `import_reconciliation` chỉ coi là khớp khi lệch dưới 0,005 g, nên quy đổi bằng 31,1 làm CS 25 oz lệch 0,125 g, ML 14 oz lệch 0,07 g, OTH 2 oz lệch 0,01 g — ba dòng đỏ không bao giờ khép, và bước 6 lại bảo đừng sửa con số kỳ vọng.

- [ ] **Step 5: Nạp theo thứ tự bắt buộc**

Thứ tự này không đổi được: phân kim trước, vì dòng chuyển đổi vàng vụn trỏ vào mã lô; tồn đầu trước giao dịch, vì bán thì phải có cái để bán.

1. `03-opening-inventory.csv` → nguồn `OPENING_INVENTORY`
2. `02-refining-lots.csv` → nguồn `REFINING_LOT`
3. `01-gold-txn-2026-01.csv` … `-06.csv` → nguồn `GOLD_TXN`, mỗi tháng một lô

Mỗi tệp: `stage` từng dòng → in số hợp lệ/bị trả → `commit_import_batch(batch, false)` → `post_import_batch(batch)`.

Expected: mỗi tháng in ra số dòng vào được và danh sách dòng bị trả kèm lý do tiếng Việt.

- [ ] **Step 6: Đọc bảng đối chiếu**

Run: mở `/import?asOf=2026-01-31` trên máy, hoặc trong script:

```js
const recon = await db.query(`SELECT * FROM pc49.import_reconciliation('2026-01-31')`)
console.table(recon.rows)
```

Expected: 8 dòng tồn kho, cột chênh lệch bằng 0. Dòng nào lệch thì **dừng lại**, tìm nguyên nhân trong các dòng bị trả, sửa CSV, `withdraw_import_batch` rồi nạp lại — đừng sửa con số kỳ vọng cho khớp.

- [ ] **Step 7: Chụp màn hình và báo cáo**

Run: `node --env-file=.env.local scripts/shoot-a-few.mjs`

Báo lại: bao nhiêu dòng vào sổ, bao nhiêu bị trả và vì sao, bảng đối chiếu tháng 1, và danh sách việc còn treo (giá, tiền, T7→nay).

- [ ] **Step 8: Commit**

```bash
git add scripts/load-2026.mjs package.json
git commit -m "feat(import): load the 2026 gold ledger, month by month"
```

---

## Những gì cố ý không làm trong kế hoạch này

- **Nút "ghi sổ cả lô" trên màn hình `/import`.** Đợt đổ dữ liệu lịch sử chạy một lần bằng script; kế toán nhập hằng ngày thì màn hình giao dịch đã tự ghi sổ. Thêm nút bây giờ là thêm một đường không ai đi.
- **Phiếu nhận về của lô phân kim.** Trigger `refining_receipt_leg` sinh một chân `TRANSFER_IN` khi nhận bằng kim loại, mà vàng Grain về từ nhà máy đã nằm sẵn trong sheet dưới dạng dòng `Transfer` — nạp phiếu nhận nữa là đếm hai lần. Ba lô nạp ở trạng thái `ASSAYED`; phiếu nhận để lại cho các lô kế toán làm trực tiếp trên hệ thống.
- **Giá spot và giá vốn theo ngày, số dư tiền, sao kê, dữ liệu từ tháng 7.** Ngoài phạm vi đợt này theo đúng đặc tả.
