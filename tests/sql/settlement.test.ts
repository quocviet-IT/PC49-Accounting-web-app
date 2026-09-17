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
