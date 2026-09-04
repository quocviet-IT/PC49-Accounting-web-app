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
  async function buy(day: string, gram: number, pct: number | null, amount: number) {
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, gold_pct)
       VALUES ($1, 'PO', 'SG', 'GRAM', $2, 50, $3, $4) RETURNING id`,
      [day, gram, amount, pct])
    return r.rows[0].id
  }

  it('offers the scrap bought but not yet sent anywhere', async () => {
    const id = await buy('2026-05-01', 10, 0.583, -500)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_refining_available_purchase WHERE id = $1`, [id])
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('sorts a purchase into the bag its purity puts it in', async () => {
    const low = await buy('2026-05-02', 10, 0.583, -500)
    const high = await buy('2026-05-02', 10, 0.9893, -900)
    const r = await db.query<{ id: string; band: string }>(
      `SELECT id, grade_band AS band FROM pc49.v_refining_available_purchase
        WHERE id = ANY($1)`, [[low, high]])
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x.band]))
    // Eighteen carat is 0.75, which is where the sheet's two bags divide.
    expect(byId[low]).toBe('10-18k/grs')
    expect(byId[high]).toBe('19-24k/grs')
  })

  it('totals the picked purchases per bag, the way the batch tab does', async () => {
    const lot = await newLot('S26.PICK')
    const a = await buy('2026-05-03', 100, 0.60, -3000)
    const b = await buy('2026-05-03', 100, 0.70, -4000)
    const c = await buy('2026-05-03', 50, 0.99, -5000)
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

  it('will not guess a bag for scrap nobody recorded a purity for', async () => {
    // Counting it as low grade would understate the 24k the lot is estimated
    // on, which is the figure the send is priced against.
    const t = await buy('2026-05-06', 30, null, -1200)
    const r = await db.query<{ band: string | null }>(
      `SELECT grade_band AS band FROM pc49.v_refining_available_purchase WHERE id = $1`, [t])
    expect(r.rows[0].band).toBeNull()
  })
})
