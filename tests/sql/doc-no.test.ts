import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function buy(day: string, docNo: string | null = null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, gold_type_code, uom, qty, unit_price, amount)
     VALUES ($1, $2, 'PO', 'SG', 'GRAM', 10, 50, -500) RETURNING id`, [day, docNo])
  return r.rows[0].id
}
async function docOf(id: string): Promise<string | null> {
  const r = await db.query<{ d: string | null }>(
    `SELECT doc_no AS d FROM pc49.gold_txn WHERE id = $1`, [id])
  return r.rows[0].d
}

/**
 * B2 from the accountant: "PC49-2606-01". The sheet's Document N. column was
 * blank on every row because nobody had time to number by hand; the number is
 * minted here so every row has one and no two rows share it.
 */
describe('every transaction gets a document number', () => {
  it('numbers a row PC49-YYMM-NNN, counting within the month', async () => {
    const a = await buy('2027-03-05')
    const b = await buy('2027-03-06')
    expect(await docOf(a)).toBe('PC49-2703-001')
    expect(await docOf(b)).toBe('PC49-2703-002')
  })

  it('starts again at 001 in the next month', async () => {
    const a = await buy('2027-04-01')
    expect(await docOf(a)).toBe('PC49-2704-001')
  })

  it('keeps a number that was written in, as an import does', async () => {
    const a = await buy('2027-05-01', 'HP-OLD-17')
    expect(await docOf(a)).toBe('HP-OLD-17')
  })

  it('does not hand the same number out twice within one statement', async () => {
    // Five rows in one INSERT: the counter must be locked and advanced, not
    // read once and reused.
    await db.query(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount)
       SELECT '2027-06-01', 'PO', 'SG', 'GRAM', 1, 50, -50 FROM generate_series(1, 5)`)
    const r = await db.query<{ n: string; d: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT doc_no)::text AS d
         FROM pc49.gold_txn WHERE txn_date = '2027-06-01'`)
    expect(r.rows[0].n).toBe('5')
    expect(r.rows[0].d).toBe('5')
  })

  it('a correction carries the number of the row it replaces', async () => {
    // Same document, corrected — not a second document.
    const original = await buy('2027-07-01')
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, corrects_txn_id)
       VALUES ('2027-07-01', 'PO', 'SG', 'GRAM', 11, 50, -550, $1) RETURNING id`, [original])
    expect(await docOf(r.rows[0].id)).toBe(await docOf(original))
  })
})
