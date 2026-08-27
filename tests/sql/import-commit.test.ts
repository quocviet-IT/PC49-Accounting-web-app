import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function newBatch(source: string, file = 'test.xlsx'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.import_batch (source, file_name) VALUES ($1, $2) RETURNING id`,
    [source, file])
  return r.rows[0].id
}

async function stage(batch: string, rowNo: number, payload: Record<string, unknown>) {
  const r = await db.query<{ status: string }>(
    `SELECT pc49.stage_import_row($1, $2, $3::jsonb)::text AS status`,
    [batch, rowNo, JSON.stringify(payload)])
  return r.rows[0].status
}

async function commit(batch: string, partial = false) {
  const r = await db.query<{ committed: number; left_rejected: number }>(
    `SELECT committed, left_rejected FROM pc49.commit_import_batch($1, $2)`,
    [batch, partial])
  return r.rows[0]
}

async function withdraw(batch: string) {
  const r = await db.query<{ n: string }>(
    `SELECT pc49.withdraw_import_batch($1)::text AS n`, [batch])
  return Number(r.rows[0].n)
}

describe('committing a reviewed batch', () => {
  it('writes the rows into the table they belong in', async () => {
    const batch = await newBatch('OPENING_INVENTORY', 'NXT 2026')
    await stage(batch, 1, { as_of: '2025-12-31', gold_type_code: 'PT', qty: '250.5' })
    await stage(batch, 2, { as_of: '2025-12-31', gold_type_code: 'AE', qty: '2', uom: 'OZ' })

    const out = await commit(batch)
    expect(out.committed).toBe(2)

    const r = await db.query<{ code: string; gram: string }>(
      `SELECT gold_type_code AS code, qty_gram::text AS gram
         FROM pc49.inventory_movement
        WHERE source_type = 'OPENING' AND move_date = '2025-12-31'
        ORDER BY gold_type_code`)
    expect(r.rows.map((x) => x.code)).toEqual(['AE', 'PT'])
    // Two ounces, converted here rather than by whoever typed the sheet. Weight
    // conversion uses 31.105, not the 31.1 that values a holding.
    expect(Number(r.rows[0].gram)).toBeCloseTo(62.21, 2)
    expect(Number(r.rows[1].gram)).toBeCloseTo(250.5, 2)
  })

  it('points each staged row at the record it became', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.import_row i
         JOIN pc49.inventory_movement m ON m.id = i.committed_ref
        WHERE i.status = 'COMMITTED'`)
    expect(Number(r.rows[0].n)).toBe(2)
  })

  it('refuses while rows are still rejected, and says how many', async () => {
    const batch = await newBatch('OPENING_INVENTORY')
    await stage(batch, 1, { as_of: '2025-12-31', gold_type_code: 'SG', qty: '5' })
    await stage(batch, 2, { as_of: '2025-12-31', gold_type_code: 'NOPE', qty: '5' })
    await expect(commit(batch)).rejects.toThrow(/1 of the rows.*still rejected/)
  })

  it('commits partially only when told to, and remembers that it did', async () => {
    const batch = await newBatch('OPENING_INVENTORY')
    await stage(batch, 1, { as_of: '2025-12-30', gold_type_code: 'SG', qty: '5' })
    await stage(batch, 2, { as_of: '2025-12-30', gold_type_code: 'NOPE', qty: '5' })

    const out = await commit(batch, true)
    expect(out.committed).toBe(1)
    expect(out.left_rejected).toBe(1)

    const r = await db.query<{ partial: boolean }>(
      `SELECT committed_partial AS partial FROM pc49.import_batch WHERE id = $1`, [batch])
    expect(r.rows[0].partial).toBe(true)
  })

  it('refuses to commit the same batch twice', async () => {
    const batch = await newBatch('OPENING_INVENTORY')
    await stage(batch, 1, { as_of: '2025-12-29', gold_type_code: 'SG', qty: '1' })
    await commit(batch)
    await expect(commit(batch)).rejects.toThrow(/already committed/)
  })

  it('gathers journal rows sharing a key into one entry', async () => {
    const batch = await newBatch('JOURNAL', 'SO CAI 2026')
    await stage(batch, 1, { entry_key: 'A', entry_date: '2026-03-02',
      debit_account: '131', amount: '500', memo: 'sale' })
    await stage(batch, 2, { entry_key: 'A', entry_date: '2026-03-02',
      credit_account: '511', amount: '500' })
    await stage(batch, 3, { entry_key: 'B', entry_date: '2026-03-03',
      debit_account: '1111', amount: '200' })
    await stage(batch, 4, { entry_key: 'B', entry_date: '2026-03-03',
      credit_account: '131', amount: '200' })

    expect((await commit(batch)).committed).toBe(4)

    const r = await db.query<{ n: string; lines: string }>(
      `SELECT count(DISTINCT e.id)::text AS n, count(l.*)::text AS lines
         FROM pc49.journal_entry e JOIN pc49.journal_line l ON l.entry_id = e.id
        WHERE e.entry_date IN ('2026-03-02', '2026-03-03')`)
    expect(Number(r.rows[0].n)).toBe(2)
    expect(Number(r.rows[0].lines)).toBe(4)
  })

  it('leaves the entries unposted, because posting is a decision', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.journal_entry
        WHERE entry_date IN ('2026-03-02', '2026-03-03') AND posted_at IS NOT NULL`)
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

describe('withdrawing a batch that turned out to be wrong', () => {
  it('removes exactly what the batch made, and nothing else', async () => {
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.inventory_movement`)

    const batch = await newBatch('OPENING_INVENTORY')
    await stage(batch, 1, { as_of: '2025-12-28', gold_type_code: 'SG', qty: '99' })
    await commit(batch)
    expect(await withdraw(batch)).toBe(1)

    const after = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.inventory_movement`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('puts the rows back where they can be corrected and loaded again', async () => {
    const batch = await newBatch('OPENING_INVENTORY')
    await stage(batch, 1, { as_of: '2025-12-27', gold_type_code: 'SG', qty: '7' })
    await commit(batch)
    await withdraw(batch)

    const r = await db.query<{ status: string; committed: string | null }>(
      `SELECT i.status::text AS status, b.committed_at::text AS committed
         FROM pc49.import_row i JOIN pc49.import_batch b ON b.id = i.batch_id
        WHERE i.batch_id = $1`, [batch])
    expect(r.rows[0].status).toBe('VALID')
    expect(r.rows[0].committed).toBeNull()

    await stage(batch, 1, { as_of: '2025-12-27', gold_type_code: 'SG', qty: '8' })
    await commit(batch)
    const v = await db.query<{ gram: string }>(
      `SELECT qty_gram::text AS gram FROM pc49.inventory_movement
        WHERE move_date = '2025-12-27'`)
    expect(v.rows).toHaveLength(1)
    expect(Number(v.rows[0].gram)).toBeCloseTo(8, 2)
  })

  it('sends a posted entry down the reversing road instead', async () => {
    const batch = await newBatch('JOURNAL')
    await stage(batch, 1, { entry_key: 'C', entry_date: '2026-04-02',
      debit_account: '131', amount: '10' })
    await stage(batch, 2, { entry_key: 'C', entry_date: '2026-04-02',
      credit_account: '511', amount: '10' })
    await commit(batch)
    await db.query(
      `UPDATE pc49.journal_entry SET posted_at = now() WHERE entry_date = '2026-04-02'`)

    await expect(withdraw(batch)).rejects.toThrow(/reversing entry/)
  })

  it('will not pretend a price load can be undone', async () => {
    // These write by date and key, so an earlier figure they overwrote is gone.
    // Saying so beats a withdrawal that quietly leaves the wrong price standing.
    const batch = await newBatch('SPOT_PRICE')
    await stage(batch, 1, { price_date: '2026-05-04', metal: 'GOLD', spot_per_oz: '4900' })
    await commit(batch)
    await expect(withdraw(batch)).rejects.toThrow(/cannot restore what it replaced/)
  })

  it('refuses to withdraw a batch that was never committed', async () => {
    const batch = await newBatch('OPENING_INVENTORY')
    await expect(withdraw(batch)).rejects.toThrow(/not committed/)
  })
})

describe('the load answers to the source, end to end', () => {
  // The acceptance test for this package: state what the spreadsheet closed at,
  // load the detail, and watch the reconciliation go from disagreeing to
  // agreeing on its own.
  const AS_OF = '2026-06-30'

  it('goes from disagreeing to agreeing once the detail is in', async () => {
    await db.exec(`
      INSERT INTO pc49.import_expected_figure (as_of, metric, metric_key, expected, source_note)
      VALUES ('${AS_OF}', 'CASH_BALANCE', '1121-6086', 41234.56, 'B. REPORT THUCHI')`)

    const before = await db.query<{ agrees: boolean; diff: string }>(
      `SELECT agrees, difference::text AS diff FROM pc49.import_reconciliation($1)
        WHERE metric_key = '1121-6086'`, [AS_OF])
    expect(before.rows[0].agrees).toBe(false)
    expect(Number(before.rows[0].diff)).toBeCloseTo(-41234.56, 2)

    const batch = await newBatch('OPENING_CASH', 'B. REPORT THUCHI')
    await stage(batch, 1, { cash_account_code: '1121-6086', as_of: '2026-06-01',
      amount: '41234.56' })
    await commit(batch)

    const after = await db.query<{ agrees: boolean; diff: string }>(
      `SELECT agrees, difference::text AS diff FROM pc49.import_reconciliation($1)
        WHERE metric_key = '1121-6086'`, [AS_OF])
    expect(after.rows[0].agrees).toBe(true)
    expect(Number(after.rows[0].diff)).toBeCloseTo(0, 2)
  })
})
