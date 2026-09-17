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
