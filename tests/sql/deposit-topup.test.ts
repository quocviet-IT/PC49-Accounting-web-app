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

  it('lets the pickup be cancelled after money was added, the deposit waiting again', async () => {
    const d = await save('add-7', depositOf('ADD7', 1000))
    await addTo('add-7-more', d.receiptId, { payDate: '2026-06-05', amount: 500 })
    const p = await pickUp('add-7-pick', d.receiptId,
      { pickupDate: '2026-06-10', payments: [{ amount: 3000, method: 'CASH' }] })
    await asRole(db, KT, () => db.query(`SELECT pc49.void_gold_receipt($1, 'nhap nham')`, [p.receiptId]))
    expect(await one<{ d: Record<string, unknown> }>(
      `SELECT pc49.gold_receipt_deposit($1) AS d`, [d.receiptId]))
      .toMatchObject({ d: { settledBy: null, paid: 1500 } })
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
