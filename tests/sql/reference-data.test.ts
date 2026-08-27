import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

describe('units', () => {
  it('converts the three units to grams', async () => {
    const r = await db.query<{ uom: string; gram_per_unit: string }>(
      'SELECT uom, gram_per_unit FROM pc49.uom_factor ORDER BY uom',
    )
    expect(Object.fromEntries(r.rows.map((x) => [x.uom, Number(x.gram_per_unit)])))
      .toEqual({ GRAM: 1, LUONG: 37.5, OZ: 31.105 })
  })
})

describe('system parameters', () => {
  it('keeps valuation and weight conversion as different numbers', async () => {
    const r = await db.query<{ key: string; value: string }>(
      `SELECT key, value FROM pc49.system_param WHERE key = 'VALUATION_GRAM_PER_OZ'`,
    )
    expect(Number(r.rows[0].value)).toBe(31.1)

    const oz = await db.query<{ gram_per_unit: string }>(
      `SELECT gram_per_unit FROM pc49.uom_factor WHERE uom = 'OZ'`,
    )
    expect(Number(oz.rows[0].gram_per_unit)).toBe(31.105)
    expect(Number(oz.rows[0].gram_per_unit)).not.toBe(Number(r.rows[0].value))
  })

  it('seeds the six business constants', async () => {
    const r = await db.query<{ key: string; value: string }>(
      'SELECT key, value FROM pc49.system_param ORDER BY key',
    )
    expect(Object.fromEntries(r.rows.map((x) => [x.key, Number(x.value)]))).toEqual({
      BANK_PRICE_TOLERANCE_USD: 100,
      CONVERSION_WEIGHT_TOLERANCE_PCT: 0.5,
      OZ_TO_LUONG_PRICE_DIVISOR: 0.83,
      REFINING_FEE_PCT_GOLD: 0.5,
      REFINING_FEE_PCT_PT: 5,
      VALUATION_GRAM_PER_OZ: 31.1,
    })
  })
})

describe('gold types', () => {
  it('seeds all nine with their native units', async () => {
    const r = await db.query<{ code: string; native_uom: string }>(
      'SELECT code, native_uom FROM pc49.gold_type ORDER BY sort_order',
    )
    expect(r.rows).toEqual([
      { code: 'RP', native_uom: 'LUONG' },
      { code: '9999', native_uom: 'LUONG' },
      { code: 'ML', native_uom: 'OZ' },
      { code: 'CS', native_uom: 'OZ' },
      { code: 'AE', native_uom: 'OZ' },
      { code: 'OTH', native_uom: 'OZ' },
      { code: 'SG', native_uom: 'GRAM' },
      { code: 'GRAIN', native_uom: 'GRAM' },
      { code: 'PT', native_uom: 'GRAM' },
    ])
  })

  it('gives every gold type a Vietnamese and an English name', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_type
        WHERE name_vi IS NULL OR name_en IS NULL OR btrim(name_vi) = '' OR btrim(name_en) = ''`,
    )
    expect(Number(r.rows[0].n)).toBe(0)
  })
})
