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
  who?: string
}

async function addTxn(t: Txn): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, partner_code,
        scrap_detail, sales_person_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [t.date ?? '2026-01-01', t.type, t.gold, t.uom, t.qty, t.price ?? null, t.amount,
     t.partner ?? 'TRANS', t.scrap ?? null, t.who ?? null],
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

  it('takes a third payment, and a fourth', async () => {
    // The table used to refuse these: `CHECK (seq IN (1, 2))`, copied from a
    // spreadsheet that had Amount-1st and Amount-2nd and no third column. An
    // accountant met the limit at the counter with a customer settling one
    // order three ways, and the third went into the remarks as prose.
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 1, amount: -100 })
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method) VALUES
         ($1, 1, 'AP', 40, 'CASH'), ($1, 2, 'AP', 30, 'CHECK'),
         ($1, 3, 'AP', 20, 'ZELLE'), ($1, 4, 'AP', 10, 'BANKWIRE')`, [id],
    )
    const r = await db.query<{ total: string; n: string }>(
      `SELECT sum(amount)::text AS total, count(*)::text AS n
         FROM pc49.gold_txn_payment WHERE txn_id = $1`, [id],
    )
    expect(Number(r.rows[0].n)).toBe(4)
    expect(Number(r.rows[0].total)).toBe(100)
  })

  it('still refuses a payment with no place in the order they were taken', async () => {
    // Dropping the ceiling is not dropping the sequence. It says which payment
    // came first, and the ledger writes its lines in that order.
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 1, amount: -100 })
    await expect(
      db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                VALUES ($1, 0, 'AP', 100, 'CASH')`, [id]),
    ).rejects.toThrow(/gold_txn_payment_seq/)
  })

  it('still refuses two payments in the same place in the order', async () => {
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 1, amount: -100 })
    await db.query(
      `INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
       VALUES ($1, 1, 'AP', 50, 'CASH')`, [id],
    )
    await expect(
      db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                VALUES ($1, 1, 'AP', 50, 'CHECK')`, [id]),
    ).rejects.toThrow()
  })
})

describe('the unit a row is measured in', () => {
  // Every gold type names the unit it trades in, and `gold_price_daily` holds
  // the price per that unit. Valuation multiplies the two, so a row in any
  // other unit is priced against a number that means something else — and it
  // balances, and it reports, and nobody is told.
  //
  // The screen cannot get this wrong; it takes the unit from the type. The
  // importer could, and did: a blank unit column made every row grams, which
  // for Rong Phung is a luong priced as a gram.
  it('has to be the one that gold type is traded in', async () => {
    await expect(
      db.query(
        `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
         VALUES ('2026-01-01', 'PO', 'RP', 'GRAM', 1, -139)`),
    ).rejects.toThrow(/traded in LUONG but this row is in GRAM/)
  })

  it('accepts the type\'s own unit', async () => {
    await expect(
      db.query(
        `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
         VALUES ('2026-01-01', 'PO', 'RP', 'LUONG', 1, -5213)`),
    ).resolves.toBeTruthy()
    await expect(
      db.query(
        `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
         VALUES ('2026-01-01', 'PO', 'SG', 'GRAM', 40, -2000)`),
    ).resolves.toBeTruthy()
  })

  it('refuses an ounce type written in grams', async () => {
    // The direction that bites hardest: an ounce is 31.105 grams, so a coin
    // entered in grams is valued at thirty-one times its weight.
    await expect(
      db.query(
        `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
         VALUES ('2026-01-01', 'PO', 'AE', 'GRAM', 31.105, -2400)`),
    ).rejects.toThrow(/traded in OZ but this row is in GRAM/)
  })

  it('will not let an existing row be moved to another unit', async () => {
    const r = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
       VALUES ('2026-01-02', 'PO', 'SG', 'GRAM', 10, -500) RETURNING id`)
    await expect(
      db.query(`UPDATE pc49.gold_txn SET uom = 'LUONG' WHERE id = $1`, [r.rows[0].id]),
    ).rejects.toThrow(/traded in GRAM but this row is in LUONG/)
  })
})

describe('purity as a number', () => {
  it('takes a fraction beside the note', async () => {
    const id = await addTxn({
      type: 'PO', gold: 'SG', uom: 'GRAM', qty: 10, amount: -500, scrap: '14k/grs',
    })
    await db.query(`UPDATE pc49.gold_txn SET gold_pct = 0.583 WHERE id = $1`, [id])
    const r = await db.query<{ p: string; d: string }>(
      `SELECT gold_pct::text AS p, scrap_detail AS d FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    // The prose and the number say the same thing, and only one of them adds up.
    expect(Number(r.rows[0].p)).toBeCloseTo(0.583, 4)
    expect(r.rows[0].d).toBe('14k/grs')
  })

  it('refuses purity written the way it is spoken', async () => {
    // 58.3 is how everybody says it and a hundredfold error if it is stored.
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 10, amount: -500 })
    await expect(
      db.query(`UPDATE pc49.gold_txn SET gold_pct = 58.3 WHERE id = $1`, [id]),
    ).rejects.toThrow(/purity_is_a_fraction/)
  })

  it('leaves purity alone when nobody recorded it', async () => {
    const id = await addTxn({ type: 'PO', gold: 'SG', uom: 'GRAM', qty: 10, amount: -500 })
    const r = await db.query<{ p: string | null }>(
      `SELECT gold_pct::text AS p FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    expect(r.rows[0].p).toBeNull()
  })
})

describe('more than one person on an order', () => {
  it('gives a row written with one name a share of the whole', async () => {
    const id = await addTxn({
      type: 'PO', gold: 'SG', uom: 'GRAM', qty: 10, amount: -500, who: 'L.Thanh',
    })
    const r = await db.query<{ code: string; pct: string }>(
      `SELECT sales_person_code AS code, share_pct::text AS pct
         FROM pc49.gold_txn_sales_person WHERE txn_id = $1`, [id],
    )
    expect(r.rows).toEqual([{ code: 'L.Thanh', pct: '100.00' }])
  })

  it('splits one order between two people', async () => {
    const id = await addTxn({ type: 'SALE', gold: 'SG', uom: 'GRAM', qty: -10, amount: 500 })
    await db.query(
      `INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct) VALUES
         ($1, 'L.Thanh', 60), ($1, 'P.Minh', 40)`, [id],
    )
    const r = await db.query<{ n: string; total: string }>(
      `SELECT count(*)::text AS n, sum(share_pct)::text AS total
         FROM pc49.gold_txn_sales_person WHERE txn_id = $1`, [id],
    )
    expect(Number(r.rows[0].n)).toBe(2)
    expect(Number(r.rows[0].total)).toBe(100)
  })

  it('refuses shares that do not come to a hundred', async () => {
    const id = await addTxn({ type: 'SALE', gold: 'SG', uom: 'GRAM', qty: -10, amount: 500 })
    await expect(
      db.query(
        `INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct) VALUES
           ($1, 'L.Thanh', 60), ($1, 'P.Minh', 30)`, [id]),
    ).rejects.toThrow(/come to 100 percent/)
  })

  it('refuses a split written as fractions, because it does not add up', async () => {
    // The unit cannot be mistaken the way purity's could: 0.6 and 0.4 come to
    // one, not a hundred, so the wrong unit is refused rather than stored.
    const id = await addTxn({ type: 'SALE', gold: 'SG', uom: 'GRAM', qty: -10, amount: 500 })
    await expect(
      db.query(
        `INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct) VALUES
           ($1, 'L.Thanh', 0.6), ($1, 'P.Minh', 0.4)`, [id]),
    ).rejects.toThrow(/come to 100 percent/)
  })

  it('writes the leading name back into the column a reader expects', async () => {
    const id = await addTxn({ type: 'SALE', gold: 'SG', uom: 'GRAM', qty: -10, amount: 500 })
    await db.query(
      `INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct) VALUES
         ($1, 'P.Minh', 30), ($1, 'L.Thanh', 70)`, [id],
    )
    const r = await db.query<{ code: string }>(
      `SELECT sales_person_code AS code FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    // Largest share, not whichever row happened to be written first.
    expect(r.rows[0].code).toBe('L.Thanh')
  })

  it('lets the last share be removed, for a name typed by mistake', async () => {
    const id = await addTxn({
      type: 'PO', gold: 'SG', uom: 'GRAM', qty: 10, amount: -500, who: 'S.Mai',
    })
    await db.query(`DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1`, [id])
    const r = await db.query<{ code: string | null }>(
      `SELECT sales_person_code AS code FROM pc49.gold_txn WHERE id = $1`, [id],
    )
    expect(r.rows[0].code).toBeNull()
  })
})
