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
