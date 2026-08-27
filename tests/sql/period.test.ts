import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function postEntry(memo: string, entryDate: string, dr: string, cr: string, amount: number,
                         gold?: { code: string; uom: string; qty: number }): Promise<string> {
  const e = await db.query<{ id: string }>(
    `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
     VALUES ($1, to_char($1::date, 'YYYY-MM'), $2, 'MANUAL') RETURNING id`,
    [entryDate, memo],
  )
  const id = e.rows[0].id
  await db.query(
    `INSERT INTO pc49.journal_line
       (entry_id, seq, debit_account, credit_account, amount_usd, gold_type_code, uom, qty_native)
     VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
    [id, dr, cr, amount, gold?.code ?? null, gold?.uom ?? null, gold?.qty ?? null],
  )
  await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`, [id])
  return id
}

describe('closing a period', () => {
  it('starts every period open by default', async () => {
    const r = await db.query<{ status: string }>(
      `SELECT pc49.period_status('2026-03')::text AS status`,
    )
    expect(r.rows[0].status).toBe('OPEN')
  })

  it('blocks posting into a closed period', async () => {
    await postEntry('before the close', '2026-01-05', '131', '511', 100)
    await db.query(`INSERT INTO pc49.accounting_period (period, status, closed_at)
                    VALUES ('2026-01', 'CLOSED', now())`)

    await expect(postEntry('after the close', '2026-01-06', '131', '511', 100))
      .rejects.toThrow(/closed/i)
  })

  it('blocks voiding an entry that sits in a closed period', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM pc49.journal_entry WHERE memo = 'before the close'`,
    )
    await expect(
      db.query(`UPDATE pc49.journal_entry SET voided_at = now(), void_reason = 'oops'
                 WHERE id = $1`, [r.rows[0].id]),
    ).rejects.toThrow(/closed/i)
  })

  it('still allows posting into a period that is open', async () => {
    const id = await postEntry('february is open', '2026-02-03', '131', '511', 250)
    const r = await db.query<{ posted: string | null }>(
      `SELECT posted_at::text AS posted FROM pc49.journal_entry WHERE id = $1`, [id],
    )
    expect(r.rows[0].posted).not.toBeNull()
  })

  it('lets an administrator reopen a period', async () => {
    await db.query(`UPDATE pc49.accounting_period SET status = 'OPEN', closed_at = NULL
                     WHERE period = '2026-01'`)
    const id = await postEntry('january reopened', '2026-01-07', '131', '511', 100)
    expect(id).toBeTruthy()
    await db.query(`UPDATE pc49.accounting_period SET status = 'CLOSED', closed_at = now()
                     WHERE period = '2026-01'`)
  })
})

describe('reversing an entry', () => {
  let originalId: string

  beforeAll(async () => {
    // Posted in January, which is now closed.
    await db.query(`UPDATE pc49.accounting_period SET status = 'OPEN' WHERE period = '2026-01'`)
    originalId = await postEntry('sale to reverse', '2026-01-08', '131', '511', 5310,
      { code: 'RP', uom: 'LUONG', qty: -1 })
    await db.query(`UPDATE pc49.accounting_period SET status = 'CLOSED', closed_at = now()
                     WHERE period = '2026-01'`)
  })

  it('creates a reversal dated in an open period', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT pc49.reverse_entry($1, '2026-02-15'::date) AS id`, [originalId],
    )
    const reversalId = r.rows[0].id
    const e = await db.query<{ period: string; reversal_of: string; posted: string | null }>(
      `SELECT period, reversal_of_id AS reversal_of, posted_at::text AS posted
         FROM pc49.journal_entry WHERE id = $1`, [reversalId],
    )
    expect(e.rows[0].period).toBe('2026-02')
    expect(e.rows[0].reversal_of).toBe(originalId)
    expect(e.rows[0].posted).not.toBeNull()
  })

  it('swaps debits and credits', async () => {
    const r = await db.query<{ dr: string; cr: string; amount: string }>(
      `SELECT l.debit_account AS dr, l.credit_account AS cr, l.amount_usd::text AS amount
         FROM pc49.journal_line l
         JOIN pc49.journal_entry e ON e.id = l.entry_id
        WHERE e.reversal_of_id = $1`, [originalId],
    )
    expect(r.rows[0].dr).toBe('511')
    expect(r.rows[0].cr).toBe('131')
    expect(Number(r.rows[0].amount)).toBe(5310)
  })

  it('reverses the weight as well as the money', async () => {
    const r = await db.query<{ qty_native: string; qty_gram: string }>(
      `SELECT l.qty_native::text, l.qty_gram::text
         FROM pc49.journal_line l
         JOIN pc49.journal_entry e ON e.id = l.entry_id
        WHERE e.reversal_of_id = $1`, [originalId],
    )
    expect(Number(r.rows[0].qty_native)).toBe(1)
    expect(Number(r.rows[0].qty_gram)).toBe(37.5)
  })

  it('leaves the original untouched', async () => {
    const r = await db.query<{ dr: string; voided: string | null }>(
      `SELECT l.debit_account AS dr, e.voided_at::text AS voided
         FROM pc49.journal_line l JOIN pc49.journal_entry e ON e.id = l.entry_id
        WHERE e.id = $1`, [originalId],
    )
    expect(r.rows[0].dr).toBe('131')
    expect(r.rows[0].voided).toBeNull()
  })

  it('refuses to reverse into a closed period', async () => {
    await expect(
      db.query(`SELECT pc49.reverse_entry($1, '2026-01-20'::date)`, [originalId]),
    ).rejects.toThrow(/closed/i)
  })

  it('refuses to reverse an entry that was never posted', async () => {
    const e = await db.query<{ id: string }>(
      `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
       VALUES ('2026-02-20', '2026-02', 'draft', 'MANUAL') RETURNING id`,
    )
    await expect(
      db.query(`SELECT pc49.reverse_entry($1, '2026-02-21'::date)`, [e.rows[0].id]),
    ).rejects.toThrow(/not posted/i)
  })
})
