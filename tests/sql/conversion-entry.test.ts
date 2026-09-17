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

/** A leg written straight into the table, as the loader and the refining screen write them. */
async function rawLeg(v: {
  type: string; gold: string; uom: string; qty: number
  conversionId?: string | null; lotId?: string | null; doc?: string | null; date?: string
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount,
                                conversion_id, refining_lot_id, doc_no)
     VALUES ($1, $2::pc49.txn_type, $3, $4::pc49.uom, $5, 0, $6, $7, $8) RETURNING id`,
    [v.date ?? '2026-06-03', v.type, v.gold, v.uom, v.qty, v.conversionId ?? null,
     v.lotId ?? null, v.doc ?? null])
  return r.rows[0].id
}

async function rawConversion(kind = 'TRANSFER', note: string | null = null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_conversion (conv_date, kind, note)
     VALUES ('2026-06-03', $1::pc49.conversion_kind, $2) RETURNING id`, [kind, note])
  return r.rows[0].id
}

describe('where a transfer leg leaves the gold', () => {
  it('keeps a conversion inside the vault: nothing goes to the refinery', async () => {
    const c = await rawConversion()
    const out = await rawLeg({ type: 'TRANSFER_OUT', gold: 'GRAIN', uom: 'GRAM', qty: -37.5, conversionId: c })
    const into = await rawLeg({ type: 'TRANSFER_IN', gold: 'RP', uom: 'LUONG', qty: 1, conversionId: c })
    await db.query(`SELECT pc49.post_gold_txn($1)`, [out])
    await db.query(`SELECT pc49.post_gold_txn($1)`, [into])
    const moves = await db.query<{ refinery: number; on_hand: string }>(
      `SELECT count(*) FILTER (WHERE m.bucket = 'AT_REFINERY')::int AS refinery,
              coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'ON_HAND'), 0)::float8::text AS on_hand
         FROM pc49.inventory_movement m WHERE m.source_id IN ($1, $2)`, [out, into])
    expect(moves.rows[0]).toEqual({ refinery: 0, on_hand: '0' })
  })

  it('still sends a refining lot to the refinery', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.MOVE') RETURNING id`)
    const leg = await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -30, lotId: lot.rows[0].id })
    await db.query(`SELECT pc49.post_gold_txn($1)`, [leg])
    const moves = await db.query<{ g: string }>(
      `SELECT coalesce(sum(qty_gram), 0)::float8::text AS g FROM pc49.inventory_movement
        WHERE source_id = $1 AND bucket = 'AT_REFINERY'`, [leg])
    expect(moves.rows[0].g).toBe('30')
  })
})

describe('what may not be corrected from the ledger', () => {
  it('names a refining lot leg, after every older reason', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.BLOCK') RETURNING id`)
    const leg = await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -12, lotId: lot.rows[0].id })
    const r = await db.query<{ code: string; reason: string }>(
      `SELECT pc49.correction_blocked_code($1) AS code, pc49.correction_blocked_reason($1) AS reason`, [leg])
    expect(r.rows[0]).toEqual({
      code: 'REFINING_LEG', reason: 'this row belongs to a refining lot; correct it on the refining screen',
    })
  })
})

describe('a conversion as a record of its own', () => {
  it('moves its revision whenever it changes', async () => {
    const c = await rawConversion()
    await db.query(`UPDATE pc49.gold_conversion SET note = 'doi lai' WHERE id = $1`, [c])
    const r = await db.query<{ revision: number }>(
      `SELECT revision FROM pc49.gold_conversion WHERE id = $1`, [c])
    expect(r.rows[0].revision).toBe(2)
  })

  it('is not cancelled without a reason', async () => {
    const c = await rawConversion()
    await expect(db.query(
      `UPDATE pc49.gold_conversion SET voided_at = now() WHERE id = $1`, [c]))
      .rejects.toThrow(/gold_conversion_void_needs_reason/)
  })
})
