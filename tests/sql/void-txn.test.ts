import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

/** Records a sale and posts it, the way the entry grid does. */
async function sell(date: string, gold = 'GRAIN', qty = 10, amount = 1400) {
  const t = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount)
     VALUES ($1, 'SALE', $2, 'GRAM', $3, $4, $5) RETURNING id`,
    [date, gold, -qty, amount / qty, amount])
  await db.query(
    `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, method, amount)
     VALUES ($1, 1, 'AR', 'CASH', $2)`, [t.rows[0].id, amount])
  await db.query(`SELECT pc49.post_gold_txn($1)`, [t.rows[0].id])
  return t.rows[0].id
}

async function voidIt(id: string, reason = 'typed twice', onDate?: string) {
  const r = await db.query<{ reversal: string | null }>(
    `SELECT pc49.void_gold_txn($1, $2, $3) AS reversal`, [id, reason, onDate ?? null])
  return r.rows[0].reversal
}

describe('voiding a posted transaction', () => {
  let txn: string
  let reversal: string | null

  beforeAll(async () => {
    txn = await sell('2026-05-04')
    reversal = await voidIt(txn)
  })

  it('leaves the original posting exactly where it was', async () => {
    // The history is what happened, not what somebody wished had happened.
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.journal_entry e
         JOIN pc49.gold_txn t ON t.journal_entry_id = e.id
        WHERE t.id = $1 AND e.posted_at IS NOT NULL AND e.voided_at IS NULL`, [txn])
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('writes a reversing entry beside it, pointing back at the original', async () => {
    const r = await db.query<{ of: string; posted: string | null; memo: string }>(
      `SELECT reversal_of_id AS of, posted_at::text AS posted, memo
         FROM pc49.journal_entry WHERE id = $1`, [reversal])
    expect(r.rows[0].posted).not.toBeNull()
    expect(r.rows[0].memo).toMatch(/^Reversal of:/)
    const original = await db.query<{ id: string }>(
      `SELECT journal_entry_id AS id FROM pc49.gold_txn WHERE id = $1`, [txn])
    expect(r.rows[0].of).toBe(original.rows[0].id)
  })

  it('leaves the month with nothing left in it', async () => {
    // The whole point: revenue and its reversal net to zero, so a cancelled
    // sale stops reporting profit.
    const r = await db.query<{ amount: string }>(
      `SELECT amount::text FROM pc49.pl_report('2026-05') WHERE code = 'REV_TOTAL'`)
    expect(Number(r.rows[0].amount)).toBeCloseTo(0, 2)
  })

  it('gives the stock back, as a movement rather than a deletion', async () => {
    // A stock report run for last week must still answer what it answered then.
    const rows = await db.query<{ source: string; gram: string }>(
      `SELECT source_type::text AS source, qty_gram::text AS gram
         FROM pc49.inventory_movement WHERE source_id = $1
        ORDER BY source_type::text`, [txn])
    expect(rows.rows).toHaveLength(2)
    expect(rows.rows.map((r) => r.source)).toEqual(['ADJUSTMENT', 'GOLD_TXN'])
    const sum = rows.rows.reduce((n, r) => n + Number(r.gram), 0)
    expect(sum).toBeCloseTo(0, 4)
  })

  it('records why, and refuses to be told nothing', async () => {
    const r = await db.query<{ reason: string }>(
      `SELECT void_reason AS reason FROM pc49.gold_txn WHERE id = $1`, [txn])
    expect(r.rows[0].reason).toBe('typed twice')

    const other = await sell('2026-05-05')
    await expect(voidIt(other, '   ')).rejects.toThrow(/needs a reason/)
  })

  it('refuses to void the same transaction twice', async () => {
    await expect(voidIt(txn)).rejects.toThrow(/already voided/)
  })
})

describe('the guard on the column itself', () => {
  it('refuses a void written by hand, and says what to call instead', async () => {
    // This is the hole the migration exists to close: setting the column
    // directly used to leave the posting standing.
    const txn = await sell('2026-06-02')
    await expect(
      db.query(
        `UPDATE pc49.gold_txn SET voided_at = now(), void_reason = 'by hand'
          WHERE id = $1`, [txn]),
    ).rejects.toThrow(/call pc49\.void_gold_txn/)
  })

  it('refuses to bring a voided transaction back', async () => {
    const txn = await sell('2026-06-03')
    await voidIt(txn)
    await expect(
      db.query(`UPDATE pc49.gold_txn SET voided_at = NULL WHERE id = $1`, [txn]),
    ).rejects.toThrow(/cannot be brought back/)
  })

  it('leaves every other update to the row alone', async () => {
    const txn = await sell('2026-06-04')
    await db.query(`UPDATE pc49.gold_txn SET remarks = 'still editable' WHERE id = $1`, [txn])
    const r = await db.query<{ remarks: string }>(
      `SELECT remarks FROM pc49.gold_txn WHERE id = $1`, [txn])
    expect(r.rows[0].remarks).toBe('still editable')
  })
})

describe('what voiding will not do', () => {
  it('refuses when the month is closed, and says where to date it instead', async () => {
    const txn = await sell('2026-07-06')
    await db.query(
      `INSERT INTO pc49.accounting_period (period, status, closed_at)
       VALUES ('2026-07', 'CLOSED', now())`)

    await expect(voidIt(txn)).rejects.toThrow(/period 2026-07 is closed/)

    // Dated into an open month, the same void goes through.
    const reversal = await voidIt(txn, 'caught after close', '2026-08-01')
    expect(reversal).not.toBeNull()
    const r = await db.query<{ period: string }>(
      `SELECT period FROM pc49.journal_entry WHERE id = $1`, [reversal])
    expect(r.rows[0].period).toBe('2026-08')
  })

  it('refuses to strand a pickup that was taken against a deposit', async () => {
    const deposit = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, amount)
       VALUES ('2026-09-01', 'DEPOSIT', 'RP', 'LUONG', -1, 4760) RETURNING id`)
    await db.query(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, amount, deposit_ref_id)
       VALUES ('2026-09-03', 'PICKUP', 'RP', 'LUONG', -1, 4760, $1)`,
      [deposit.rows[0].id])

    await expect(voidIt(deposit.rows[0].id)).rejects.toThrow(/void the pickup first/)
  })

  it('voids a transaction that was never posted, with nothing to reverse', async () => {
    const t = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, amount)
       VALUES ('2026-10-01', 'PO', 'SG', 'GRAM', 4, -300) RETURNING id`)
    expect(await voidIt(t.rows[0].id, 'never posted')).toBeNull()
    const r = await db.query<{ voided: string | null }>(
      `SELECT voided_at::text AS voided FROM pc49.gold_txn WHERE id = $1`, [t.rows[0].id])
    expect(r.rows[0].voided).not.toBeNull()
  })
})
