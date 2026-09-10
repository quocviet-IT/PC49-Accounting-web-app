import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'

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

describe('purity on a refining line', () => {
  // `pure_weight_gram` is generated as `gross_weight_gram * gold_pct`, so the
  // fraction is the only reading that yields a weight. Fourteen-carat gold is
  // 0.583; written as 58.3 — the way it is said aloud and the way it appears in
  // every scrap book — a 739 gram lot becomes 45 kilos of pure gold, valued
  // against spot, on the dashboard and in the report, with nothing objecting.
  async function line(pct: number) {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code, refinery_name)
       VALUES ('PURITY-' || $1::text, 'Metalor US') RETURNING id`, [pct])
    return db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, source_desc, gross_weight_gram, gold_pct)
       VALUES ($1, 1, 'PC49', 'vang cu 14K', 428.60, $2)`, [lot.rows[0].id, pct])
  }

  it('is a fraction, not the number people say out loud', async () => {
    await expect(line(58.3)).rejects.toThrow(/purity_is_a_fraction/)
  })

  it('takes the fraction', async () => {
    await expect(line(0.583)).resolves.toBeTruthy()
    const r = await db.query<{ pure: string }>(
      `SELECT round(pure_weight_gram, 2)::text AS pure FROM pc49.refining_lot_line
        WHERE gold_pct = 0.583`)
    expect(r.rows[0].pure).toBe('249.87')
  })

  it('refuses a line with no gold in it', async () => {
    await expect(line(0)).rejects.toThrow(/purity_is_a_fraction/)
  })

  it('holds the assay to the same terms', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code, refinery_name)
       VALUES ('PURITY-ASSAY', 'Metalor US') RETURNING id`)
    await expect(
      db.query(
        `INSERT INTO pc49.refining_lot_line
           (lot_id, seq, owner_code, gross_weight_gram, gold_pct, assay_pct)
         VALUES ($1, 1, 'PC49', 100, 0.583, 59.1)`, [lot.rows[0].id]),
    ).rejects.toThrow(/assay_is_a_fraction/)
  })
})

describe('what the refinery has sent back', () => {
  // The owner view used to join the receipts through a LATERAL that already
  // summed them for the whole lot, then sum that again across the lot's lines.
  // Two lines doubled it; five multiplied it by five. What that costs is the
  // figure beside it — "still owed" is the share less what came back, so an
  // inflated receipt makes a lot look settled while the refinery still holds
  // metal, and settled is the state nobody looks at again.
  async function lotWithLines(code: string, lines: number) {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code, refinery_name, status)
       VALUES ($1, 'Metalor US', 'SENT') RETURNING id`, [code])
    for (let seq = 1; seq <= lines; seq += 1) {
      await db.query(
        `INSERT INTO pc49.refining_lot_line
           (lot_id, seq, owner_code, gross_weight_gram, gold_pct)
         VALUES ($1, $2, 'PC49', 100, 0.583)`, [lot.rows[0].id, seq])
    }
    return lot.rows[0].id
  }

  it('is counted once however many lines the lot has', async () => {
    for (const lines of [1, 2, 5]) {
      const id = await lotWithLines(`RECEIPT-${lines}`, lines)
      await db.query(
        `INSERT INTO pc49.refining_receipt
           (lot_id, receive_date, gold_type_code, owner_code, qty_gram)
         VALUES ($1, '2026-02-01', 'GRAIN', 'PC49', 120)`, [id])
      const r = await db.query<{ got: string }>(
        `SELECT received_gram::text AS got FROM pc49.v_refining_owner_share
          WHERE lot_id = $1 AND owner_code = 'PC49'`, [id])
      expect(Number(r.rows[0].got)).toBe(120)
    }
  })

  it('adds up several receipts against one lot', async () => {
    const id = await lotWithLines('RECEIPT-MANY', 3)
    for (const qty of [40, 55, 25]) {
      await db.query(
        `INSERT INTO pc49.refining_receipt
           (lot_id, receive_date, gold_type_code, owner_code, qty_gram)
         VALUES ($1, '2026-02-02', 'GRAIN', 'PC49', $2)`, [id, qty])
    }
    const r = await db.query<{ got: string }>(
      `SELECT received_gram::text AS got FROM pc49.v_refining_owner_share
        WHERE lot_id = $1 AND owner_code = 'PC49'`, [id])
    expect(Number(r.rows[0].got)).toBe(120)
  })

  it('keeps one owner\'s receipts out of another\'s', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code, refinery_name, status)
       VALUES ('RECEIPT-SPLIT', 'Metalor US', 'SENT') RETURNING id`)
    const id = lot.rows[0].id
    for (const [seq, owner] of [[1, 'PC49'], [2, 'TL']] as const) {
      await db.query(
        `INSERT INTO pc49.refining_lot_line
           (lot_id, seq, owner_code, gross_weight_gram, gold_pct)
         VALUES ($1, $2, $3, 100, 0.583)`, [id, seq, owner])
    }
    await db.query(
      `INSERT INTO pc49.refining_receipt
         (lot_id, receive_date, gold_type_code, owner_code, qty_gram)
       VALUES ($1, '2026-02-03', 'GRAIN', 'PC49', 90)`, [id])
    const r = await db.query<{ owner: string; got: string }>(
      `SELECT owner_code AS owner, received_gram::text AS got
         FROM pc49.v_refining_owner_share WHERE lot_id = $1 ORDER BY owner_code`, [id])
    expect(r.rows.map((x) => [x.owner, Number(x.got)])).toEqual([['PC49', 90], ['TL', 0]])
  })
})

describe('the assay side, against sheet 3.3 MH SCRAP GOLD', () => {
  let lotId: string

  beforeAll(async () => {
    lotId = await newLot('S26.02-assay')
    await send(lotId, '2026-01-23', 5015, 2170)

    // The same lot, but with the assay column read as the sheet actually has
    // it: column O differs from column H, which is the entire point of an
    // assay. Owner, description, gross (G), % gold (H), assay % (O), assay
    // weight (N).
    const lines: [string, string, number, number, number, number][] = [
      ['MH', 'SCRAP 706.4GR 73.51%', 706.40, 0.7351, 0.7158, 707.42],
      ['MH', 'SCRAP 278.6GR 98.17%', 278.60, 0.9817, 0.9741, 278.89],
    ]
    let seq = 0
    for (const [owner, desc, gross, pct, assayPct, assayWeight] of lines) {
      seq += 1
      await db.query(
        `INSERT INTO pc49.refining_lot_line
           (lot_id, seq, owner_code, metal, source_desc, gross_weight_gram, gold_pct,
            assay_pct, assay_weight_gram)
         VALUES ($1, $2, $3, 'GOLD', $4, $5, $6, $7, $8)`,
        [lotId, seq, owner, desc, gross, pct, assayPct, assayWeight],
      )
    }

    await db.query(
      `UPDATE pc49.refining_lot
          SET status = 'ASSAYED', assay_date = '2026-01-25', spot_gold_per_oz_assay = 5333
        WHERE id = $1`, [lotId])
  })

  it('reproduces the 24k weight after assay, column P', async () => {
    const r = await db.query<{ p: string }>(
      `SELECT round(assay_pure_weight_gram, 6)::text AS p
         FROM pc49.v_refining_lot_line_value WHERE lot_id = $1 AND seq = 1`, [lotId])
    // 707.42 x 0.7158
    expect(Number(r.rows[0].p)).toBeCloseTo(506.371236, 6)
  })

  it('reproduces the price the lot settles at, column T', async () => {
    const r = await db.query<{ t: string }>(
      `SELECT round(assay_value, 5)::text AS t
         FROM pc49.v_refining_lot_line_value WHERE lot_id = $1 AND seq = 1`, [lotId])
    // 506.371236 x (5333 / 31.1) x 0.995, to the cent of the sheet
    expect(Number(r.rows[0].t)).toBeCloseTo(86397.92323, 3)
  })

  it('reproduces what the assay changed, columns W, X and Y', async () => {
    const r = await db.query<{ w: string; x: string; y: string }>(
      `SELECT round(purity_variance, 4)::text AS w,
              round(weight_variance, 6)::text AS x,
              round(value_variance, 5)::text  AS y
         FROM pc49.v_refining_lot_line_value WHERE lot_id = $1 AND seq = 1`, [lotId])
    // The counter judged it 73.51%, the refinery came back with 71.58%.
    expect(Number(r.rows[0].w)).toBeCloseTo(0.0193, 4)
    // So twelve and a bit grams of 24k that were counted on are not there.
    expect(Number(r.rows[0].x)).toBeCloseTo(-12.903404, 5)
    // And yet it is worth more, because spot moved further than purity did.
    expect(Number(r.rows[0].y)).toBeCloseTo(3081.476031, 3)
  })

  it('values the second MH line the same way', async () => {
    const r = await db.query<{ p: string; t: string }>(
      `SELECT round(assay_pure_weight_gram, 6)::text AS p,
              round(assay_value, 5)::text AS t
         FROM pc49.v_refining_lot_line_value WHERE lot_id = $1 AND seq = 2`, [lotId])
    expect(Number(r.rows[0].p)).toBeCloseTo(271.666749, 6)
    expect(Number(r.rows[0].t)).toBeCloseTo(46352.24368, 3)
  })
})

describe('taking the money instead of the metal', () => {
  async function pooledLot(code: string): Promise<string> {
    const id = await newLot(code)
    await send(id, '2026-02-02', 5000, 2200)
    let seq = 0
    for (const owner of ['PC49', 'MH']) {
      seq += 1
      await db.query(
        `INSERT INTO pc49.refining_lot_line
           (lot_id, seq, owner_code, metal, source_desc, gross_weight_gram, gold_pct,
            assay_pct, assay_weight_gram)
         VALUES ($1, $2, $3, 'GOLD', 'SCRAP', 100, 0.75, 0.74, 100)`, [id, seq, owner])
    }
    await db.query(
      `UPDATE pc49.refining_lot SET status = 'ASSAYED', assay_date = '2026-02-05',
              spot_gold_per_oz_assay = 5100 WHERE id = $1`, [id])
    return id
  }

  it('closes a lot where one owner took gold and the other took cash', async () => {
    // Column S of the sheet, Lay tien / Lay vang. Before this the lot could not
    // be closed at all: closing asked every owner for a metal receipt, and an
    // owner who took cash never had one.
    const id = await pooledLot('S26.CASH')
    await db.query(
      `INSERT INTO pc49.refining_receipt
         (lot_id, receive_date, gold_type_code, owner_code, settle_kind, qty_gram)
       VALUES ($1, '2026-02-10', 'GRAIN', 'PC49', 'METAL', 74)`, [id])
    await db.query(
      `INSERT INTO pc49.refining_receipt
         (lot_id, receive_date, gold_type_code, owner_code, settle_kind, amount_usd)
       VALUES ($1, '2026-02-10', 'GRAIN', 'MH', 'CASH', 12136.66)`, [id])

    await db.query(
      `UPDATE pc49.refining_lot SET status = 'RECEIVED', received_date = '2026-02-10'
        WHERE id = $1`, [id])
    await db.query(`UPDATE pc49.refining_lot SET status = 'CLOSED' WHERE id = $1`, [id])

    const r = await db.query<{ s: string }>(
      `SELECT status::text AS s FROM pc49.refining_lot WHERE id = $1`, [id])
    expect(r.rows[0].s).toBe('CLOSED')
  })

  it('still refuses to close while an owner has taken nothing', async () => {
    const id = await pooledLot('S26.OWED')
    await db.query(
      `INSERT INTO pc49.refining_receipt
         (lot_id, receive_date, gold_type_code, owner_code, settle_kind, qty_gram)
       VALUES ($1, '2026-02-10', 'GRAIN', 'PC49', 'METAL', 74)`, [id])
    await db.query(
      `UPDATE pc49.refining_lot SET status = 'RECEIVED', received_date = '2026-02-10'
        WHERE id = $1`, [id])
    await expect(
      db.query(`UPDATE pc49.refining_lot SET status = 'CLOSED' WHERE id = $1`, [id]),
    ).rejects.toThrow(/has not settled with MH/)
  })

  it('refuses a cash settlement carrying a weight', async () => {
    const id = await pooledLot('S26.BADCASH')
    await expect(
      db.query(
        `INSERT INTO pc49.refining_receipt
           (lot_id, receive_date, gold_type_code, owner_code, settle_kind, qty_gram, amount_usd)
         VALUES ($1, '2026-02-10', 'GRAIN', 'MH', 'CASH', 74, 100)`, [id]),
    ).rejects.toThrow(/shape_follows_kind/)
  })

  it('refuses metal with no weight on it', async () => {
    const id = await pooledLot('S26.BADMETAL')
    await expect(
      db.query(
        `INSERT INTO pc49.refining_receipt
           (lot_id, receive_date, gold_type_code, owner_code, settle_kind, amount_usd)
         VALUES ($1, '2026-02-10', 'GRAIN', 'MH', 'METAL', 100)`, [id]),
    ).rejects.toThrow(/shape_follows_kind/)
  })
})

describe('a lot assembled from the purchases that go into it', () => {
  async function buy(day: string, gram: number, pct: number | null, amount: number,
                     detail: string | null = '10-18k/grs') {
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, gold_pct, scrap_detail)
       VALUES ($1, 'PO', 'SG', 'GRAM', $2, 50, $3, $4, $5) RETURNING id`,
      [day, gram, amount, pct, detail])
    return r.rows[0].id
  }

  it('offers the scrap bought but not yet sent anywhere', async () => {
    const id = await buy('2026-05-01', 10, 0.583, -500)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_refining_available_purchase WHERE id = $1`, [id])
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('shows the picker the document number the purchase was given', async () => {
    // The picker is where the accountant matches what she ticked in the sheet
    // to what she is sending; without the number every row reads the same.
    const id = await buy('2026-05-01', 10, 0.583, -500)
    const r = await db.query<{ doc_no: string }>(
      `SELECT doc_no FROM pc49.v_refining_available_purchase WHERE id = $1`, [id])
    expect(r.rows[0].doc_no).toMatch(/^PC49-2605-\d{3}$/)
  })

  it('lists what was ticked with the band and number the picker shows', async () => {
    // The ticked list read straight off gold_txn and so knew neither — every
    // band came up red and every number came up "—".
    const lot = await newLot('S26.TICK')
    const t = await buy('2026-05-01', 10, null, -500, '10K')
    await db.query(
      `INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`, [lot, t])
    const r = await db.query<{ grade_band: string; doc_no: string }>(
      `SELECT grade_band, doc_no FROM pc49.v_refining_lot_source_purchase WHERE lot_id = $1`, [lot])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].grade_band).toBe('10-18k/grs')
    expect(r.rows[0].doc_no).toMatch(/^PC49-2605-\d{3}$/)
  })

  it('sorts a purchase into the bag the counter wrote on it, not by its purity', async () => {
    // B5 + H4 from the accountant: "tuoi vang" is the karat stamped on the
    // piece, "% ham luong" is measured content, and the two bags go by the
    // first. A 90% piece stamped 18k goes in the 10-18k bag. Eight of the
    // fifty priced rows in the source disagree with the 0.75 rule this used.
    const low  = await buy('2026-05-02', 10, 0.90, -500, '10-18k/grs')
    const high = await buy('2026-05-02', 10, 0.70, -900, '19-24k/grs')
    const r = await db.query<{ id: string; band: string }>(
      `SELECT id, grade_band AS band FROM pc49.v_refining_available_purchase
        WHERE id = ANY($1)`, [[low, high]])
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x.band]))
    expect(byId[low]).toBe('10-18k/grs')
    expect(byId[high]).toBe('19-24k/grs')
  })

  it('reads the four grades used before June 2026 as the two bags they became', async () => {
    const a = await buy('2026-01-10', 5, null, -300, '10k/grs')
    const b = await buy('2026-01-10', 5, null, -300, '14k/grs')
    const c = await buy('2026-01-10', 5, null, -300, '16-18k/grs')
    const d = await buy('2026-01-10', 5, null, -300, '23-24k/grs')
    const r = await db.query<{ id: string; band: string }>(
      `SELECT id, grade_band AS band FROM pc49.v_refining_available_purchase WHERE id = ANY($1)`,
      [[a, b, c, d]])
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x.band]))
    expect([byId[a], byId[b], byId[c]]).toEqual(['10-18k/grs', '10-18k/grs', '10-18k/grs'])
    expect(byId[d]).toBe('19-24k/grs')
  })

  it('totals the picked purchases per bag, the way the batch tab does', async () => {
    const lot = await newLot('S26.PICK')
    const a = await buy('2026-05-03', 100, 0.60, -3000)
    const b = await buy('2026-05-03', 100, 0.70, -4000)
    // The bag is what was written on it (0058); this one is labelled high.
    const c = await buy('2026-05-03', 50, 0.99, -5000, '19-24k/grs')
    for (const t of [a, b, c]) {
      await db.query(
        `INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`, [lot, t])
    }
    const r = await db.query<{
      band: string; n: string; gross: string; pure: string; avg: string; cost: string
    }>(
      `SELECT grade_band AS band, purchase_count::text AS n,
              gross_weight_gram::text AS gross, round(pure_weight_gram, 4)::text AS pure,
              round(avg_gold_pct, 4)::text AS avg, total_cost::text AS cost
         FROM pc49.v_refining_lot_source_summary WHERE lot_id = $1 ORDER BY grade_band`, [lot])

    expect(r.rows).toHaveLength(2)
    const low = r.rows[0]
    expect(low.band).toBe('10-18k/grs')
    expect(Number(low.n)).toBe(2)
    expect(Number(low.gross)).toBe(200)
    // 100 x 0.60 + 100 x 0.70
    expect(Number(low.pure)).toBeCloseTo(130, 4)
    // By weight, not a plain average of the two percentages.
    expect(Number(low.avg)).toBeCloseTo(0.65, 4)
    // Purchases carry a negative amount; what the bag cost is that, positive.
    expect(Number(low.cost)).toBe(7000)

    const high = r.rows[1]
    expect(high.band).toBe('19-24k/grs')
    expect(Number(high.gross)).toBe(50)
    expect(Number(high.cost)).toBe(5000)
  })

  it('takes a picked purchase off the list of what can still be picked', async () => {
    const lot = await newLot('S26.TAKEN')
    const t = await buy('2026-05-04', 20, 0.75, -1000)
    await db.query(
      `INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`, [lot, t])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_refining_available_purchase WHERE id = $1`, [t])
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('refuses to send the same purchase to two refineries', async () => {
    const first = await newLot('S26.ONE')
    const second = await newLot('S26.TWO')
    const t = await buy('2026-05-05', 20, 0.75, -1000)
    await db.query(
      `INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`, [first, t])
    await expect(
      db.query(`INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`,
        [second, t]),
    ).rejects.toThrow()
  })

  it('keeps a purchase with a grade but no measured purity in its bag', async () => {
    // 304 of the 354 scrap purchases in the source carry no percentage.
    // Dropping them would leave 81% of the weight out of every lot.
    const t = await buy('2026-05-06', 30, null, -1200, '10-18k/grs')
    const r = await db.query<{ band: string | null }>(
      `SELECT grade_band AS band FROM pc49.v_refining_available_purchase WHERE id = $1`, [t])
    expect(r.rows[0].band).toBe('10-18k/grs')
  })

  it('has no bag for scrap with nothing written on it at all', async () => {
    const t = await buy('2026-05-06', 30, null, -1200, null)
    const r = await db.query<{ band: string | null }>(
      `SELECT grade_band AS band FROM pc49.v_refining_available_purchase WHERE id = $1`, [t])
    expect(r.rows[0].band).toBeNull()
  })

  it('averages purity over the purchases that have one, weighted by their grams', async () => {
    const lot = await newLot('S26.AVG')
    const a = await buy('2026-05-07', 100, 0.60, -3000, '10-18k/grs')
    const b = await buy('2026-05-07', 100, null, -3500, '10-18k/grs')
    const c = await buy('2026-05-07', 300, 0.70, -9000, '10-18k/grs')
    for (const t of [a, b, c]) {
      await db.query(`INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`, [lot, t])
    }
    const r = await db.query<{ gross: string; avg: string; n: string }>(
      `SELECT gross_weight_gram::text AS gross, round(avg_gold_pct, 4)::text AS avg,
              purchase_count::text AS n
         FROM pc49.v_refining_lot_source_summary WHERE lot_id = $1`, [lot])
    expect(r.rows).toHaveLength(1)
    expect(Number(r.rows[0].n)).toBe(3)
    // All 500 g go in the bag; the average is over the 400 g that were measured.
    expect(Number(r.rows[0].gross)).toBe(500)
    expect(Number(r.rows[0].avg)).toBeCloseTo((100 * 0.60 + 300 * 0.70) / 400, 4)
  })
})

describe('sending a lot takes the metal out of the vault', () => {
  /** A draft lot with one weighed line, ready to be sent. */
  async function lotWithLine(code: string, gram = 130.39, pct = 0.693) {
    const id = await newLot(code)
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, gold_type_code, source_desc,
          gross_weight_gram, gold_pct)
       VALUES ($1, 1, 'PC49', 'GOLD', 'SG', '10-18k/grs', $2, $3)`, [id, gram, pct])
    return id
  }

  it('books nothing while the lot is still a draft', async () => {
    const id = await lotWithLine('S26.DRAFT')
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn WHERE refining_lot_id = $1`, [id])
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('books a transfer out for every weighed line when the lot is sent', async () => {
    const id = await lotWithLine('S26.SEND1')
    await send(id)
    const r = await db.query<{ type: string; qty: string; code: string }>(
      `SELECT txn_type::text AS type, qty::text AS qty, gold_type_code AS code
         FROM pc49.gold_txn WHERE refining_lot_id = $1`, [id])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].type).toBe('TRANSFER_OUT')
    expect(r.rows[0].code).toBe('SG')
    // Gold leaving carries a negative quantity, as "Send to assay" does in the
    // source journal.
    expect(Number(r.rows[0].qty)).toBeCloseTo(-130.39, 4)
  })

  it('takes the weight off the shelf and puts it at the refinery', async () => {
    const id = await lotWithLine('S26.SEND2', 200)
    await send(id)
    const r = await db.query<{ bucket: string; gram: string }>(
      `SELECT m.bucket::text AS bucket, m.qty_gram::text AS gram
         FROM pc49.inventory_movement m
         JOIN pc49.gold_txn t ON t.id = m.source_id
        WHERE t.refining_lot_id = $1 ORDER BY m.bucket`, [id])
    const byBucket = Object.fromEntries(r.rows.map((x) => [x.bucket, Number(x.gram)]))
    expect(byBucket.AT_REFINERY).toBeCloseTo(200, 4)
    expect(byBucket.ON_HAND).toBeCloseTo(-200, 4)
  })

  it('posts the send to the journal, so stock and ledger agree', async () => {
    const id = await lotWithLine('S26.SEND3')
    await send(id)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn
        WHERE refining_lot_id = $1 AND journal_entry_id IS NOT NULL`, [id])
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('cannot send a weight nobody recorded', async () => {
    const id = await newLot('S26.NOWEIGHT')
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, gold_type_code, source_desc, gold_pct)
       VALUES ($1, 1, 'PC49', 'GOLD', 'SG', '18CS', 0.9999)`, [id])
    await send(id)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn WHERE refining_lot_id = $1`, [id])
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

describe('receiving settles the lot back into the vault', () => {
  async function sentLot(code: string) {
    const id = await newLot(code)
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, gold_type_code, source_desc,
          gross_weight_gram, gold_pct, assay_pct, assay_weight_gram)
       VALUES ($1, 1, 'PC49', 'GOLD', 'SG', '10-18k/grs', 200, 0.70, 0.70, 200)`, [id])
    await send(id)
    await db.query(
      `UPDATE pc49.refining_lot SET status = 'ASSAYED', assay_date = '2026-01-30'
        WHERE id = $1`, [id])
    return id
  }

  it('books a transfer in for the Grain that comes back', async () => {
    const id = await sentLot('S26.RECV1')
    await db.query(`SELECT pc49.receive_refining($1, '2026-02-05', 'PC49', 140, 100)`, [id])
    const r = await db.query<{ type: string; qty: string; code: string }>(
      `SELECT txn_type::text AS type, qty::text AS qty, gold_type_code AS code
         FROM pc49.gold_txn
        WHERE refining_lot_id = $1 AND txn_type = 'TRANSFER_IN'`, [id])
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].code).toBe('GRAIN')
    expect(Number(r.rows[0].qty)).toBeCloseTo(140, 4)
  })

  it('links the receipt to the transaction it created', async () => {
    const id = await sentLot('S26.RECV2')
    await db.query(`SELECT pc49.receive_refining($1, '2026-02-05', 'PC49', 140, 100)`, [id])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.refining_receipt
        WHERE lot_id = $1 AND gold_txn_id IS NOT NULL`, [id])
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('puts the Grain on the shelf', async () => {
    const id = await sentLot('S26.RECV3')
    await db.query(`SELECT pc49.receive_refining($1, '2026-02-05', 'PC49', 140, 100)`, [id])
    const r = await db.query<{ gram: string }>(
      `SELECT m.qty_gram::text AS gram FROM pc49.inventory_movement m
         JOIN pc49.gold_txn t ON t.id = m.source_id
        WHERE t.refining_lot_id = $1 AND t.txn_type = 'TRANSFER_IN'
          AND m.bucket = 'ON_HAND'`, [id])
    expect(Number(r.rows[0].gram)).toBeCloseTo(140, 4)
  })

  it('books no metal for a settlement taken in cash', async () => {
    const id = await sentLot('S26.RECVCASH')
    await db.query(
      `INSERT INTO pc49.refining_receipt
         (lot_id, receive_date, gold_type_code, owner_code, settle_kind, amount_usd)
       VALUES ($1, '2026-02-05', 'GRAIN', 'PC49', 'CASH', 9000)`, [id])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn
        WHERE refining_lot_id = $1 AND txn_type = 'TRANSFER_IN'`, [id])
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

describe("a pooling partner's metal stays off PC49's books", () => {
  /** A lot carrying one PC49 line and one belonging to MH. */
  async function pooled(code: string) {
    const id = await newLot(code)
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, gold_type_code, source_desc,
          gross_weight_gram, gold_pct)
       VALUES ($1, 1, 'PC49', 'GOLD', 'SG', 'SCRAP 520.44GR 98.93%', 520.44, 0.9893),
              ($1, 2, 'MH',   'GOLD', 'SG', 'SCRAP 706.4GR 73.51%',  706.40, 0.7351)`, [id])
    return id
  }

  it('sends only the house line to the vault door', async () => {
    const id = await pooled('S26.POOL1')
    await send(id)
    const r = await db.query<{ qty: string }>(
      `SELECT qty::text AS qty FROM pc49.gold_txn WHERE refining_lot_id = $1`, [id])
    expect(r.rows).toHaveLength(1)
    // PC49's 520.44 g leaves. MH's 706.4 g travels in the same bag and was
    // never PC49's stock to move.
    expect(Number(r.rows[0].qty)).toBeCloseTo(-520.44, 4)
  })

  it("does not take in the partner's share when it comes back", async () => {
    const id = await pooled('S26.POOL2')
    await send(id)
    await db.query(
      `UPDATE pc49.refining_lot SET status = 'ASSAYED', assay_date = '2026-01-30'
        WHERE id = $1`, [id])
    await db.query(`SELECT pc49.receive_refining($1, '2026-02-05', 'MH', 500, 100)`, [id])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn
        WHERE refining_lot_id = $1 AND txn_type = 'TRANSFER_IN'`, [id])
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

describe('a lot gets its own code', () => {
  it('mints S<YY>.<NN> when none is written, counting within the year', async () => {
    const r = await db.query<{ code: string }>(
      `INSERT INTO pc49.refining_lot (lot_code, sent_date) VALUES ('', '2028-02-01')
       RETURNING lot_code AS code`)
    const s = await db.query<{ code: string }>(
      `INSERT INTO pc49.refining_lot (lot_code, sent_date) VALUES ('', '2028-05-01')
       RETURNING lot_code AS code`)
    expect(r.rows[0].code).toBe('S28.01')
    expect(s.rows[0].code).toBe('S28.02')
  })

  it('keeps a code somebody wrote', async () => {
    const r = await db.query<{ code: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('MANUAL-1') RETURNING lot_code AS code`)
    expect(r.rows[0].code).toBe('MANUAL-1')
  })
})

describe('the assay comes back per bag, in one statement', () => {
  async function sentLotWithBags(code: string) {
    const id = await newLot(code)
    await db.query(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, gold_type_code, source_desc, gross_weight_gram, gold_pct)
       VALUES ($1, 1, 'PC49', 'GOLD', 'SG', '10-18k/grs', 195.09, 0.9999),
              ($1, 2, 'PC49', 'GOLD', 'SG', '19-24k/grs', 112.77, 0.9999)`, [id])
    await send(id, '2026-01-06', 2170, 2170)
    const lines = await db.query<{ id: string; seq: number }>(
      `SELECT id, seq FROM pc49.refining_lot_line WHERE lot_id = $1 ORDER BY seq`, [id])
    return { id, lines: lines.rows }
  }

  it('writes every bag and moves the lot to ASSAYED together', async () => {
    const { id, lines } = await sentLotWithBags('S26.ASSAY1')
    await db.query(`SELECT pc49.record_assay($1, '2026-01-14', 2432, NULL, $2::jsonb)`, [id,
      JSON.stringify([
        { lineId: lines[0].id, assayWeightGram: 194.93, assayPct: 0.9916 },
        { lineId: lines[1].id, assayWeightGram: 112.60, assayPct: 0.8583 },
      ])])
    const lot = await db.query<{ status: string; d: string; spot: string }>(
      `SELECT status::text, assay_date::text AS d, spot_gold_per_oz_assay::text AS spot
         FROM pc49.refining_lot WHERE id = $1`, [id])
    expect(lot.rows[0]).toEqual({ status: 'ASSAYED', d: '2026-01-14', spot: '2432.000000' })
    const r = await db.query<{ w: string; p: string }>(
      `SELECT assay_weight_gram::text AS w, assay_pct::text AS p
         FROM pc49.refining_lot_line WHERE lot_id = $1 ORDER BY seq`, [id])
    expect(r.rows.map((x) => [Number(x.w), Number(x.p)])).toEqual([[194.93, 0.9916], [112.6, 0.8583]])
  })

  it('values the bag at the assay figures once they are in', async () => {
    // Lot S26.01 line 1 of the source, to the cent: 193.29 x 78.20 x 0.95.
    const { id, lines } = await sentLotWithBags('S26.ASSAY2')
    await db.query(`SELECT pc49.record_assay($1, '2026-01-14', 2432, NULL, $2::jsonb)`, [id,
      JSON.stringify([{ lineId: lines[0].id, assayWeightGram: 194.93, assayPct: 0.9916 }])])
    const r = await db.query<{ v: string }>(
      `SELECT round(assay_value, 2)::text AS v FROM pc49.v_refining_lot_line_value
        WHERE lot_id = $1 AND seq = 1`, [id])
    // 194.93 x 0.9916 = 193.2926; x 2432/31.1 x (1 - 0.005)
    expect(Number(r.rows[0].v)).toBeCloseTo(193.2926 * (2432 / 31.1) * 0.995, 2)
  })

  it('refuses a bag that is not in the lot', async () => {
    const { id } = await sentLotWithBags('S26.ASSAY3')
    const other = await sentLotWithBags('S26.ASSAY3b')
    await expect(
      db.query(`SELECT pc49.record_assay($1, '2026-01-14', 2432, NULL, $2::jsonb)`, [id,
        JSON.stringify([{ lineId: other.lines[0].id, assayWeightGram: 1, assayPct: 0.5 }])]),
    ).rejects.toThrow(/not in lot/i)
  })

  it('refuses a lot that has not been sent', async () => {
    const id = await newLot('S26.ASSAY4')
    await expect(
      db.query(`SELECT pc49.record_assay($1, '2026-01-14', 2432, NULL, '[]'::jsonb)`, [id]),
    ).rejects.toThrow(/cannot move from DRAFT to ASSAYED/i)
  })
})

describe('what the accountant may do to a bag', () => {
  const KT = '00000000-0000-4000-8000-00000000c0de'
  beforeAll(async () => {
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${KT}', 'kt-bags@pc49.test');
      INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
    `)
  })

  async function bag(lotId: string, seq = 1): Promise<string> {
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot_line
         (lot_id, seq, owner_code, metal, gold_type_code, source_desc, gross_weight_gram, gold_pct)
       VALUES ($1, $2, 'PC49', 'GOLD', 'SG', '10-18k/grs', 100, 0.6) RETURNING id`, [lotId, seq])
    return r.rows[0].id
  }

  it('lets the accountant take a bag back out of a draft lot', async () => {
    // The first click on "Đóng túi từ phiếu đã chọn" came back "permission
    // denied for table refining_lot_line": the policy said yes, the grant said
    // no — 0017 granted SELECT, INSERT, UPDATE and never DELETE.
    const lot = await newLot('S26.BAG1')
    const id = await bag(lot)
    await asRole(db, KT, () =>
      db.query(`DELETE FROM pc49.refining_lot_line WHERE id = $1`, [id]))
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.refining_lot_line WHERE id = $1`, [id])
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('still lets a whole lot be swept away, bags and all', async () => {
    // The demo sweep and nothing else deletes a lot. It takes the transfer
    // legs 0056 booked first — a lot with gold on the ledger stays — and then
    // the lot, whose bags follow by ON DELETE CASCADE: that is not a bag
    // leaving a lot that was sent.
    const lot = await newLot('S26.BAG3')
    const id = await bag(lot)
    await send(lot)
    await db.query(`DELETE FROM pc49.inventory_movement WHERE source_id IN
                      (SELECT id FROM pc49.gold_txn WHERE refining_lot_id = $1)`, [lot])
    await db.query(`DELETE FROM pc49.gold_txn WHERE refining_lot_id = $1`, [lot])
    await db.query(`DELETE FROM pc49.refining_lot WHERE id = $1`, [lot])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.refining_lot_line WHERE id = $1`, [id])
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('refuses to take a bag out of a lot that has already gone', async () => {
    // 0056 booked the TRANSFER_OUT for this bag when the lot went; a bag that
    // vanishes afterwards would leave the ledger holding gold that no bag has.
    const lot = await newLot('S26.BAG2')
    const id = await bag(lot)
    await send(lot)
    await expect(
      db.query(`DELETE FROM pc49.refining_lot_line WHERE id = $1`, [id]),
    ).rejects.toThrow(/already (been )?sent|not a draft/i)
  })
})
