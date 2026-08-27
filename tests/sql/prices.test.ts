import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => {
  db = await createTestDb()
  // Figures taken verbatim from fixtures/golden-numbers.json, block
  // gold_price_rows_jan_end: on 30 January there was a purchase, on 31 there
  // was not.
  await db.exec(`
    INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price, avg_purchase_price)
    VALUES ('2026-01-30', '9999', 5893.156626506024, 6763.272727),
           ('2026-01-31', '9999', 5893.156626506024, NULL);
  `)
}, 60_000)
afterAll(async () => { await db?.close() })

describe('cogs_price', () => {
  it('uses the weighted average purchase price when there was a purchase', async () => {
    const r = await db.query<{ p: string }>(`SELECT pc49.cogs_price('2026-01-30', '9999') AS p`)
    expect(Number(r.rows[0].p)).toBeCloseTo(6763.272727, 6)
  })

  it('falls back to the market price when there was no purchase', async () => {
    const r = await db.query<{ p: string }>(`SELECT pc49.cogs_price('2026-01-31', '9999') AS p`)
    expect(Number(r.rows[0].p)).toBeCloseTo(5893.156626506024, 6)
  })

  it('returns null for a date with no price at all', async () => {
    const r = await db.query<{ p: string | null }>(`SELECT pc49.cogs_price('2026-02-15', '9999') AS p`)
    expect(r.rows[0].p).toBeNull()
  })

  it('records the variance between market and purchase price', async () => {
    const r = await db.query<{ variance: string }>(
      `SELECT variance FROM pc49.gold_price_daily
        WHERE price_date = '2026-01-30' AND gold_type_code = '9999'`,
    )
    expect(Number(r.rows[0].variance)).toBeCloseTo(-870.1161, 4)
  })
})

describe('spot_price_daily', () => {
  it('derives a price per gram using the valuation divisor, not the weight one', async () => {
    await db.exec(
      `INSERT INTO pc49.spot_price_daily (price_date, metal, spot_per_oz)
       VALUES ('2026-01-23', 'GOLD', 5015)`,
    )
    const r = await db.query<{ g: string }>(
      `SELECT spot_per_gram AS g FROM pc49.spot_price_daily
        WHERE price_date = '2026-01-23' AND metal = 'GOLD'`,
    )
    // Lot S26.02 records 161.2540193 per gram at a spot of 5,015 per oz.
    expect(Number(r.rows[0].g)).toBeCloseTo(161.2540193, 6)
  })
})
