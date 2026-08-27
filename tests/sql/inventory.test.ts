import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price, avg_purchase_price)
    VALUES ('2026-02-01', 'RP', 5213, 5213),
           ('2026-02-01', 'SG', 49.9988, 49.9988);
  `)
}, 60_000)
afterAll(async () => { await db?.close() })

async function bookGram(gold: string, owner = 'PC49'): Promise<number> {
  const r = await db.query<{ g: string }>(
    `SELECT coalesce(sum(qty_gram), 0)::text AS g FROM pc49.v_inventory_book
      WHERE gold_type_code = $1 AND owner_code = $2`, [gold, owner])
  return Number(r.rows[0].g)
}
async function physicalGram(gold: string, owner = 'PC49'): Promise<number> {
  const r = await db.query<{ g: string }>(
    `SELECT coalesce(sum(qty_gram), 0)::text AS g FROM pc49.v_inventory_physical
      WHERE gold_type_code = $1 AND owner_code = $2`, [gold, owner])
  return Number(r.rows[0].g)
}
async function totalGram(gold: string, owner = 'PC49'): Promise<number> {
  const r = await db.query<{ g: string }>(
    `SELECT coalesce(sum(qty_gram), 0)::text AS g FROM pc49.v_inventory_total_asset
      WHERE gold_type_code = $1 AND owner_code = $2`, [gold, owner])
  return Number(r.rows[0].g)
}

describe('the buckets', () => {
  it('shows a purchase in all three views', async () => {
    await db.query(
      `INSERT INTO pc49.inventory_movement
         (move_date, gold_type_code, bucket, qty_gram, source_type)
       VALUES ('2026-02-01', 'SG', 'ON_HAND', 100, 'OPENING')`)
    expect(await bookGram('SG')).toBe(100)
    expect(await physicalGram('SG')).toBe(100)
    expect(await totalGram('SG')).toBe(100)
  })

  it('takes a deposit out of book inventory but leaves it in physical', async () => {
    await db.query(
      `INSERT INTO pc49.inventory_movement
         (move_date, gold_type_code, bucket, qty_gram, source_type)
       VALUES ('2026-02-02', 'SG', 'ON_HAND', -30, 'GOLD_TXN'),
              ('2026-02-02', 'SG', 'DEPOSIT_HELD', 30, 'GOLD_TXN')`)
    expect(await bookGram('SG')).toBe(70)
    expect(await physicalGram('SG')).toBe(100)   // still in the shop
    expect(await totalGram('SG')).toBe(100)
  })

  it('takes refining gold out of book and physical but keeps it in total assets', async () => {
    await db.query(
      `INSERT INTO pc49.inventory_movement
         (move_date, gold_type_code, bucket, qty_gram, source_type)
       VALUES ('2026-02-03', 'SG', 'ON_HAND', -20, 'GOLD_TXN'),
              ('2026-02-03', 'SG', 'AT_REFINERY', 20, 'GOLD_TXN')`)
    expect(await bookGram('SG')).toBe(50)
    expect(await physicalGram('SG')).toBe(80)
    expect(await totalGram('SG')).toBe(100)      // PC49 still owns it
  })

  it('never mixes a pooling partner into the PC49 figure', async () => {
    await db.query(
      `INSERT INTO pc49.inventory_movement
         (move_date, gold_type_code, owner_code, bucket, qty_gram, source_type)
       VALUES ('2026-02-04', 'SG', 'MH', 'AT_REFINERY', 986.31, 'REFINING')`)
    expect(await totalGram('SG')).toBe(100)
    expect(await totalGram('SG', 'MH')).toBeCloseTo(986.31, 2)
  })

  it('leaves the adjustment null while a value is provisional', async () => {
    const r = await db.query<{ adj: string | null }>(
      `SELECT valuation_adjustment::text AS adj FROM pc49.inventory_movement
        WHERE source_type = 'OPENING' LIMIT 1`)
    expect(r.rows[0].adj).toBeNull()
  })

  it('computes the adjustment once a definitive value is set', async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.inventory_movement
         (move_date, gold_type_code, bucket, qty_gram, provisional_value,
          definitive_value, valuation_status, source_type)
       VALUES ('2026-02-05', 'RP', 'ON_HAND', -37.5, 5206.22, 5212.50, 'DEFINITIVE', 'GOLD_TXN')
       RETURNING id`)
    const a = await db.query<{ adj: string }>(
      `SELECT valuation_adjustment::text AS adj FROM pc49.inventory_movement WHERE id = $1`,
      [r.rows[0].id])
    expect(Number(a.rows[0].adj)).toBeCloseTo(6.28, 2)
  })
})

describe('movements generated from a transaction', () => {
  it('adds a posted purchase to book inventory', async () => {
    const before = await bookGram('SG')
    const t = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, partner_code)
       VALUES ('2026-02-01', 'PO', 'SG', 'GRAM', 63.3, 96.44549763, -6105, 'CDEVANS') RETURNING id`)
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
       VALUES ($1, 1, 'AP', 6105, 'CHECK')`, [t.rows[0].id])
    await db.query(`SELECT pc49.post_gold_txn($1)`, [t.rows[0].id])
    expect(await bookGram('SG')).toBeCloseTo(before + 63.3, 2)
  })

  it('does not move stock for a transaction that was never posted', async () => {
    const before = await bookGram('SG')
    await db.query(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount)
       VALUES ('2026-02-01', 'PO', 'SG', 'GRAM', 999, 1, -999)`)
    expect(await bookGram('SG')).toBeCloseTo(before, 2)
  })

  it('carries the day price onto the movement', async () => {
    const r = await db.query<{ cost: string }>(
      `SELECT unit_cost::text AS cost FROM pc49.inventory_movement
        WHERE source_type = 'GOLD_TXN' AND gold_type_code = 'SG'
          AND move_date = '2026-02-01' AND bucket = 'ON_HAND'
        ORDER BY created_at DESC LIMIT 1`)
    expect(Number(r.rows[0].cost)).toBeCloseTo(49.9988, 4)
  })
})

describe('the stock movement report, against the January figures', () => {
  // Opening balances and period movements taken from fixtures/golden-numbers.json,
  // block inventory_nxt_2026_01. Seeding them proves the report COMPUTES
  // correctly; proving PC49's real January transactions add up to these figures
  // is an end-to-end reconciliation and belongs to P9.
  beforeAll(async () => {
    const rows: [string, number, number, number, number, number, number][] = [
      // gold, opening gram, opening value, receipt gram, receipt value, issue gram, issue value
      ['GRAIN', 1088.54, 16266.32, 197,    27280,  -431.85, 0],
      ['SG',     234.78, 23518.88, 805.55, 69084,  -907.89, 45393.41053],
    ]
    for (const [gold, oGram, oValue, rGram, rValue, iGram, iValue] of rows) {
      await db.query(
        `INSERT INTO pc49.inventory_movement
           (move_date, gold_type_code, owner_code, bucket, qty_gram, provisional_value, source_type)
         VALUES ('2025-12-31', $1, 'JAN', 'ON_HAND', $2, $3, 'OPENING'),
                ('2026-01-10', $1, 'JAN', 'ON_HAND', $4, $5, 'GOLD_TXN'),
                ('2026-01-20', $1, 'JAN', 'ON_HAND', $6, $7, 'GOLD_TXN')`,
        [gold, oGram, oValue, rGram, rValue, iGram, iValue])
    }
    // The adjustment column of the NXT sheet, recorded against the issue.
    for (const [gold, adjustment] of [['GRAIN', -14628.46609], ['SG', 35420.58957]] as const) {
      await db.query(
        `UPDATE pc49.inventory_movement
            SET definitive_value = provisional_value + $2::numeric,
                valuation_status = 'DEFINITIVE'
          WHERE owner_code = 'JAN' AND gold_type_code = $1 AND move_date = '2026-01-20'`,
        [gold, adjustment])
    }
  })

  it('closes Grain at 58,174.79', async () => {
    const r = await db.query<{ closing: string; adj: string }>(
      `SELECT closing_value::text AS closing, adjustment::text AS adj
         FROM pc49.stock_movement_report('2026-01', 'JAN') WHERE gold_type_code = 'GRAIN'`)
    expect(Number(r.rows[0].adj)).toBeCloseTo(-14628.47, 2)
    expect(Number(r.rows[0].closing)).toBeCloseTo(58174.79, 2)
  })

  it('closes Scrap Gold at 11,788.88', async () => {
    const r = await db.query<{ closing: string; adj: string }>(
      `SELECT closing_value::text AS closing, adjustment::text AS adj
         FROM pc49.stock_movement_report('2026-01', 'JAN') WHERE gold_type_code = 'SG'`)
    expect(Number(r.rows[0].adj)).toBeCloseTo(35420.59, 2)
    expect(Number(r.rows[0].closing)).toBeCloseTo(11788.88, 2)
  })

  it('closes Grain at 1,717.39 grams and Scrap Gold at 132.44', async () => {
    const r = await db.query<{ gold: string; g: string }>(
      `SELECT gold_type_code AS gold, closing_gram::text AS g
         FROM pc49.stock_movement_report('2026-01', 'JAN')
        WHERE gold_type_code IN ('GRAIN', 'SG')`)
    const byGold = Object.fromEntries(r.rows.map((x) => [x.gold, Number(x.g)]))
    expect(byGold.GRAIN).toBeCloseTo(853.69, 2)   // 1088.54 + 197 - 431.85
    expect(byGold.SG).toBeCloseTo(132.44, 2)      // 234.78 + 805.55 - 907.89
  })

  it('shows the adjustment as its own column, not folded into cost', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.columns
        WHERE table_schema = 'pc49' AND table_name = 'v_stock_period_movement'
          AND column_name = 'adjustment'`)
    expect(Number(r.rows[0].n)).toBe(1)
  })
})
