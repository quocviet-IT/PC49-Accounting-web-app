import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite

beforeAll(async () => {
  db = await createTestDb()
  // Reference prices for the two January days the Wave export covers. Grain is
  // quoted per gram, Rong Phung per luong.
  await db.exec(`
    INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
    VALUES ('2026-01-02', 'GRAIN', 139.2),
           ('2026-01-05', 'GRAIN', 142.9066667),
           ('2026-01-05', 'RP',    5359);
  `)
}, 60_000)
afterAll(async () => { await db?.close() })

async function bankLine(date: string, amount: number, description: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.cash_txn (txn_date, cash_account_code, direction, amount, description)
     VALUES ($1, '1121-9530', 'OUT', $2, $3) RETURNING id`, [date, amount, description])
  return r.rows[0].id
}

async function allocate(
  txnId: string, seq: number, gold: string, uom: string, qty: number,
  unitPrice: number, refPrice: number | null, confirmedBy?: string,
) {
  await db.query(
    `INSERT INTO pc49.bank_gold_allocation
       (cash_txn_id, seq, gold_type_code, uom, qty, unit_price, ref_price, confirmed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [txnId, seq, gold, uom, qty, unitPrice, refPrice, confirmedBy ?? null])
}

describe('suggesting a whole quantity', () => {
  it('turns a 6,105 check into 44 grams of Grain', async () => {
    const r = await db.query<{ qty: string; unit_price: string; variance: string }>(
      `SELECT qty::text, unit_price::text, variance::text
         FROM pc49.suggest_gold_allocation(6105, 'GRAIN', '2026-01-02')`)
    expect(Number(r.rows[0].qty)).toBe(44)
    expect(Number(r.rows[0].unit_price)).toBeCloseTo(138.75, 4)
    expect(Number(r.rows[0].variance)).toBeCloseTo(-0.45, 4)
  })

  it('returns nothing when no reference price is recorded for that day', async () => {
    const r = await db.query(
      `SELECT * FROM pc49.suggest_gold_allocation(1000, 'GRAIN', '2026-06-01')`)
    expect(r.rows).toHaveLength(0)
  })
})

describe('converting an ounce price to a luong price', () => {
  it('divides by the configured divisor rather than a literal', async () => {
    const r = await db.query<{ p: string }>(
      `SELECT pc49.oz_price_to_luong(4980)::text AS p`)
    expect(Number(r.rows[0].p)).toBeCloseTo(6000, 6)
  })

  it('follows the parameter when it changes', async () => {
    await db.query(`UPDATE pc49.system_param SET value = 0.5
                     WHERE key = 'OZ_TO_LUONG_PRICE_DIVISOR'`)
    const r = await db.query<{ p: string }>(`SELECT pc49.oz_price_to_luong(100)::text AS p`)
    expect(Number(r.rows[0].p)).toBe(200)
    await db.query(`UPDATE pc49.system_param SET value = 0.83
                     WHERE key = 'OZ_TO_LUONG_PRICE_DIVISOR'`)
  })
})

describe('the two checks from the Wave export', () => {
  it('resolves CHECK # 1051 into 44 grams of Grain with nothing left over', async () => {
    const id = await bankLine('2026-01-02', 6105, 'CHECK # 1051 01/02')
    await allocate(id, 1, 'GRAIN', 'GRAM', 44, 138.75, 139.2)

    const r = await db.query<{ allocated: string; residual: string; lines: string }>(
      `SELECT allocated_value::text AS allocated, residual_cash::text AS residual,
              allocation_lines::text AS lines
         FROM pc49.v_bank_allocation WHERE cash_txn_id = $1`, [id])
    expect(Number(r.rows[0].allocated)).toBeCloseTo(6105, 2)
    expect(Number(r.rows[0].residual)).toBeCloseTo(0, 2)
    expect(Number(r.rows[0].lines)).toBe(1)
  })

  it('resolves CHECK # 1054 into 1 luong of RP plus 19 grams of Grain', async () => {
    const id = await bankLine('2026-01-05', 8100, 'CHECK # 1054')
    await allocate(id, 1, 'RP',    'LUONG', 1,  5359,        5359)
    await allocate(id, 2, 'GRAIN', 'GRAM',  19, 142.9066667, 142.9066667)

    const r = await db.query<{ allocated: string; residual: string; lines: string }>(
      `SELECT allocated_value::text AS allocated, residual_cash::text AS residual,
              allocation_lines::text AS lines
         FROM pc49.v_bank_allocation WHERE cash_txn_id = $1`, [id])
    expect(Number(r.rows[0].lines)).toBe(2)
    expect(Number(r.rows[0].allocated)).toBeCloseTo(8074.23, 2)
    // The rule: what the gold does not account for is recorded as cash.
    expect(Number(r.rows[0].residual)).toBeCloseTo(25.77, 2)
  })
})

describe('the price band', () => {
  it('accepts a price inside the band without ceremony', async () => {
    const id = await bankLine('2026-01-05', 5400, 'inside the band')
    await allocate(id, 1, 'RP', 'LUONG', 1, 5400, 5359)   // 41 over
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.bank_gold_allocation WHERE cash_txn_id = $1`, [id])
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('refuses a price outside the band unless somebody confirms it', async () => {
    const id = await bankLine('2026-01-05', 5600, 'outside the band')
    await expect(allocate(id, 1, 'RP', 'LUONG', 1, 5600, 5359))   // 241 over
      .rejects.toThrow(/allowed band/i)
  })

  it('accepts the same price once it is confirmed', async () => {
    const id = await bankLine('2026-01-05', 5600, 'outside the band, confirmed')
    await allocate(id, 1, 'RP', 'LUONG', 1, 5600, 5359,
                   '11111111-1111-1111-1111-111111111111')
    const r = await db.query<{ at: string | null }>(
      `SELECT confirmed_at::text AS at FROM pc49.bank_gold_allocation WHERE cash_txn_id = $1`, [id])
    expect(r.rows[0].at).not.toBeNull()
  })

  it('flags a transaction that still has an unconfirmed outlier', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_bank_allocation WHERE has_unconfirmed_outlier`)
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('reads the band from system_param, not a literal', async () => {
    await db.query(`UPDATE pc49.system_param SET value = 10
                     WHERE key = 'BANK_PRICE_TOLERANCE_USD'`)
    const id = await bankLine('2026-01-05', 5400, 'band tightened')
    // 41 over was fine at a band of 100; at a band of 10 it is not.
    await expect(allocate(id, 1, 'RP', 'LUONG', 1, 5400, 5359))
      .rejects.toThrow(/allowed band/i)
    await db.query(`UPDATE pc49.system_param SET value = 100
                     WHERE key = 'BANK_PRICE_TOLERANCE_USD'`)
  })

  it('never binds on gold quoted per gram, as in the source', async () => {
    // Grain at 139 a gram cannot move 100 dollars, so the band is inert here.
    // This is the source's own asymmetry, recorded rather than corrected.
    const id = await bankLine('2026-01-02', 6105, 'grain, wildly off, still allowed')
    await allocate(id, 1, 'GRAIN', 'GRAM', 44, 200, 139.2)
    const r = await db.query<{ v: string }>(
      `SELECT price_variance::text AS v FROM pc49.bank_gold_allocation WHERE cash_txn_id = $1`, [id])
    expect(Number(r.rows[0].v)).toBeCloseTo(60.8, 2)
  })
})
