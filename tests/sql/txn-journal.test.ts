import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite

beforeAll(async () => {
  db = await createTestDb()
  // Prices for 2026-01-01, taken from the Data sheet of GENERAL REPORT.
  await db.exec(`
    INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price, avg_purchase_price)
    VALUES ('2026-01-01', 'RP',    5213,             5213),
           ('2026-01-01', 'GRAIN', 138.83258849628652, 138.8325885),
           ('2026-01-01', 'SG',    49.9988,          49.9988);
  `)
}, 60_000)
afterAll(async () => { await db?.close() })

type Payment = { amount: number; method: 'CASH' | 'BANKWIRE' | 'ZELLE' | 'CHECK' }

async function enter(
  t: { type: string; gold: string; uom: string; qty: number; price?: number; amount: number
       partner: string; sales?: string; scrap?: string; date?: string },
  payments: Payment[],
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount,
        partner_code, sales_person_code, scrap_detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [t.date ?? '2026-01-01', t.type, t.gold, t.uom, t.qty, t.price ?? null, t.amount,
     t.partner, t.sales ?? null, t.scrap ?? null],
  )
  const id = r.rows[0].id
  let seq = 0
  for (const p of payments) {
    seq += 1
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, seq, t.amount >= 0 ? 'AR' : 'AP', p.amount, p.method],
    )
  }
  return id
}

async function post(txnId: string): Promise<string> {
  const r = await db.query<{ id: string }>(`SELECT pc49.post_gold_txn($1) AS id`, [txnId])
  return r.rows[0].id
}

async function linesOf(entryId: string) {
  const r = await db.query<{ dr: string | null; cr: string | null; amount: string; g: string | null }>(
    `SELECT debit_account AS dr, credit_account AS cr, amount_usd::text AS amount,
            qty_gram::text AS g
       FROM pc49.journal_line WHERE entry_id = $1 ORDER BY seq`, [entryId],
  )
  return r.rows
}

describe('a sale becomes revenue, cost and a receipt', () => {
  let entryId: string

  beforeAll(async () => {
    const t = await enter(
      { type: 'SALE', gold: 'RP', uom: 'LUONG', qty: -1, price: 5310, amount: 5310,
        partner: 'CTHUY', sales: 'S.Mai' },
      [{ amount: 5310, method: 'CASH' }],
    )
    entryId = await post(t)
  })

  it('produces three lines', async () => {
    expect(await linesOf(entryId)).toHaveLength(3)
  })

  it('books revenue against the customer', async () => {
    const l = (await linesOf(entryId))[0]
    expect(l.dr).toBe('131')
    expect(l.cr).toBe('511')
    expect(Number(l.amount)).toBe(5310)
    expect(Number(l.g)).toBe(-37.5)
  })

  it('books cost at the day price, per gold type', async () => {
    const l = (await linesOf(entryId))[1]
    expect(l.dr).toBe('632RP')
    expect(l.cr).toBe('156RP')
    expect(Number(l.amount)).toBeCloseTo(5213, 2)
  })

  it('books the receipt into cash, clearing the customer', async () => {
    const l = (await linesOf(entryId))[2]
    expect(l.dr).toBe('1111')
    expect(l.cr).toBe('131')
    expect(Number(l.amount)).toBe(5310)
  })

  it('balances', async () => {
    const r = await db.query<{ b: string }>(`SELECT pc49.entry_balance($1)::text AS b`, [entryId])
    expect(Number(r.rows[0].b)).toBe(0)
  })

  it('refuses to post the same transaction twice', async () => {
    const r = await db.query<{ id: string }>(`SELECT id FROM pc49.gold_txn WHERE partner_code = 'CTHUY'`)
    await expect(post(r.rows[0].id)).rejects.toThrow(/already posted/i)
  })
})

describe('payment method decides the account', () => {
  it('sends a check to the check clearing account, not to a bank', async () => {
    const t = await enter(
      { type: 'PO', gold: 'SG', uom: 'GRAM', qty: 63.3, price: 96.44549763, amount: -6105,
        partner: 'CDEVANS', sales: 'L.Thanh', scrap: '16-18k/grs' },
      [{ amount: 6105, method: 'CHECK' }],
    )
    const e = await post(t)
    const l = (await linesOf(e))[0]
    expect(l.dr).toBe('155SG')
    expect(l.cr).toBe('1121CK')
    expect(Number(l.g)).toBe(63.3)
  })

  it('splits a two-method purchase into two lines', async () => {
    const t = await enter(
      // The source dates this one 2025-12-29, the day before, so it must not
      // land in the 1 January totals.
      { date: '2025-12-29', type: 'PO_VENDOR', gold: 'GRAIN', uom: 'GRAM', qty: 1009,
        price: 138.7512389, amount: -140000, partner: 'CTY1', sales: 'L.Thanh' },
      [{ amount: 100000, method: 'CASH' }, { amount: 40000, method: 'CHECK' }],
    )
    const e = await post(t)
    const lines = await linesOf(e)
    expect(lines).toHaveLength(2)
    expect(lines.map((x) => x.cr)).toEqual(['1111', '1121CK'])
    expect(lines.map((x) => Number(x.amount))).toEqual([100000, 40000])
    // The weight rides on the first line only, so it is not counted twice.
    expect(Number(lines[0].g)).toBe(1009)
    expect(lines[1].g).toBeNull()
  })
})

describe('the five transactions of 1 January 2026', () => {
  const DAY = '2026-01-01'

  beforeAll(async () => {
    // The sale of 1 luong VRP and the scrap purchase from Clifford Dean are
    // already entered by the suites above; add the remaining three.
    const rest = [
      [{ type: 'SALE', gold: 'GRAIN', uom: 'GRAM', qty: -37.5, price: 139.12, amount: 5217,
         partner: 'TRANS', sales: 'L.Thanh' }, [{ amount: 5217, method: 'CASH' as const }]],
      [{ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 3.9, price: 98.46153846, amount: -384,
         partner: 'TRANS', sales: 'L.Thanh', scrap: '16-18k/grs' },
       [{ amount: 384, method: 'CASH' as const }]],
      [{ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 4.5, price: 55.55555556, amount: -250,
         partner: 'HPAREZ', sales: 'P.Minh', scrap: '14k/grs' },
       [{ amount: 250, method: 'CASH' as const }]],
    ] as const

    for (const [t, p] of rest) {
      const id = await enter(t as never, p as never)
      await post(id)
    }
  })

  it('leaves every generated entry balanced', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.journal_entry e
        WHERE e.entry_date = $1 AND pc49.entry_balance(e.id) <> 0`, [DAY],
    )
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('totals 10,527 of sales and 6,739 of purchases, as the Dashboard does', async () => {
    const r = await db.query<{ sales: string; purchases: string }>(
      `SELECT sum(CASE WHEN txn_type IN ('SALE','PICKUP') THEN amount ELSE 0 END)::text AS sales,
              sum(CASE WHEN txn_type IN ('PO','PO_VENDOR') THEN -amount ELSE 0 END)::text AS purchases
         FROM pc49.gold_txn WHERE txn_date = $1 AND voided_at IS NULL`, [DAY],
    )
    expect(Number(r.rows[0].sales)).toBe(10527)
    expect(Number(r.rows[0].purchases)).toBe(6739)
  })

  it('moves the right weight per gold type, counting inventory lines only', async () => {
    const r = await db.query<{ gold: string; g: string }>(
      `SELECT l.gold_type_code AS gold, sum(l.qty_gram)::text AS g
         FROM pc49.journal_line l
         JOIN pc49.journal_entry e ON e.id = l.entry_id
         JOIN pc49.account a ON a.code IN (l.credit_account, l.debit_account)
        WHERE e.entry_date = $1
          AND a.code LIKE ANY (ARRAY['155%','156%','157%'])
          AND l.qty_gram IS NOT NULL
        GROUP BY 1 ORDER BY 1`, [DAY],
    )
    const byGold = Object.fromEntries(r.rows.map((x) => [x.gold, Number(x.g)]))
    expect(byGold.RP).toBeCloseTo(-37.5, 2)
    expect(byGold.GRAIN).toBeCloseTo(-37.5, 2)
    expect(byGold.SG).toBeCloseTo(71.7, 2)
  })

  it('receives 10,527 in cash and pays 634 cash plus 6,105 by check', async () => {
    const r = await db.query<{ acct: string; dr: string; cr: string }>(
      `SELECT a.code AS acct,
              sum(CASE WHEN l.debit_account  = a.code THEN l.amount_usd ELSE 0 END)::text AS dr,
              sum(CASE WHEN l.credit_account = a.code THEN l.amount_usd ELSE 0 END)::text AS cr
         FROM pc49.journal_line l
         JOIN pc49.journal_entry e ON e.id = l.entry_id
         JOIN pc49.account a ON a.code IN (l.debit_account, l.credit_account)
        WHERE e.entry_date = $1 AND a.code IN ('1111', '1121CK')
        GROUP BY 1 ORDER BY 1`, [DAY],
    )
    const byAcct = Object.fromEntries(r.rows.map((x) => [x.acct, { dr: Number(x.dr), cr: Number(x.cr) }]))
    expect(byAcct['1111'].dr).toBe(10527)
    expect(byAcct['1111'].cr).toBe(634)
    expect(byAcct['1121CK'].cr).toBe(6105)
  })
})
