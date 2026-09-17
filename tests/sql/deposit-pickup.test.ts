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
