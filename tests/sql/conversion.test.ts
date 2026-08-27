import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function newConversion(kind = 'RA_RP'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_conversion (conv_date, kind) VALUES ('2026-01-03', $1) RETURNING id`,
    [kind],
  )
  return r.rows[0].id
}

async function leg(convId: string, type: string, gold: string, uom: string, qty: number) {
  await db.query(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, amount, conversion_id)
     VALUES ('2026-01-03', $1, $2, $3, $4, 0, $5)`,
    [type, gold, uom, qty, convId],
  )
}

/** Conversions are checked when they are marked complete, not on every leg. */
async function complete(convId: string) {
  await db.query(`UPDATE pc49.gold_conversion SET completed_at = now() WHERE id = $1`, [convId])
}

describe('internal conversions', () => {
  it('turns 37.5 grams of Grain into one luong of Rong Phung', async () => {
    const c = await newConversion()
    await leg(c, 'TRANSFER_OUT', 'GRAIN', 'GRAM', -37.5)
    await leg(c, 'RA_RP', 'RP', 'LUONG', 1)
    await complete(c)

    const r = await db.query<{ out_g: string; in_g: string }>(
      `SELECT sum(CASE WHEN qty_gram < 0 THEN qty_gram ELSE 0 END)::text AS out_g,
              sum(CASE WHEN qty_gram > 0 THEN qty_gram ELSE 0 END)::text AS in_g
         FROM pc49.gold_txn WHERE conversion_id = $1`, [c],
    )
    expect(Number(r.rows[0].out_g)).toBe(-37.5)
    expect(Number(r.rows[0].in_g)).toBe(37.5)
  })

  it('refuses a conversion with only one side', async () => {
    const c = await newConversion('TRANSFER')
    await leg(c, 'TRANSFER_OUT', 'GRAIN', 'GRAM', -37.5)
    await expect(complete(c)).rejects.toThrow(/one side|does not balance/i)
  })

  it('accepts a difference inside the configured tolerance', async () => {
    const c = await newConversion('TRANSFER')
    await leg(c, 'TRANSFER_OUT', 'GRAIN', 'GRAM', -1000)
    await leg(c, 'TRANSFER_IN', 'PT', 'GRAM', 997)   // 0.3 percent short
    await complete(c)
    const r = await db.query<{ note: string | null }>(
      `SELECT variance_note AS note FROM pc49.gold_conversion WHERE id = $1`, [c],
    )
    expect(r.rows[0].note).toBeNull()
  })

  it('records a warning when the difference exceeds tolerance, but still saves', async () => {
    const c = await newConversion('TRANSFER')
    await leg(c, 'TRANSFER_OUT', 'GRAIN', 'GRAM', -1000)
    await leg(c, 'TRANSFER_IN', 'PT', 'GRAM', 900)   // 10 percent short
    await complete(c)
    const r = await db.query<{ note: string | null; completed: string | null }>(
      `SELECT variance_note AS note, completed_at::text AS completed
         FROM pc49.gold_conversion WHERE id = $1`, [c],
    )
    expect(r.rows[0].completed).not.toBeNull()
    expect(r.rows[0].note).toMatch(/10/)
  })

  it('reads the tolerance from system_param rather than a literal', async () => {
    await db.query(
      `UPDATE pc49.system_param SET value = 20 WHERE key = 'CONVERSION_WEIGHT_TOLERANCE_PCT'`)
    const c = await newConversion('TRANSFER')
    await leg(c, 'TRANSFER_OUT', 'GRAIN', 'GRAM', -1000)
    await leg(c, 'TRANSFER_IN', 'PT', 'GRAM', 900)   // still 10 percent, now inside tolerance
    await complete(c)
    const r = await db.query<{ note: string | null }>(
      `SELECT variance_note AS note FROM pc49.gold_conversion WHERE id = $1`, [c],
    )
    expect(r.rows[0].note).toBeNull()
    await db.query(
      `UPDATE pc49.system_param SET value = 0.5 WHERE key = 'CONVERSION_WEIGHT_TOLERANCE_PCT'`)
  })

  it('requires a transfer leg to belong to a conversion', async () => {
    await expect(
      db.query(`INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
                VALUES ('2026-01-03', 'TRANSFER_OUT', 'GRAIN', 'GRAM', -10, 0)`),
    ).rejects.toThrow(/gold_txn_transfer_needs_conversion/)
  })
})
