import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

type Txn = {
  date?: string
  type: string
  gold: string
  uom: 'GRAM' | 'OZ' | 'LUONG'
  qty: number
  price?: number
  amount: number
  partner?: string
  scrap?: string
}

async function addTxn(t: Txn): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, partner_code, scrap_detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [t.date ?? '2026-01-01', t.type, t.gold, t.uom, t.qty, t.price ?? null, t.amount,
     t.partner ?? 'TRANS', t.scrap ?? null],
  )
  return r.rows[0].id
}

describe('the source sign convention', () => {
  it('accepts a purchase as positive quantity and negative amount', async () => {
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 3.9, amount: -384 })
    const r = await db.query<{ qty: string; amount: string }>(
      `SELECT qty::text, amount::text FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    expect(Number(r.rows[0].qty)).toBe(3.9)
    expect(Number(r.rows[0].amount)).toBe(-384)
  })

  it('accepts a sale as negative quantity and positive amount', async () => {
    const id = await addTxn({ type: 'SALE', gold: 'RP', uom: 'LUONG', qty: -1, amount: 5310 })
    const r = await db.query<{ qty: string }>(
      `SELECT qty::text FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    expect(Number(r.rows[0].qty)).toBe(-1)
  })

  it('refuses a purchase recorded with a negative quantity', async () => {
    await expect(
      addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: -3.9, amount: -384 }),
    ).rejects.toThrow(/gold_txn_purchase_sign/)
  })

  it('refuses a sale recorded with a negative amount', async () => {
    await expect(
      addTxn({ type: 'SALE', gold: 'RP', uom: 'LUONG', qty: -1, amount: -5310 }),
    ).rejects.toThrow(/gold_txn_sale_sign/)
  })
})

describe('weight in grams', () => {
  it('derives grams from luong', async () => {
    const id = await addTxn({ type: 'SALE', gold: 'RP', uom: 'LUONG', qty: -1, amount: 5310 })
    const r = await db.query<{ g: string }>(
      `SELECT qty_gram::text AS g FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    expect(Number(r.rows[0].g)).toBe(-37.5)
  })

  it('derives grams from ounces using 31.105', async () => {
    const id = await addTxn({ type: 'SALE', gold: 'CS', uom: 'OZ', qty: -1, amount: 4480 })
    const r = await db.query<{ g: string }>(
      `SELECT qty_gram::text AS g FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    expect(Number(r.rows[0].g)).toBeCloseTo(-31.105, 5)
  })
})

describe('flow rules from the Link sheet', () => {
  it('refuses to sell Scrap Gold as a deposit', async () => {
    await expect(
      addTxn({ type: 'DEPOSIT', gold: 'SG', uom: 'GRAM', qty: -10, amount: 500 }),
    ).rejects.toThrow(/not a valid.*Scrap Gold|flow/i)
  })

  it('refuses to receive Scrap Gold by transfer', async () => {
    await expect(
      addTxn({ type: 'TRANSFER_IN', gold: 'SG', uom: 'GRAM', qty: 10, amount: 0 }),
    ).rejects.toThrow(/not a valid|flow/i)
  })

  // A transfer leg has to belong to a conversion, so these two go through one.
  it('allows Rong Phung to arrive by Ra RP', async () => {
    const c = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_conversion (conv_date, kind) VALUES ('2026-01-03', 'RA_RP') RETURNING id`)
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, amount, conversion_id)
       VALUES ('2026-01-03', 'RA_RP', 'RP', 'LUONG', 1, 0, $1) RETURNING id`, [c.rows[0].id])
    expect(r.rows[0].id).toBeTruthy()
  })

  it('allows Scrap Gold to leave for refining', async () => {
    const c = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_conversion (conv_date, kind)
       VALUES ('2026-01-06', 'REFINING_SEND') RETURNING id`)
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, amount, conversion_id)
       VALUES ('2026-01-06', 'TRANSFER_OUT', 'SG', 'GRAM', -195.09, 0, $1) RETURNING id`,
      [c.rows[0].id])
    expect(r.rows[0].id).toBeTruthy()
  })
})

describe('payments', () => {
  it('records one payment against a purchase', async () => {
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 63.3, amount: -6105 })
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
       VALUES ($1, 1, 'AP', 6105, 'CHECK')`, [id],
    )
    const r = await db.query<{ method: string; amount: string }>(
      `SELECT method::text, amount::text FROM pc49.gold_txn_payment WHERE txn_id = $1`, [id],
    )
    expect(r.rows).toEqual([{ method: 'CHECK', amount: '6105.00' }])
  })

  it('splits one purchase across two methods, as the vendor row of 2025-12-29 does', async () => {
    const id = await addTxn({
      date: '2025-12-29', type: 'PO_VENDOR', gold: 'GRAIN', uom: 'GRAM',
      qty: 1009, price: 138.7512389, amount: -140000, partner: 'CTY1',
    })
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method) VALUES
         ($1, 1, 'AP', 100000, 'CASH'),
         ($1, 2, 'AP',  40000, 'CHECK')`, [id],
    )
    const r = await db.query<{ total: string; n: string }>(
      `SELECT sum(amount)::text AS total, count(*)::text AS n
         FROM pc49.gold_txn_payment WHERE txn_id = $1`, [id],
    )
    expect(Number(r.rows[0].total)).toBe(140000)
    expect(Number(r.rows[0].n)).toBe(2)
  })

  it('refuses a third payment, since the source allows at most two', async () => {
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 1, amount: -100 })
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method) VALUES
         ($1, 1, 'AP', 50, 'CASH'), ($1, 2, 'AP', 50, 'CHECK')`, [id],
    )
    await expect(
      db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                VALUES ($1, 3, 'AP', 10, 'ZELLE')`, [id]),
    ).rejects.toThrow(/gold_txn_payment_seq/)
  })
})
