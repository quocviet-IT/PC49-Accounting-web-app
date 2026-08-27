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

describe('chart of accounts', () => {
  it('seeds every account referenced by a gold type', async () => {
    const r = await db.query<{ code: string }>(
      `SELECT g.code FROM pc49.gold_type g
        WHERE NOT EXISTS (SELECT 1 FROM pc49.account a WHERE a.code = g.cogs_account)
           OR NOT EXISTS (SELECT 1 FROM pc49.account a WHERE a.code = g.inventory_account)
           OR NOT EXISTS (SELECT 1 FROM pc49.account a WHERE a.code = g.in_transit_account)`,
    )
    expect(r.rows).toEqual([])
  })

  it('marks the three clearing accounts', async () => {
    const r = await db.query<{ code: string }>(
      'SELECT code FROM pc49.account WHERE is_clearing ORDER BY code',
    )
    expect(r.rows.map((x) => x.code)).toEqual(['1121BW', '1121CK', '1121ZL'])
  })

  it('lets the clearing accounts go negative but not cash on hand', async () => {
    const r = await db.query<{ code: string; allows_negative: boolean }>(
      `SELECT code, allows_negative FROM pc49.account
        WHERE code IN ('1121ZL', '1111') ORDER BY code`,
    )
    expect(r.rows).toEqual([
      { code: '1111', allows_negative: false },
      { code: '1121ZL', allows_negative: true },
    ])
  })

  it('gives every account both names', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.account
        WHERE btrim(coalesce(name_vi, '')) = '' OR btrim(coalesce(name_en, '')) = ''`,
    )
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('classifies each account into an accounting type', async () => {
    const r = await db.query<{ account_type: string; n: string }>(
      'SELECT account_type, count(*)::text AS n FROM pc49.account GROUP BY 1 ORDER BY 1',
    )
    const byType = Object.fromEntries(r.rows.map((x) => [x.account_type, Number(x.n)]))
    expect(byType.EXPENSE).toBe(12)   // nine 632* plus 635, 641, 642
    expect(byType.REVENUE).toBe(3)    // 511, 515, 711
    expect(byType.LIABILITY).toBe(3)  // 331, 333, 334
  })
})

describe('gold flow rules', () => {
  it('lets Scrap Gold out only by internal sale or refining', async () => {
    const r = await db.query<{ txn_type: string }>(
      `SELECT txn_type FROM pc49.gold_flow_rule
        WHERE gold_type_code = 'SG' AND direction = 'OUT' ORDER BY txn_type`,
    )
    expect(r.rows.map((x) => x.txn_type)).toEqual(['SALE', 'TRANSFER_OUT'])
  })

  it('lets Scrap Gold in only by purchase', async () => {
    const r = await db.query<{ txn_type: string }>(
      `SELECT txn_type FROM pc49.gold_flow_rule
        WHERE gold_type_code = 'SG' AND direction = 'IN' ORDER BY txn_type`,
    )
    expect(r.rows.map((x) => x.txn_type)).toEqual(['PO', 'PO_VENDOR'])
  })

  it('lets seven gold types arrive by transfer from Grain', async () => {
    const r = await db.query<{ code: string }>(
      `SELECT gold_type_code AS code FROM pc49.gold_flow_rule
        WHERE direction = 'IN' AND txn_type = 'TRANSFER_IN'
          AND source_gold_type_code = 'GRAIN' ORDER BY gold_type_code`,
    )
    expect(r.rows.map((x) => x.code)).toEqual(['9999', 'AE', 'CS', 'ML', 'OTH', 'PT', 'RP'])
  })

  it('never lets Grain or Scrap Gold be sold to a walk-in customer as a deposit', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_flow_rule
        WHERE gold_type_code IN ('GRAIN', 'SG') AND txn_type IN ('DEPOSIT', 'PICKUP')`,
    )
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

describe('owner capital', () => {
  it('seeds owner capital so opening balances have a counterpart', async () => {
    const r = await db.query<{ code: string; account_type: string }>(
      `SELECT code, account_type::text AS account_type FROM pc49.account WHERE code = '4111'`,
    )
    expect(r.rows).toEqual([{ code: '4111', account_type: 'EQUITY' }])
  })
})
