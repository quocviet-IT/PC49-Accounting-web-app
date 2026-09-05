import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'

let db: PGlite
const KT = '11111111-1111-1111-1111-111111111111'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'kt@pc49.test');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
    INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
      VALUES ('2026-06-01', 'SG', 60.00)
      ON CONFLICT (price_date, gold_type_code) DO NOTHING;
  `)
}, 60_000)

afterAll(async () => { await db?.close() })

/** The shape the screen sends: a purchase of scrap, settled and staffed. */
function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    txnDate: '2026-06-01',
    txnType: 'PO',
    goldTypeCode: 'SG',
    uom: 'GRAM',
    qty: 10,
    unitPrice: 50,
    amount: -500,
    partnerCode: 'A CUSTOMER',
    scrapDetail: '14k/grs',
    goldPct: 0.583,
    remarks: 'mua vao',
    payments: [{ amount: 500, method: 'CASH' }],
    salesPeople: [{ code: 'L.Thanh', sharePct: 100 }],
    ...over,
  })
}

async function save(key: string, body = payload()) {
  return asRole(db, KT, () =>
    db.query<{ r: Record<string, unknown> }>(
      `SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`, [key, body]))
}

describe('one save is one transaction', () => {
  it('writes the row, the payments, the staff and the journal together', async () => {
    const r = await save('key-whole')
    const txnId = (r.rows[0].r as { txnId: string }).txnId
    expect(txnId).toBeTruthy()

    const counted = await db.query<{ pay: string; who: string; entry: string | null }>(
      `SELECT (SELECT count(*)::text FROM pc49.gold_txn_payment WHERE txn_id = $1) AS pay,
              (SELECT count(*)::text FROM pc49.gold_txn_sales_person WHERE txn_id = $1) AS who,
              (SELECT journal_entry_id::text FROM pc49.gold_txn WHERE id = $1) AS entry`,
      [txnId])
    expect(Number(counted.rows[0].pay)).toBe(1)
    expect(Number(counted.rows[0].who)).toBe(1)
    expect(counted.rows[0].entry).toBeTruthy()
  })

  it('leaves nothing behind when the payment is impossible', async () => {
    // A method the enum does not know: the failure lands after the transaction
    // row has been inserted, which is exactly the half-written state the five
    // separate requests used to leave on the books.
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn`)
    await expect(
      save('key-bad-payment', payload({ payments: [{ amount: 500, method: 'CARRIER PIGEON' }] })),
    ).rejects.toThrow()
    const after = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('leaves nothing behind when the shares do not add up', async () => {
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn`)
    await expect(save('key-bad-share', payload({
      salesPeople: [{ code: 'L.Thanh', sharePct: 60 }, { code: 'P.Minh', sharePct: 30 }],
    }))).rejects.toThrow(/come to 100 percent/)
    const after = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('leaves nothing behind when the movement is one the Link sheet forbids', async () => {
    // The flow-rule trigger fires on insert, so this one fails at the very
    // first statement — the other end of the same guarantee.
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn`)
    await expect(save('key-bad-flow', payload({
      txnType: 'DEPOSIT', qty: -10, unitPrice: 50, amount: 500,
    }))).rejects.toThrow()
    const after = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn`)
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })
})

describe('the amount is the database’s to decide', () => {
  it('works it out from the quantity and the price', async () => {
    const r = await save('key-amount', payload({ amount: null }))
    expect(Number((r.rows[0].r as { amount: number }).amount)).toBe(-500)
  })

  it('refuses a figure that does not follow from them', async () => {
    // A screen that can choose the number reaching the ledger is a screen that
    // can be made to choose a different one. Refused rather than corrected, so
    // that a real disagreement is visible instead of silently resolved.
    await expect(save('key-amount-wrong', payload({ amount: -50 })))
      .rejects.toThrow(/is not what the quantity and price come to/)
  })

  it('takes the amount as given when there is no price to derive it from', async () => {
    // A purchase without a unit price, which is what the old workbooks carry:
    // an amount and nothing to recompute it from. MEMO would have been a
    // tidier name for it and Scrap Gold has no flow rule for one.
    const r = await save('key-no-price', payload({
      unitPrice: null, amount: -123.45, qty: 5,
      payments: [{ amount: 123.45, method: 'CASH' }],
    }))
    expect(Number((r.rows[0].r as { amount: number }).amount)).toBe(-123.45)
  })
})

describe('asking twice', () => {
  it('gives back the first answer instead of writing a second transaction', async () => {
    const first = await save('key-retry')
    const again = await save('key-retry')
    const a = first.rows[0].r as { txnId: string }
    const b = again.rows[0].r as { txnId: string; repeated: boolean }
    expect(b.txnId).toBe(a.txnId)
    expect(b.repeated).toBe(true)

    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn WHERE id = $1`, [a.txnId])
    expect(Number(n.rows[0].n)).toBe(1)
  })

  it('refuses the same key carrying different data', async () => {
    // Not a retry. Either a bug or a key that was reused, and both are worth
    // hearing about rather than guessing at.
    await expect(save('key-retry', payload({ qty: 20, amount: -1000 })))
      .rejects.toThrow(/REQUEST_KEY_REUSED/)
  })

  it('keeps one person’s keys clear of another’s', async () => {
    const other = '22222222-2222-2222-2222-222222222222'
    await db.exec(`
      INSERT INTO auth.users (id, email) VALUES ('${other}', 'other@pc49.test');
      INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${other}', 'Nguoi khac', 'KT');
    `)
    const r = await asRole(db, other, () =>
      db.query<{ r: { txnId: string } }>(
        `SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`, ['key-retry', payload()]))
    expect(r.rows[0].r.txnId).toBeTruthy()
  })

  it('refuses to save without a key at all', async () => {
    await expect(save('   ')).rejects.toThrow(/needs a request key/)
  })
})
