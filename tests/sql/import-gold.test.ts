import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function newBatch(source = 'GOLD_TXN'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.import_batch (source, file_name) VALUES ($1, 'test.csv') RETURNING id`,
    [source])
  return r.rows[0].id
}

async function stage(batch: string, rowNo: number, payload: Record<string, string>) {
  const r = await db.query<{ status: string }>(
    `SELECT pc49.stage_import_row($1, $2, $3::jsonb)::text AS status`,
    [batch, rowNo, JSON.stringify(payload)])
  return r.rows[0].status
}

const commit = (batch: string) =>
  db.query(`SELECT * FROM pc49.commit_import_batch($1, false)`, [batch])

async function turnedBack(batch: string, rowNo: number) {
  const r = await db.query<{ code: string; value: string }>(
    `SELECT reason_code AS code, reason_value AS value
       FROM pc49.import_row WHERE batch_id = $1 AND row_no = $2`, [batch, rowNo])
  return r.rows[0]
}

/** A scrap purchase, the commonest row in the workbook. */
const buy = {
  txn_date: '2026-01-15', txn_type: 'PO', gold_type_code: 'SG', uom: 'GRAM',
  qty: '10', unit_price: '65', amount: '-650', partner_code: 'Chi Lan',
  scrap_detail: '14k/grs',
}

describe('a transaction arrives with the money and the people on it', () => {
  it('writes the payments the sheet recorded against it', async () => {
    // Without a payment line post_gold_txn refuses to post, so a transaction
    // loaded without its money is a transaction that never reaches the books.
    const b = await newBatch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:400|AP:CHECK:250' })
    await commit(b)
    const r = await db.query<{ seq: number; direction: string; method: string; amount: string }>(
      `SELECT p.seq, p.direction::text AS direction, p.method::text AS method, p.amount::text AS amount
         FROM pc49.gold_txn_payment p
         JOIN pc49.import_row r ON r.committed_ref = p.txn_id
        WHERE r.batch_id = $1 ORDER BY p.seq`, [b])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ seq: 1, direction: 'AP', method: 'CASH' })
    expect(Number(r.rows[0].amount)).toBe(400)
    expect(r.rows[1].method).toBe('CHECK')
  })

  it('splits two sales people eighty-twenty, in the order they were written', async () => {
    const b = await newBatch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:650', sales: 'N.Ý/T.Quỳnh' })
    await commit(b)
    const r = await db.query<{ code: string; share: string }>(
      `SELECT s.sales_person_code AS code, s.share_pct::text AS share
         FROM pc49.gold_txn_sales_person s
         JOIN pc49.import_row r ON r.committed_ref = s.txn_id
        WHERE r.batch_id = $1 ORDER BY s.share_pct DESC`, [b])
    expect(r.rows.map((x) => [x.code, Number(x.share)]))
      .toEqual([['N.Ý', 80], ['T.Quỳnh', 20]])
  })

  it('registers a sales person the system has never seen', async () => {
    // Seven names in the workbook are not in the system. Waiting for somebody
    // to declare them by hand holds up 113 rows of trading.
    const b = await newBatch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:650', sales: 'Q.Nghi' })
    await commit(b)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.sales_person WHERE code = 'Q.Nghi'`)
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('registers a customer the system has never seen', async () => {
    const b = await newBatch()
    await stage(b, 2, { ...buy, partner_code: 'Nguyễn Văn Mới', payments: 'AP:CASH:650' })
    await commit(b)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.partner WHERE code = 'Nguyễn Văn Mới'`)
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('turns back a row naming four sales people', async () => {
    // The accountant settled it: three at most. A fourth name is a typo, and
    // inventing a share for it invents a commission split nobody agreed to.
    const b = await newBatch()
    expect(await stage(b, 2, { ...buy, sales: 'A/B/C/D' })).toBe('REJECTED')
    expect(await turnedBack(b, 2)).toMatchObject({ code: 'TOO_MANY_SALES', value: 'A/B/C/D' })
  })

  it('turns back a payment it cannot read', async () => {
    const b = await newBatch()
    expect(await stage(b, 2, { ...buy, payments: 'AP:VENMO:400' })).toBe('REJECTED')
    expect(await turnedBack(b, 2)).toMatchObject({ code: 'BAD_PAYMENT', value: 'AP:VENMO:400' })
  })
})
