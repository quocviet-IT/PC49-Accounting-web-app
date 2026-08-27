import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

let lotSeq = 0
async function newLot(code?: string): Promise<string> {
  lotSeq += 1
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.refining_lot (lot_code, refinery_name) VALUES ($1, 'Test Refinery') RETURNING id`,
    [code ?? `T26.${String(lotSeq).padStart(2, '0')}`],
  )
  return r.rows[0].id
}

async function send(lotId: string, date = '2026-01-23', goldSpot = 5015, ptSpot = 2170) {
  await db.query(
    `UPDATE pc49.refining_lot
        SET status = 'SENT', sent_date = $2,
            spot_gold_per_oz_sent = $3, spot_pt_per_oz_sent = $4
      WHERE id = $1`, [lotId, date, goldSpot, ptSpot],
  )
}

describe('the lot state machine', () => {
  it('starts a lot as a draft', async () => {
    const id = await newLot()
    const r = await db.query<{ status: string }>(
      `SELECT status::text FROM pc49.refining_lot WHERE id = $1`, [id])
    expect(r.rows[0].status).toBe('DRAFT')
  })

  it('refuses to send a lot with no send date or spot price', async () => {
    const id = await newLot()
    await expect(
      db.query(`UPDATE pc49.refining_lot SET status = 'SENT' WHERE id = $1`, [id]),
    ).rejects.toThrow(/send date|spot/i)
  })

  it('refuses to skip a stage', async () => {
    const id = await newLot()
    await send(id)
    await expect(
      db.query(`UPDATE pc49.refining_lot SET status = 'RECEIVED', received_date = '2026-01-30'
                 WHERE id = $1`, [id]),
    ).rejects.toThrow(/cannot move from SENT to RECEIVED/i)
  })

  it('refuses to go backwards', async () => {
    const id = await newLot()
    await send(id)
    await expect(
      db.query(`UPDATE pc49.refining_lot SET status = 'DRAFT' WHERE id = $1`, [id]),
    ).rejects.toThrow(/cannot move from SENT to DRAFT/i)
  })

  it('stamps the loss rates on the lot when it is sent', async () => {
    const id = await newLot()
    await send(id)
    const r = await db.query<{ gold: string; pt: string }>(
      `SELECT fee_pct_gold::text AS gold, fee_pct_pt::text AS pt
         FROM pc49.refining_lot WHERE id = $1`, [id])
    expect(Number(r.rows[0].gold)).toBe(0.5)
    expect(Number(r.rows[0].pt)).toBe(5)
  })

  it('keeps a sent lot on its own rates when the parameter later changes', async () => {
    const id = await newLot()
    await send(id)
    await db.query(`UPDATE pc49.system_param SET value = 9 WHERE key = 'REFINING_FEE_PCT_GOLD'`)
    const r = await db.query<{ gold: string }>(
      `SELECT fee_pct_gold::text AS gold FROM pc49.refining_lot WHERE id = $1`, [id])
    expect(Number(r.rows[0].gold)).toBe(0.5)
    await db.query(`UPDATE pc49.system_param SET value = 0.5 WHERE key = 'REFINING_FEE_PCT_GOLD'`)
  })
})

describe('lot lines', () => {
  it('derives the 24K equivalent from gross weight and purity', async () => {
    const id = await newLot()
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, source_desc, gross_weight_gram, gold_pct)
       VALUES ($1, 1, 'PC49', 'GOLD', 'SCRAP 706.4GR 73.51%', 706.4, 0.7351)`, [id])
    const r = await db.query<{ pure: string }>(
      `SELECT pure_weight_gram::text AS pure FROM pc49.refining_lot_line WHERE lot_id = $1`, [id])
    expect(Number(r.rows[0].pure)).toBeCloseTo(519.27464, 5)
  })

  it('requires every line to name an owner', async () => {
    const id = await newLot()
    await expect(
      db.query(`INSERT INTO pc49.refining_lot_line
                  (lot_id, seq, metal, source_desc, gross_weight_gram, gold_pct)
                VALUES ($1, 1, 'GOLD', 'no owner', 100, 0.9)`, [id]),
    ).rejects.toThrow(/owner_code/)
  })
})

describe('lot S26.02, pooled between PC49 and MH', () => {
  let lotId: string

  beforeAll(async () => {
    lotId = await newLot('S26.02')
    await send(lotId, '2026-01-23', 5015, 2170)

    // Owner, description, gross, purity, weight confirmed at assay.
    const lines: [string, string, number | null, number, number][] = [
      ['PC49', '18CS',                   null,  0.9999, 559.80],
      ['PC49', '6ML',                    null,  0.9999, 186.60],
      ['PC49', 'SCRAP 42.49GR 75.30%',   null,  0.7530,  42.41],
      ['PC49', 'SCRAP 150.3GR 65.50%',   null,  0.6550, 150.33],
      ['PC49', 'SCRAP 520.44GR 98.93%',  null,  0.9893, 520.47],
      ['MH',   'SCRAP 706.4GR 73.51%',  706.40, 0.7351, 707.42],
      ['MH',   'SCRAP 278.6GR 98.17%',  278.60, 0.9817, 278.89],
    ]
    let seq = 0
    for (const [owner, desc, gross, pct, assay] of lines) {
      seq += 1
      await db.query(
        `INSERT INTO pc49.refining_lot_line
           (lot_id, seq, owner_code, metal, source_desc, gross_weight_gram, gold_pct,
            assay_pct, assay_weight_gram)
         VALUES ($1, $2, $3, 'GOLD', $4, $5, $6, $6, $7)`,
        [lotId, seq, owner, desc, gross, pct, assay],
      )
    }

    await db.query(
      `UPDATE pc49.refining_lot
          SET status = 'ASSAYED', assay_date = '2026-01-25', spot_gold_per_oz_assay = 5333
        WHERE id = $1`, [lotId])
  })

  it('reproduces the estimated value of the two MH lines to the cent', async () => {
    const r = await db.query<{ desc: string; est: string }>(
      `SELECT source_desc AS desc, round(estimated_value, 4)::text AS est
         FROM pc49.v_refining_lot_line_value
        WHERE lot_id = $1 AND owner_code = 'MH' ORDER BY seq`, [lotId])
    expect(Number(r.rows[0].est)).toBeCloseTo(83316.4472, 3)
    expect(Number(r.rows[1].est)).toBeCloseTo(43882.7193, 3)
  })

  it('splits the lot 59.7 percent PC49 to 40.3 percent MH', async () => {
    const r = await db.query<{ owner: string; g: string; share: string }>(
      `SELECT owner_code AS owner, assay_weight_gram::text AS g, round(share_pct, 1)::text AS share
         FROM pc49.v_refining_owner_share WHERE lot_id = $1 ORDER BY owner_code`, [lotId])
    const byOwner = Object.fromEntries(r.rows.map((x) => [x.owner, x]))
    expect(Number(byOwner.PC49.g)).toBeCloseTo(1459.61, 2)
    expect(Number(byOwner.MH.g)).toBeCloseTo(986.31, 2)
    expect(Number(byOwner.PC49.share)).toBeCloseTo(59.7, 1)
    expect(Number(byOwner.MH.share)).toBeCloseTo(40.3, 1)
  })

  it('totals 2,445.92 grams at assay', async () => {
    const r = await db.query<{ total: string }>(
      `SELECT total_assay_gram::text AS total FROM pc49.v_refining_lot_summary WHERE lot_id = $1`,
      [lotId])
    expect(Number(r.rows[0].total)).toBeCloseTo(2445.92, 2)
  })

  it('records the spot movement between send and assay without posting it', async () => {
    const r = await db.query<{ per_gram: string; value: string }>(
      `SELECT spot_variance_per_gram::text AS per_gram, spot_variance_value::text AS value
         FROM pc49.v_refining_lot_summary WHERE lot_id = $1`, [lotId])
    expect(Number(r.rows[0].per_gram)).toBeCloseTo(10.2250804, 6)

    // Recorded, not posted: no journal entry exists for this lot.
    const j = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.journal_entry
        WHERE memo LIKE '%S26.02%'`)
    expect(Number(j.rows[0].n)).toBe(0)
  })

  it('keeps MH weight out of the PC49 share', async () => {
    const r = await db.query<{ g: string }>(
      `SELECT coalesce(sum(assay_weight_gram), 0)::text AS g
         FROM pc49.v_refining_owner_share
        WHERE lot_id = $1 AND owner_code = 'PC49'`, [lotId])
    expect(Number(r.rows[0].g)).toBeCloseTo(1459.61, 2)
    expect(Number(r.rows[0].g)).not.toBeCloseTo(2445.92, 2)
  })
})

describe('receiving the refined gold', () => {
  it('refuses a receipt before the lot has been assayed', async () => {
    const id = await newLot()
    await send(id)
    await expect(
      db.query(`SELECT pc49.receive_refining($1, '2026-01-30'::date, 'PC49', 100, 140)`, [id]),
    ).rejects.toThrow(/assayed/i)
  })

  it('records what came back per owner and moves the lot to RECEIVED', async () => {
    const id = await newLot()
    await send(id)
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, source_desc, gross_weight_gram, gold_pct, assay_weight_gram)
       VALUES ($1, 1, 'PC49', 'GOLD', 'scrap', 200, 0.75, 200),
              ($1, 2, 'MH',   'GOLD', 'scrap', 100, 0.90, 100)`, [id])
    await db.query(`UPDATE pc49.refining_lot
                       SET status = 'ASSAYED', assay_date = '2026-01-25', spot_gold_per_oz_assay = 5333
                     WHERE id = $1`, [id])

    await db.query(`SELECT pc49.receive_refining($1, '2026-01-30'::date, 'PC49', 150, 140)`, [id])
    const r = await db.query<{ status: string; g: string }>(
      `SELECT l.status::text,
              (SELECT sum(qty_gram)::text FROM pc49.refining_receipt WHERE lot_id = l.id) AS g
         FROM pc49.refining_lot l WHERE l.id = $1`, [id])
    expect(r.rows[0].status).toBe('RECEIVED')
    expect(Number(r.rows[0].g)).toBe(150)
  })

  it('refuses to close a lot while an owner is still owed metal', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM pc49.refining_lot WHERE status = 'RECEIVED' ORDER BY created_at DESC LIMIT 1`)
    await expect(
      db.query(`UPDATE pc49.refining_lot SET status = 'CLOSED' WHERE id = $1`, [r.rows[0].id]),
    ).rejects.toThrow(/MH/)
  })

  it('closes once every owner has been paid back', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT id FROM pc49.refining_lot WHERE status = 'RECEIVED' ORDER BY created_at DESC LIMIT 1`)
    await db.query(`SELECT pc49.receive_refining($1, '2026-01-30'::date, 'MH', 90, 140)`, [r.rows[0].id])
    await db.query(`UPDATE pc49.refining_lot SET status = 'CLOSED' WHERE id = $1`, [r.rows[0].id])
    const s = await db.query<{ status: string }>(
      `SELECT status::text FROM pc49.refining_lot WHERE id = $1`, [r.rows[0].id])
    expect(s.rows[0].status).toBe('CLOSED')
  })
})
