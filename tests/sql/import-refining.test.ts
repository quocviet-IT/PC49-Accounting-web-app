import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function newBatch(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.import_batch (source, file_name)
     VALUES ('REFINING_LOT', 'lots.csv') RETURNING id`)
  return r.rows[0].id
}

const stage = (batch: string, rowNo: number, payload: Record<string, string>) =>
  db.query(`SELECT pc49.stage_import_row($1, $2, $3::jsonb)`,
    [batch, rowNo, JSON.stringify(payload)])

const commit = (batch: string) =>
  db.query(`SELECT * FROM pc49.commit_import_batch($1, false)`, [batch])

/** Lot S26.01 as sheet 3.2 records it: sent 6 January, assayed, fees frozen. */
const lot = {
  lot_code: 'S26.01', status: 'ASSAYED', refinery_name: 'CTY4',
  sent_date: '2026-01-06', assay_date: '2026-01-20',
  spot_gold_per_oz_sent: '4498', spot_pt_per_oz_sent: '2170',
  spot_gold_per_oz_assay: '4450', spot_pt_per_oz_assay: '2432',
  fee_pct_gold: '0.5', fee_pct_pt: '5',
}

describe('a lot arrives with its bags', () => {
  it('makes one lot out of the rows that share its code', async () => {
    const b = await newBatch()
    await stage(b, 2, { ...lot, seq: '1', owner_code: 'PC49', metal: 'PLATINUM',
      gold_type_code: 'PT', source_desc: 'PT 99.99', gross_weight_gram: '195.09',
      gold_pct: '0.9999', assay_weight_gram: '194.93', assay_pct: '0.9916' })
    await stage(b, 3, { ...lot, seq: '2', owner_code: 'PC49', metal: 'PLATINUM',
      gold_type_code: 'PT', source_desc: 'PT 99.99', gross_weight_gram: '112.77',
      gold_pct: '0.9999' })
    await commit(b)
    const r = await db.query<{ lots: string; bags: string; status: string }>(
      `SELECT (SELECT count(*) FROM pc49.refining_lot WHERE lot_code = 'S26.01')::text AS lots,
              (SELECT count(*) FROM pc49.refining_lot_line l
                 JOIN pc49.refining_lot t ON t.id = l.lot_id
                WHERE t.lot_code = 'S26.01')::text AS bags,
              (SELECT status::text FROM pc49.refining_lot WHERE lot_code = 'S26.01') AS status`)
    expect(r.rows[0]).toMatchObject({ lots: '1', bags: '2', status: 'ASSAYED' })
  })

  it('keeps the assay figures the refinery sent back', async () => {
    const r = await db.query<{ w: string; p: string }>(
      `SELECT l.assay_weight_gram::text AS w, l.assay_pct::text AS p
         FROM pc49.refining_lot_line l JOIN pc49.refining_lot t ON t.id = l.lot_id
        WHERE t.lot_code = 'S26.01' AND l.seq = 1`)
    expect(Number(r.rows[0].w)).toBeCloseTo(194.93, 2)
    expect(Number(r.rows[0].p)).toBeCloseTo(0.9916, 4)
  })

  it('books no second set of transfer legs for a lot loaded as already sent', async () => {
    // The transfer legs of these three lots are the Transfer rows the
    // accountant already wrote in the sheet. The trigger that books legs fires
    // on a status UPDATE, so a lot built straight at its final status adds no
    // second set - this test is what keeps that true.
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn t
         JOIN pc49.refining_lot l ON l.id = t.refining_lot_id
        WHERE l.lot_code = 'S26.01'`)
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('reads the bag value from the figures it was given', async () => {
    // The green table is a view over these columns. If the loader wrote the
    // wrong ones the screen would still draw, showing nothing.
    const r = await db.query<{ pure: string; est: string }>(
      `SELECT v.pure_weight_gram::text AS pure, v.estimated_value::text AS est
         FROM pc49.v_refining_lot_line_value v
         JOIN pc49.refining_lot t ON t.id = v.lot_id
        WHERE t.lot_code = 'S26.01' AND v.seq = 1`)
    // 195.09 g at 99.99% is 195.07 g of pure metal.
    expect(Number(r.rows[0].pure)).toBeCloseTo(195.07, 1)
    // 195.07 x 2170/31.1 x (1 - 5%) = 12,930 dollars, the sheet's own figure.
    expect(Number(r.rows[0].est)).toBeCloseTo(12930, 0)
  })
})
