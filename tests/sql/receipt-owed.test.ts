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
