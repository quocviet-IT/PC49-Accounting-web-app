# Thêm tiền cọc, tồn kho theo đơn vị gốc, nhập/xuất tách riêng — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khách đưa thêm tiền cọc trước khi lấy hàng; tồn kho và nhập/xuất trên sổ hiện đơn vị gốc kèm gram; nhập và xuất tách riêng, đơn cọc chỉ tính xuất lúc lấy hàng.

**Architecture:** 0089 thêm `deposit_paid` và thay chỗ dùng `txn_paid` của phiếu cọc; `save_receipt_settlement` nhận phiếu cọc chưa lấy; `gold_receipt_ledger_totals` thêm `moves_by_gold`. Màn hình: `weightText.ts` viết khối lượng theo đơn vị gốc, `InventoryView` và thẻ nhập/xuất dùng nó; `SettlementForm` có chữ riêng cho phiếu cọc.

**Spec:** `docs/superpowers/specs/2026-09-18-coc-them-va-don-vi-goc-design.md`

## Global Constraints

- Không có chữ `cl[a]ude`, `cod[e]x` trong commit hay nội dung đẩy lên.
- `git push origin main` là lệnh riêng, ngoài 04:00–08:00 UTC trừ khi người dùng bảo.
- DB thật chỉ ghi bằng `npm run migrate`, sau đó `npm run verify:live`. Test SQL chạy một mình.
- File mới tách bằng `node scripts/extract-plan-files.mjs docs/superpowers/plans/2026-09-18-coc-them-va-don-vi-goc.md <path>…`.

---

### Task 1: Database (0089)

**Files:** Create `supabase/migrations/0089_a_deposit_is_added_to_and_gold_moves_in_and_out.sql`, `tests/sql/deposit-topup.test.ts`.

- [ ] **Step 1: Test**

```ts path=tests/sql/deposit-topup.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'
import { purchaseLine, receiptPayload, SIX_ITEMS } from '../support/receipt'

// "Đơn đặt cọc chưa có tính năng khách chỉ trả thêm tiền chứ chưa pickup", and
// "Vàng vào / ra kho … chưa tách ra nhập bao nhiêu, xuất bao nhiêu" (18-09-2026).

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

type Saved = { receiptId: string; docNo: string }

async function save(key: string, body: string): Promise<Saved> {
  const r = await asRole(db, KT, () => db.query<{ r: Saved }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

async function addTo(key: string, receiptKey: string, payment: Record<string, unknown>) {
  const r = await asRole(db, KT, () => db.query<{ r: { settlementId: string } }>(
    `SELECT pc49.save_receipt_settlement($1, $2, $3::jsonb) AS r`,
    [key, receiptKey, JSON.stringify({ method: 'CASH', note: null, ...payment })]))
  return r.rows[0].r.settlementId
}

async function pickUp(key: string, deposit: string, payload: Record<string, unknown>): Promise<Saved> {
  const r = await asRole(db, KT, () => db.query<{ r: Saved }>(
    `SELECT pc49.save_gold_pickup($1, $2, $3::jsonb) AS r`,
    [key, deposit, JSON.stringify({ remarks: null, payments: [], ...payload })]))
  return r.rows[0].r
}

/** One luong of Rong Phung ordered at 5,300.00 on 2 June, with `paid` down in cash. */
const depositOf = (partnerCode: string, paid: number, over: Record<string, unknown> = {}) =>
  receiptPayload({
    txnDate: '2026-06-02', txnType: 'DEPOSIT', partnerCode,
    lines: [{ itemDesc: 'RP 1 luong', goldTypeCode: 'RP', uom: 'LUONG', qty: -1,
              unitPrice: 5300, amount: 5300, scrapDetail: null, goldPct: null }],
    payments: paid > 0 ? [{ amount: paid, method: 'CASH' }] : [],
    ...over,
  })

const one = async <T>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0]

describe('adding to a deposit before the gold is collected', () => {
  it('books the money on its own day, as the deposit was booked', async () => {
    const d = await save('add-1', depositOf('ADD1', 1000))
    const id = await addTo('add-1-more', d.receiptId, { payDate: '2026-06-05', amount: 2000, method: 'ZELLE' })
    expect(await one(
      `SELECT e.entry_date::text AS day, jl.debit_account AS dr, jl.credit_account AS cr,
              jl.amount_usd::float8 AS amount
         FROM pc49.gold_receipt_settlement s
         JOIN pc49.journal_entry e ON e.id = s.journal_entry_id
         JOIN pc49.journal_line jl ON jl.entry_id = e.id WHERE s.id = $1`, [id]))
      .toEqual({ day: '2026-06-05', dr: '1121ZL', cr: '131', amount: 2000 })
  })

  it('counts it as put down, on the row, in the report and at pickup', async () => {
    const d = await save('add-2', depositOf('ADD2', 1000))
    await addTo('add-2-more', d.receiptId, { payDate: '2026-06-05', amount: 2000 })
    expect(await one<{ d: Record<string, unknown> }>(
      `SELECT pc49.gold_receipt_deposit($1) AS d`, [d.receiptId]))
      .toMatchObject({ d: { paid: 3000, orderValue: 5300 } })
    const txn = await one<{ id: string }>(`SELECT id FROM pc49.gold_txn WHERE receipt_id = $1`, [d.receiptId])
    expect(await one(
      `SELECT deposit_amount::float8, paid_amount::float8, remaining_amount::float8
         FROM pc49.v_deposit_status WHERE id = $1`, [txn.id]))
      .toEqual({ deposit_amount: 3000, paid_amount: 3000, remaining_amount: 2300 })
    const p = await pickUp('add-2-pick', d.receiptId,
      { pickupDate: '2026-06-10', payments: [{ amount: 2000, method: 'CASH' }] })
    expect(Number((await one<{ o: string }>(
      `SELECT pc49.gold_receipt_owed($1)::text AS o`, [p.receiptId])).o)).toBe(300)
  })

  it('owes nothing on the deposit itself, so it is not among the receipts still owed', async () => {
    const d = await save('add-3', depositOf('ADD3', 1000))
    expect(Number((await one<{ o: string }>(
      `SELECT pc49.gold_receipt_owed($1)::text AS o`, [d.receiptId])).o)).toBe(0)
  })

  it('is refused past what the order comes to', async () => {
    const d = await save('add-4', depositOf('ADD4', 1000))
    await expect(addTo('add-4-more', d.receiptId, { payDate: '2026-06-05', amount: 5000 }))
      .rejects.toThrow(/SETTLEMENT_OVER: owed 4300(\.00)? paid 5000/)
  })

  it('is refused once the gold has been collected', async () => {
    const d = await save('add-5', depositOf('ADD5', 1000))
    await pickUp('add-5-pick', d.receiptId, { pickupDate: '2026-06-10' })
    await expect(addTo('add-5-more', d.receiptId, { payDate: '2026-06-11', amount: 100 }))
      .rejects.toThrow(/PICKUP_TAKEN: 2026-06-10/)
  })

  it('is not capped when nobody recorded what the order comes to', async () => {
    const d = await save('add-6', depositOf('ADD6', 500, {
      lines: [{ itemDesc: 'RP', goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: null,
                amount: 0, scrapDetail: null, goldPct: null }],
    }))
    await addTo('add-6-more', d.receiptId, { payDate: '2026-06-05', amount: 9000 })
    expect(await one<{ d: Record<string, unknown> }>(
      `SELECT pc49.gold_receipt_deposit($1) AS d`, [d.receiptId]))
      .toMatchObject({ d: { paid: 9500, orderValue: null } })
  })
})

describe('gold in and out of the shop, apart', () => {
  type Move = { in: number; inGrams: number; out: number; outGrams: number }
  async function moves(from: string, to: string): Promise<Record<string, Move>> {
    const r = await db.query<{ m: Record<string, Move> }>(
      `SELECT moves_by_gold AS m FROM pc49.gold_receipt_ledger_totals(p_from => $1, p_to => $2)`,
      [from, to])
    return r.rows[0].m
  }

  it('counts what came in and what went out separately, in its unit and in grams', async () => {
    await save('mv-buy', receiptPayload({
      txnDate: '2026-07-01', partnerCode: 'MVBUY', payments: [{ amount: 1775, method: 'CASH' }],
      lines: [purchaseLine(SIX_ITEMS[0]), purchaseLine(SIX_ITEMS[1])],
    }))
    await save('mv-rp-in', receiptPayload({
      txnDate: '2026-07-01', partnerCode: 'MVRP', payments: [{ amount: 10000, method: 'CASH' }],
      lines: [{ itemDesc: 'RP', goldTypeCode: 'RP', uom: 'LUONG', qty: 2, unitPrice: 5000,
                amount: -10000, scrapDetail: null, goldPct: null }],
    }))
    await save('mv-rp-out', receiptPayload({
      txnDate: '2026-07-02', txnType: 'SALE', partnerCode: 'MVRP2', payments: [{ amount: 5300, method: 'CASH' }],
      lines: [{ itemDesc: 'RP', goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5300,
                amount: 5300, scrapDetail: null, goldPct: null }],
    }))
    const m = await moves('2026-07-01', '2026-07-02')
    expect(m.RP).toEqual({ in: 2, inGrams: 75, out: 1, outGrams: 37.5 })
    expect(m.SG).toEqual({ in: 16.9, inGrams: 16.9, out: 0, outGrams: 0 })
  })

  it('counts a deposit’s gold out when it is collected, not when it is ordered', async () => {
    const d = await save('mv-dep', depositOf('MVDEP', 1000, { txnDate: '2026-07-10' }))
    expect((await moves('2026-07-10', '2026-07-10')).RP).toBeUndefined()
    await pickUp('mv-pick', d.receiptId, { pickupDate: '2026-07-12' })
    expect((await moves('2026-07-10', '2026-07-12')).RP).toEqual({ in: 0, inGrams: 0, out: 1, outGrams: 37.5 })
  })
})
```

- [ ] **Step 2: Đỏ** — `npx vitest run tests/sql/deposit-topup.test.ts`

- [ ] **Step 3: Migration**

```sql path=supabase/migrations/0089_a_deposit_is_added_to_and_gold_moves_in_and_out.sql
-- 0089_a_deposit_is_added_to_and_gold_moves_in_and_out.sql
-- A customer adds to a deposit before collecting the gold; and the ledger says
-- how much gold came in and how much went out, not only the difference.
--
--   "Đơn đặt cọc chưa có tính năng khách chỉ trả thêm tiền chứ chưa pickup"
--   "Vàng vào / ra kho đang thể hiện chung, chưa tách ra nhập bao nhiêu, xuất
--    bao nhiêu. Và đang tính chung là gr, cần có thêm đvt gốc" (18-09-2026)
--
-- A later payment (0083) was for a purchase or a sale. Money added to a
-- deposit is the same kind of thing — cash against 131, on its own day — so it
-- is a later payment on the deposit, capped at what is left of the order.
-- Everything that says what was put down on a deposit now counts it:
--
--   deposit_paid           put down with the order, and added since
--   save_receipt_settlement  takes a deposit nobody has collected
--   gold_receipt_owed      a pickup owes the order less all of that
--   gold_receipt_deposit   the rows' "put down"
--   v_deposit_status       the deposits report
--
-- A deposit itself owes nothing (gold_receipt_owed stays 0): what is left is
-- paid when the gold is collected, and the deposit is not a debt until then.
--
-- The ledger's totals gain moves_by_gold: for each gold, how much came in and
-- how much went out, in its own unit and in grams. Gold leaves the shop when a
-- customer collects it, so a deposit and a cancelled deposit move nothing here;
-- the pickup is the gold going out. Counting both was counting one luong twice.
-- grams_by_gold is kept as it was for the screen still being served until the
-- code that reads moves_by_gold is deployed.

CREATE OR REPLACE FUNCTION pc49.deposit_paid(p_deposit uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT pc49.txn_paid(d.id)
       + coalesce((SELECT sum(s.amount) FROM pc49.gold_receipt_settlement s
                    WHERE s.receipt_key = coalesce(d.receipt_id, d.id)
                      AND s.voided_at IS NULL), 0)
    FROM pc49.gold_txn d WHERE d.id = p_deposit
$$;

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
      - coalesce((SELECT sum(pc49.deposit_paid(l.deposit_ref_id)) FROM lines l
                   WHERE l.deposit_ref_id IS NOT NULL), 0)
      - coalesce((SELECT sum(s.amount) FROM pc49.gold_receipt_settlement s
                   WHERE s.receipt_key = p_key AND s.voided_at IS NULL), 0), 2), 0)
  END
$$;

CREATE OR REPLACE FUNCTION pc49.gold_receipt_deposit(p_key uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN f.txn_type = 'DEPOSIT' THEN jsonb_build_object(
      'role', 'deposit',
      'orderValue', pc49.deposit_order_value(f.id),
      'paid', pc49.deposit_paid(f.id),
      'settledBy', s.txn_type,
      'pickupDate', s.txn_date,
      'pickupDoc', s.doc_no)
    WHEN f.txn_type = 'PICKUP' AND d.id IS NOT NULL THEN jsonb_build_object(
      'role', 'pickup',
      'orderValue', abs(f.amount),
      'paid', pc49.deposit_paid(d.id),
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

CREATE OR REPLACE VIEW pc49.v_deposit_status AS
  SELECT d.id,
         d.txn_date,
         d.partner_code,
         d.gold_type_code,
         d.uom,
         d.qty,
         d.qty_gram,
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
         o.value AS order_amount,
         dep.paid + coalesce(pick.paid, 0) AS paid_amount,
         CASE
           WHEN s.txn_type = 'CANCEL' THEN 0
           WHEN o.value IS NULL THEN NULL
           ELSE greatest(o.value - dep.paid - coalesce(pick.paid, 0), 0)
         END AS remaining_amount
    FROM pc49.gold_txn d
    LEFT JOIN pc49.gold_txn s ON s.deposit_ref_id = d.id AND s.voided_at IS NULL
    CROSS JOIN LATERAL (SELECT pc49.deposit_paid(d.id) AS paid) dep
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

-- 0083's body, taking a deposit nobody has collected as well.
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
  v_settled pc49.gold_txn;
  v_deposit boolean;
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

  -- Money added to a deposit is taken as the deposit was: cash against 131.
  v_deposit := v_first.txn_type = 'DEPOSIT';
  v_side := CASE WHEN v_deposit THEN 'AR' ELSE pc49.settlement_side(v_first.txn_type::text) END;
  IF v_side IS NULL OR v_first.conversion_id IS NOT NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_KIND: only a purchase, a sale or a deposit is paid later, not a %',
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

  IF v_deposit THEN
    -- Once the gold is collected, what is left is the pickup's to pay.
    SELECT * INTO v_settled FROM pc49.gold_txn
     WHERE deposit_ref_id = v_first.id AND voided_at IS NULL LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'PICKUP_TAKEN: %; this deposit was already settled by a %',
        v_settled.txn_date, v_settled.txn_type;
    END IF;
    -- No more than is left of the order; not capped when nobody recorded it.
    v_owed := pc49.deposit_order_value(v_first.id) - pc49.deposit_paid(v_first.id);
    IF v_owed IS NOT NULL AND v_amount > v_owed THEN
      RAISE EXCEPTION 'SETTLEMENT_OVER: owed % paid %', greatest(v_owed, 0), v_amount;
    END IF;
  ELSE
    v_owed := pc49.gold_receipt_owed(p_receipt_key);
    IF v_amount > v_owed THEN
      RAISE EXCEPTION 'SETTLEMENT_OVER: owed % paid %', v_owed, v_amount;
    END IF;
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
          CASE WHEN v_deposit THEN 'Added to deposit ' ELSE 'Later payment ' END
            || coalesce(v_doc, '') || coalesce(' · ' || v_note, ''))
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

-- The totals gain a column, and a function's result cannot be changed in place.
DROP FUNCTION IF EXISTS pc49.gold_receipt_ledger_totals(date, date, text, text, text, text, text, text);

CREATE FUNCTION pc49.gold_receipt_ledger_totals(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_type   text DEFAULT NULL,
  p_gold   text DEFAULT NULL,
  p_staff  text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_query  text DEFAULT NULL)
RETURNS TABLE (receipt_count bigint, purchases numeric, sales numeric, grams_by_gold jsonb,
               moves_by_gold jsonb)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH matched AS (
    SELECT coalesce(t.receipt_id, t.conversion_id, t.id) AS k,
           t.txn_type, t.amount, t.gold_type_code, t.qty, t.qty_gram
      FROM pc49.gold_txn t
     WHERE pc49.gold_receipt_ledger_match(t, p_from, p_to, p_type, p_gold,
                                          p_staff, p_method, p_status, p_query)
  ),
  -- Gold that came into or left the shop. A deposit's gold stays until it is
  -- collected, and a cancelled deposit's never left.
  moved AS (
    SELECT * FROM matched WHERE txn_type NOT IN ('DEPOSIT', 'CANCEL')
  )
  SELECT (SELECT count(DISTINCT k) FROM matched),
         coalesce((SELECT -sum(amount) FROM matched WHERE txn_type IN ('PO', 'PO_VENDOR')), 0),
         coalesce((SELECT sum(amount) FROM matched WHERE txn_type IN ('SALE', 'PICKUP')), 0),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, g.grams)
                     FROM (SELECT gold_type_code, sum(qty_gram) AS grams FROM matched
                            GROUP BY gold_type_code HAVING sum(qty_gram) <> 0) g), '{}'::jsonb),
         coalesce((SELECT jsonb_object_agg(g.gold_type_code, jsonb_build_object(
                            'in', g.qty_in, 'inGrams', g.gram_in,
                            'out', g.qty_out, 'outGrams', g.gram_out))
                     FROM (SELECT gold_type_code,
                                  coalesce(sum(qty) FILTER (WHERE qty > 0), 0) AS qty_in,
                                  coalesce(sum(qty_gram) FILTER (WHERE qty > 0), 0) AS gram_in,
                                  coalesce(-sum(qty) FILTER (WHERE qty < 0), 0) AS qty_out,
                                  coalesce(-sum(qty_gram) FILTER (WHERE qty < 0), 0) AS gram_out
                             FROM moved
                            GROUP BY gold_type_code
                           HAVING sum(abs(qty)) <> 0) g), '{}'::jsonb)
$$;

GRANT EXECUTE ON FUNCTION pc49.deposit_paid(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.gold_receipt_ledger_totals(
  date, date, text, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0089_a_deposit_is_added_to_and_gold_moves_in_and_out')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Xanh; cả bộ SQL; commit.**

---

### Task 2: Màn hình

**Files:** Create `src/components/gold/weightText.ts`, `tests/lib/weight-text.test.ts`; Modify `settlement.ts`, `SettlementForm.tsx`, `TxnScreen.tsx`, `gold-transactions/page.tsx`, `InventoryView.tsx`, i18n; Test `tests/lib/settlement.test.ts`, `tests/lib/txn-ledger-screen.test.tsx`.

- [ ] **Step 1: Test chữ khối lượng**

```ts path=tests/lib/weight-text.test.ts
import { describe, it, expect } from 'vitest'
import { UOM_SHORT, weightText } from '@/components/gold/weightText'

describe('a weight in its own unit, with grams beside it', () => {
  it('writes luong and ounces with the grams they come to', () => {
    expect(weightText(75, 'LUONG')).toBe('2.00 L (75.00 g)')
    expect(weightText(62.21, 'OZ')).toBe('2.00 Oz (62.21 g)')
  })

  it('takes the count in its unit when it is known, rather than working it back', () => {
    expect(weightText(37.5, 'LUONG', 1)).toBe('1.00 L (37.50 g)')
  })

  it('writes gold counted in grams once', () => {
    expect(weightText(16.9, 'GRAM')).toBe('16.90 g')
  })

  it('names the units as the shop writes them', () => {
    expect(UOM_SHORT).toEqual({ GRAM: 'g', OZ: 'Oz', LUONG: 'L' })
  })
})
```

- [ ] **Step 2: Module**

```ts path=src/components/gold/weightText.ts
import { fromGrams, type Uom } from '@/lib/domain/units'

/**
 * A weight in the unit its gold is counted in, with the grams beside it
 * (18-09-2026: "đang tính chung là gr, cần có thêm đvt gốc ...L/...gr").
 *
 * Every gold type has one unit (0038), so grams go back into it exactly: a
 * luong is 37.5 g and an ounce 31.105 g by weight.
 */
export const UOM_SHORT: Record<Uom, string> = { GRAM: 'g', OZ: 'Oz', LUONG: 'L' }

const two = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "2.00 L (75.00 g)", or "16.90 g" for gold counted in grams. */
export function weightText(grams: number, uom: Uom, native = fromGrams(grams, uom)): string {
  const g = `${two.format(grams)} g`
  return uom === 'GRAM' ? g : `${two.format(native)} ${UOM_SHORT[uom]} (${g})`
}

/** The count in its own unit alone: "2.00 L", "16.90 g". */
export function nativeText(grams: number, uom: Uom): string {
  return `${two.format(fromGrams(grams, uom))} ${UOM_SHORT[uom]}`
}
```

- [ ] **Step 3: Phần còn lại** — `settlement.ts` (`canSettle` nhận phiếu cọc chưa lấy), `SettlementForm.tsx` (chữ và "còn lại" cho phiếu cọc), `TxnScreen.tsx` (nút "Thêm tiền cọc", thẻ nhập/xuất dùng `moves`), `page.tsx` (đọc `moves_by_gold`), `InventoryView.tsx` (ô số theo đơn vị gốc, gram bên dưới), chữ `settle.deposit*`, `txn.move.in/out`. Test: `settlement.test.ts` thêm phiếu cọc; `txn-ledger-screen.test.tsx` thêm thẻ nhập/xuất.

- [ ] **Step 4: tsc, lint, tests/lib; commit.**

---

### Task 3: Trình duyệt, cổng, đưa lên

- [ ] `verify-deposit.mjs`: trước khi lấy hàng, bấm "Thêm tiền cọc" trên dòng cọc, thêm 500 (Zelle) → DB có lần trả, "Còn lại 3,800.00"; lấy hàng thì hộp Lấy hàng còn phải trả 3,800.00, trả 3,000 → còn nợ 800.00.
- [ ] Cổng; migrate; verify:live; build; trình duyệt cục bộ; đẩy (ngoài 04:00–08:00 UTC); Production; verify:live.
