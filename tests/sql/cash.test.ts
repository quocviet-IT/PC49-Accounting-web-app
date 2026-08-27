import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function newBatch(name = 'rocket-2026-05.csv'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.bank_import_batch (file_name) VALUES ($1) RETURNING id`, [name])
  return r.rows[0].id
}

async function importLine(
  batch: string, accountNo: string | null, accountName: string | null,
  date: string, rawAmount: number, description: string, category?: string,
) {
  const r = await db.query<{ id: string | null }>(
    `SELECT pc49.import_bank_line($1, $2, $3, $4::date, $5::numeric, $6, $7) AS id`,
    [batch, accountNo, accountName, date, rawAmount, description, category ?? null])
  return r.rows[0].id
}

describe('the accounts', () => {
  it('seeds the four real PC49 accounts and the three clearing accounts', async () => {
    const r = await db.query<{ code: string; t: string }>(
      `SELECT code, account_type::text AS t FROM pc49.cash_account ORDER BY sort_order`)
    expect(r.rows.map((x) => x.code)).toEqual(
      ['1111', '1121-3388', '1121-9530', '1121-6086', '1121ZL', '1121BW', '1121CK'])
    expect(r.rows.filter((x) => x.t === 'CLEARING')).toHaveLength(3)
  })

  it('ties every cash account to a chart of accounts code', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.cash_account c
        WHERE NOT EXISTS (SELECT 1 FROM pc49.account a WHERE a.code = c.code)`)
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

// These exercise the May 2026 statement, deliberately outside the January
// period the balance suite below asserts against.
describe("Rocket's inverted sign", () => {
  let batch: string
  beforeAll(async () => { batch = await newBatch() })

  // If anyone ever "corrects" the inversion, these two fail. That is the point.
  it('treats a negative amount as money coming in', async () => {
    const id = await importLine(batch, '6086', 'USD account', '2026-05-01', -6.81,
                                'Interest (Received)', 'Income')
    const r = await db.query<{ dir: string; amt: string }>(
      `SELECT direction::text AS dir, amount::text AS amt FROM pc49.cash_txn WHERE id = $1`, [id])
    expect(r.rows[0].dir).toBe('IN')
    expect(Number(r.rows[0].amt)).toBe(6.81)
  })

  it('treats a positive amount as money going out', async () => {
    const id = await importLine(batch, '9530', 'PERFBUS CHK', '2026-05-02', 32.5,
                                'SERVICE CHARGES FOR THE MONTH OF APRIL', 'Fees')
    const r = await db.query<{ dir: string; amt: string }>(
      `SELECT direction::text AS dir, amount::text AS amt FROM pc49.cash_txn WHERE id = $1`, [id])
    expect(r.rows[0].dir).toBe('OUT')
    expect(Number(r.rows[0].amt)).toBe(32.5)
  })

  it('always stores the amount positive, so no query has to remember the convention', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.cash_txn WHERE amount < 0`)
    expect(Number(r.rows[0].n)).toBe(0)
  })
})

describe('lines that match no account', () => {
  it('sends an unmapped account to the review queue instead of dropping it', async () => {
    const batch = await newBatch('unmapped.csv')
    const id = await importLine(batch, '4500', 'TFJ CIT CK', '2026-05-05', -100, 'a payment')
    expect(id).toBeNull()

    const q = await db.query<{ reason: string; amt: string }>(
      `SELECT reason, raw_amount::text AS amt FROM pc49.bank_import_row WHERE batch_id = $1`,
      [batch])
    expect(q.rows).toHaveLength(1)
    expect(q.rows[0].reason).toMatch(/4500/)
    expect(Number(q.rows[0].amt)).toBe(-100)
  })

  it('keeps a line with no account number at all', async () => {
    const batch = await newBatch('blank-account.csv')
    // The MATCHING sheet records exactly this: "Account information missing".
    const id = await importLine(batch, null, null, '2026-05-06', -50, 'blank account number')
    expect(id).toBeNull()
    const q = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.bank_import_row WHERE batch_id = $1`, [batch])
    expect(Number(q.rows[0].n)).toBe(1)
  })

  it('counts matched and unmatched separately on the batch', async () => {
    const batch = await newBatch('mixed.csv')
    await importLine(batch, '3388', 'Business Adv Relationship', '2026-05-08', -64972.42, 'WIRE IN')
    await importLine(batch, '9999', 'Unknown', '2026-05-08', 100, 'mystery')
    const r = await db.query<{ total: string; ok: string; bad: string }>(
      `SELECT row_count::text AS total, matched_count::text AS ok, unmatched_count::text AS bad
         FROM pc49.bank_import_batch WHERE id = $1`, [batch])
    expect(Number(r.rows[0].total)).toBe(2)
    expect(Number(r.rows[0].ok)).toBe(1)
    expect(Number(r.rows[0].bad)).toBe(1)
  })
})

describe('balances against the January figures', () => {
  // From fixtures/golden-numbers.json, block cashflow_by_account_2026_01.
  const EXPECTED: Record<string, { opening: number; received: number; paid: number; closing: number }> = {
    '1111':      { opening:  22921.00, received: 803009,    paid: 641081,    closing: 184849.00 },
    '1121-3388': { opening:  96293.85, received: 348716.60, paid: 378403.41, closing:  66607.04 },
    '1121-9530': { opening:  17088.45, received: 142058,    paid: 138337.50, closing:  20808.95 },
    '1121-6086': { opening:   2470.11, received:      6.81, paid:      0,    closing:   2476.92 },
    '1121ZL':    { opening:      0,    received:  19520,    paid:  24080,    closing:  -4560.00 },
    '1121CK':    { opening: -40000,    received: 328025,    paid: 341875,    closing: -53850.00 },
  }

  beforeAll(async () => {
    for (const [code, e] of Object.entries(EXPECTED)) {
      await db.query(
        `INSERT INTO pc49.cash_opening_balance (cash_account_code, as_of, amount)
         VALUES ($1, '2025-12-31', $2)
         ON CONFLICT (cash_account_code, as_of) DO UPDATE SET amount = excluded.amount`,
        [code, e.opening])
      if (e.received > 0) {
        await db.query(
          `INSERT INTO pc49.cash_txn (txn_date, cash_account_code, direction, amount, description)
           VALUES ('2026-01-15', $1, 'IN', $2, 'January receipts')`, [code, e.received])
      }
      if (e.paid > 0) {
        await db.query(
          `INSERT INTO pc49.cash_txn (txn_date, cash_account_code, direction, amount, description)
           VALUES ('2026-01-15', $1, 'OUT', $2, 'January payments')`, [code, e.paid])
      }
    }
  })

  it.each(Object.entries(EXPECTED))('closes %s at the figure in the source', async (code, e) => {
    const r = await db.query<{ closing: string }>(
      `SELECT pc49.cash_balance($1, '2026-01-31'::date)::text AS closing`, [code])
    expect(Number(r.rows[0].closing)).toBeCloseTo(e.closing, 2)
  })

  it('lets a clearing account close negative', async () => {
    const r = await db.query<{ closing: string }>(
      `SELECT pc49.cash_balance('1121CK', '2026-01-31'::date)::text AS closing`)
    expect(Number(r.rows[0].closing)).toBeLessThan(0)
  })

  it('lays the period out the way B. REPORT THUCHI does', async () => {
    const r = await db.query<{ code: string; opening: string; received: string; paid: string; closing: string }>(
      `SELECT cash_account_code AS code, opening::text, received::text, paid::text, closing::text
         FROM pc49.cashflow_by_account('2026-01') WHERE cash_account_code = '1121-3388'`)
    expect(Number(r.rows[0].opening)).toBeCloseTo(96293.85, 2)
    expect(Number(r.rows[0].received)).toBeCloseTo(348716.60, 2)
    expect(Number(r.rows[0].paid)).toBeCloseTo(378403.41, 2)
    expect(Number(r.rows[0].closing)).toBeCloseTo(66607.04, 2)
  })
})

describe('reconciling with the US cash book', () => {
  it('accepts NOT_FOUND as a real status', async () => {
    await db.query(
      `INSERT INTO pc49.cash_reconciliation
         (rec_date, cash_account_code, our_closing, us_closing, status, reason)
       VALUES ('2026-03-01', '1111', 55888, NULL, 'NOT_FOUND', 'khong tim thay')`)
    const r = await db.query<{ status: string }>(
      `SELECT status::text FROM pc49.cash_reconciliation
        WHERE rec_date = '2026-03-01' AND cash_account_code = '1111'`)
    expect(r.rows[0].status).toBe('NOT_FOUND')
  })

  it('computes the difference rather than trusting a typed one', async () => {
    await db.query(
      `INSERT INTO pc49.cash_reconciliation
         (rec_date, cash_account_code, our_closing, us_closing, status, reason)
       VALUES ('2026-03-02', '1111', 1000, 900, 'DIFF_EXPLAINED', 'a receipt keyed twice')`)
    const r = await db.query<{ diff: string }>(
      `SELECT difference::text AS diff FROM pc49.cash_reconciliation
        WHERE rec_date = '2026-03-02'`)
    expect(Number(r.rows[0].diff)).toBe(100)
  })

  it('refuses to call a difference explained without an explanation', async () => {
    await expect(
      db.query(`INSERT INTO pc49.cash_reconciliation
                  (rec_date, cash_account_code, our_closing, us_closing, status)
                VALUES ('2026-03-03', '1111', 1000, 900, 'DIFF_EXPLAINED')`),
    ).rejects.toThrow(/cash_reconciliation_explained_needs_reason/)
  })
})

describe('intercompany lending', () => {
  it('tracks what HP still owes PC49', async () => {
    await db.query(
      `INSERT INTO pc49.internal_loan (loan_date, counterparty, direction, amount, description)
       VALUES ('2022-11-08', 'HP', 'LEND',  400000, 'Muon PC49'),
              ('2022-11-30', 'HP', 'REPAY',  30000, 'HP tra cash'),
              ('2022-12-31', 'HP', 'REPAY',  58000, 'HP tra cash')`)
    const r = await db.query<{ out: string }>(
      `SELECT outstanding::text AS out FROM pc49.v_internal_loan_balance WHERE counterparty = 'HP'`)
    expect(Number(r.rows[0].out)).toBe(312000)
  })
})
