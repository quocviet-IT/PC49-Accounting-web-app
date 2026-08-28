import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

/** Records a transaction and posts it, the way the entry grid does. */
async function sell(date: string, gold: string, uom: string, qty: number, amount: number) {
  const t = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount)
     VALUES ($1, 'SALE', $2, $3, $4, $5, $6) RETURNING id`,
    [date, gold, uom, -qty, amount / qty, amount])
  await db.query(
    `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, method, amount)
     VALUES ($1, 1, 'AR', 'CASH', $2)`, [t.rows[0].id, amount])
  await db.query(`SELECT pc49.post_gold_txn($1)`, [t.rows[0].id])
  return t.rows[0].id
}

describe("the day's price grid", () => {
  beforeAll(async () => {
    await db.exec(`
      INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price, avg_purchase_price)
      VALUES ('2026-02-10', 'GRAIN', 139.20, 138.40)`)
    await sell('2026-02-10', 'GRAIN', 'GRAM', 44, 6120)
    await sell('2026-02-10', 'SG', 'GRAM', 10, 1000)
  })

  async function row(code: string) {
    const r = await db.query<Record<string, string | null>>(
      `SELECT market_price::text, avg_purchase_price::text, variance::text,
              traded_qty::text, sold_qty::text
         FROM pc49.price_grid('2026-02-10') WHERE gold_type_code = $1`, [code])
    return r.rows[0]
  }

  it('lists every active gold type, priced or not', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.price_grid('2026-02-10')`)
    expect(Number(r.rows[0].n)).toBe(9)
  })

  it('carries the price that was set, and the variance it implies', async () => {
    const g = await row('GRAIN')
    expect(Number(g.market_price)).toBeCloseTo(139.2, 2)
    expect(Number(g.avg_purchase_price)).toBeCloseTo(138.4, 2)
    expect(Number(g.variance)).toBeCloseTo(0.8, 2)
  })

  it('leaves the price empty rather than guessing at zero', async () => {
    // Zero is a price. Nothing is not. Showing 0.00 for an unset price would
    // read as "gold worth nothing today" on a screen full of real figures.
    const s = await row('SG')
    expect(s.market_price).toBeNull()
    expect(s.avg_purchase_price).toBeNull()
  })

  it('says how much of each type actually moved that day', async () => {
    expect(Number((await row('GRAIN')).traded_qty)).toBeCloseTo(44, 2)
    expect(Number((await row('SG')).traded_qty)).toBeCloseTo(10, 2)
    expect(Number((await row('PT')).traded_qty)).toBe(0)
  })

  it('separates what was sold, because only a sale needs a cost', async () => {
    expect(Number((await row('GRAIN')).sold_qty)).toBeCloseTo(44, 2)
    expect(Number((await row('PT')).sold_qty)).toBe(0)
  })

  it('shows nothing traded on a quiet day', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.price_grid('2026-02-11') WHERE traded_qty > 0`)
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

describe('a sale posted on a day with no price', () => {
  it('is posted, because refusing would send the accountant back to Excel', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn
        WHERE txn_date = '2026-02-10' AND gold_type_code = 'SG'
          AND journal_entry_id IS NOT NULL`)
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('carries revenue and no cost, and the entry still balances', async () => {
    const r = await db.query<{ id: string }>(
      `SELECT journal_entry_id AS id FROM pc49.gold_txn
        WHERE txn_date = '2026-02-10' AND gold_type_code = 'SG'`)
    const cost = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.journal_line
        WHERE entry_id = $1 AND cogs_unit IS NOT NULL`, [r.rows[0].id])
    expect(Number(cost.rows[0].n)).toBe(0)

    // This is why nothing complains: a revenue line balances itself, so an
    // entry missing its cost line is still a balanced entry.
    const balance = await db.query<{ b: string }>(
      `SELECT pc49.entry_balance($1)::text AS b`, [r.rows[0].id])
    expect(Number(balance.rows[0].b)).toBe(0)
  })

  it('is surfaced by name, date and amount rather than left to be discovered', async () => {
    const r = await db.query<{ gold: string; period: string; amount: string }>(
      `SELECT gold_type_code AS gold, period, amount::text
         FROM pc49.v_sale_without_cost ORDER BY txn_date`)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].gold).toBe('SG')
    expect(r.rows[0].period).toBe('2026-02')
    expect(Number(r.rows[0].amount)).toBeCloseTo(1000, 2)
  })

  it('counts what each day is missing, which is what the screen warns with', async () => {
    const r = await db.query<{ sales: string; revenue: string }>(
      `SELECT sales::text, revenue::text FROM pc49.v_uncosted_by_day
        WHERE txn_date = '2026-02-10' AND gold_type_code = 'SG'`)
    expect(Number(r.rows[0].sales)).toBe(1)
    expect(Number(r.rows[0].revenue)).toBeCloseTo(1000, 2)
  })

  it('leaves the priced sale alone', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_sale_without_cost
        WHERE gold_type_code = 'GRAIN'`)
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('stops reporting a sale once it has been voided', async () => {
    // March, not February: the gross-profit assertion below reads February, and
    // a fixture dropped into the period another test is asserting on shifts it
    // by exactly the amount of the fixture.
    const t = await sell('2026-03-12', 'PT', 'GRAM', 5, 900)
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_sale_without_cost WHERE txn_id = $1`, [t])
    expect(Number(before.rows[0].n)).toBe(1)

    // Through the function, not the column: setting `voided_at` by hand is now
    // refused, because a hand-written void leaves the posting standing.
    await db.query(`SELECT pc49.void_gold_txn($1, 'test')`, [t])
    const after = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_sale_without_cost WHERE txn_id = $1`, [t])
    expect(Number(after.rows[0].n)).toBe(0)
  })

  it('overstates the gross profit by exactly the cost that is missing', async () => {
    // The reason this matters, stated as a number rather than a worry: February
    // shows 7,120 of revenue against 6,089.60 of cost, so 1,030.40 of gross
    // profit, of which the whole 1,000 sale of scrap gold contributed no cost.
    const pl = await db.query<{ code: string; amount: string }>(
      `SELECT code, amount::text FROM pc49.pl_report('2026-02')
        WHERE code IN ('REV_TOTAL', 'COGS_TOTAL', 'GROSS_PROFIT')`)
    const by = Object.fromEntries(pl.rows.map((r) => [r.code, Number(r.amount)]))
    expect(by.REV_TOTAL).toBeCloseTo(7120, 2)
    expect(by.COGS_TOTAL).toBeCloseTo(6089.6, 2)
    expect(by.GROSS_PROFIT).toBeCloseTo(1030.4, 2)
  })
})
