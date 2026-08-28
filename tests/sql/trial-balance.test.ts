import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite

/** Posts a one-line entry, which balances itself. */
async function post(date: string, dr: string, cr: string, amount: number, memo = 'test') {
  const e = await db.query<{ id: string }>(
    `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
     VALUES ($1, to_char($1::date, 'YYYY-MM'), $2, 'MANUAL') RETURNING id`,
    [date, memo])
  await db.query(
    `INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
     VALUES ($1, 1, $2, $3, $4)`, [e.rows[0].id, dr, cr, amount])
  await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`, [e.rows[0].id])
  return e.rows[0].id
}

beforeAll(async () => {
  db = await createTestDb()
  // December, so January has something to open with.
  await post('2026-12-10', '1111', '4111', 100000, 'opening capital')
  // January.
  await post('2027-01-05', '131', '511', 6000, 'a sale')
  await post('2027-01-06', '1111', '131', 4000, 'part paid')
  await post('2027-01-20', '642', '1111', 250, 'a fee')
}, 60_000)
afterAll(async () => { await db?.close() })

describe('the trial balance', () => {
  async function row(code: string) {
    const r = await db.query<Record<string, string>>(
      `SELECT opening::text, debit::text, credit::text, closing::text
         FROM pc49.trial_balance('2027-01') WHERE account_code = $1`, [code])
    return r.rows[0]
  }

  it('carries an opening balance in from before the month', async () => {
    // Cash was put in during December and must not start January at zero.
    expect(Number((await row('1111')).opening)).toBeCloseTo(100000, 2)
  })

  it('adds up what moved in the month', async () => {
    const cash = await row('1111')
    expect(Number(cash.debit)).toBeCloseTo(4000, 2)
    expect(Number(cash.credit)).toBeCloseTo(250, 2)
    expect(Number(cash.closing)).toBeCloseTo(103750, 2)
  })

  it('reads an asset debit-positive and revenue credit-positive', async () => {
    // Both closing figures are what the account holds, so neither has to be
    // negated in the reader's head.
    expect(Number((await row('131')).closing)).toBeCloseTo(2000, 2)
    expect(Number((await row('511')).closing)).toBeCloseTo(6000, 2)
  })

  it('proves itself: total debits equal total credits', async () => {
    // This is the whole reason the report exists.
    const r = await db.query<{ dr: string; cr: string }>(
      `SELECT sum(debit)::text AS dr, sum(credit)::text AS cr
         FROM pc49.trial_balance('2027-01')`)
    expect(Number(r.rows[0].dr)).toBeCloseTo(Number(r.rows[0].cr), 2)
    expect(Number(r.rows[0].dr)).toBeGreaterThan(0)
  })

  it('leaves out an account that has never been touched', async () => {
    // Forty-six accounts exist; a monthly report listing the forty that never
    // moved is a report nobody reads.
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.trial_balance('2027-01')`)
    const all = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM pc49.account`)
    expect(Number(r.rows[0].n)).toBeLessThan(Number(all.rows[0].n))
    expect(Number(r.rows[0].n)).toBeGreaterThan(0)
  })

  it('still lists an account that only carries a balance forward', async () => {
    // 4111 moved in December and not in January, but it holds 100,000 and a
    // trial balance that omits it does not balance.
    const equity = await row('4111')
    expect(Number(equity.opening)).toBeCloseTo(100000, 2)
    expect(Number(equity.debit)).toBe(0)
    expect(Number(equity.credit)).toBe(0)
  })

  it('ignores an entry that was never posted', async () => {
    const e = await db.query<{ id: string }>(
      `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
       VALUES ('2027-01-25', '2027-01', 'draft', 'MANUAL') RETURNING id`)
    await db.query(
      `INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
       VALUES ($1, 1, '1111', '511', 999999)`, [e.rows[0].id])
    expect(Number((await row('1111')).debit)).toBeCloseTo(4000, 2)
  })
})

describe('the general ledger for one account', () => {
  it('starts from where the account already stood', async () => {
    // The first January line must sit on top of December's 100,000, not on zero.
    const r = await db.query<{ balance: string; memo: string }>(
      `SELECT balance::text, memo FROM pc49.general_ledger('1111', '2027-01-01', '2027-01-31')
        ORDER BY entry_date LIMIT 1`)
    expect(r.rows[0].memo).toBe('part paid')
    expect(Number(r.rows[0].balance)).toBeCloseTo(104000, 2)
  })

  it('runs the balance down the page', async () => {
    const r = await db.query<{ balance: string }>(
      `SELECT balance::text FROM pc49.general_ledger('1111', '2027-01-01', '2027-01-31')
        ORDER BY entry_date`)
    expect(r.rows.map((x) => Number(x.balance))).toEqual([104000, 103750])
  })

  it('names the other side of each line', async () => {
    // A ledger column of amounts with no contra account is a list, not a ledger.
    const r = await db.query<{ contra: string; debit: string; credit: string }>(
      `SELECT contra_account AS contra, debit::text, credit::text
         FROM pc49.general_ledger('1111', '2027-01-01', '2027-01-31') ORDER BY entry_date`)
    expect(r.rows[0].contra).toBe('131')
    expect(Number(r.rows[0].debit)).toBeCloseTo(4000, 2)
    expect(r.rows[1].contra).toBe('642')
    expect(Number(r.rows[1].credit)).toBeCloseTo(250, 2)
  })

  it('ends where the trial balance says the account closed', async () => {
    // The two reports answer the same question at different resolutions, and
    // disagreeing would make both useless.
    const ledger = await db.query<{ balance: string }>(
      `SELECT balance::text FROM pc49.general_ledger('1111', '2027-01-01', '2027-01-31')
        ORDER BY entry_date DESC LIMIT 1`)
    const trial = await db.query<{ closing: string }>(
      `SELECT closing::text FROM pc49.trial_balance('2027-01') WHERE account_code = '1111'`)
    expect(Number(ledger.rows[0].balance)).toBeCloseTo(Number(trial.rows[0].closing), 2)
  })

  it('reads a revenue account credit-positive too', async () => {
    const r = await db.query<{ balance: string }>(
      `SELECT balance::text FROM pc49.general_ledger('511', '2027-01-01', '2027-01-31')
        ORDER BY entry_date DESC LIMIT 1`)
    expect(Number(r.rows[0].balance)).toBeCloseTo(6000, 2)
  })

  it('returns nothing for a window with no entries in it', async () => {
    const r = await db.query(
      `SELECT * FROM pc49.general_ledger('1111', '2027-03-01', '2027-03-31')`)
    expect(r.rows).toHaveLength(0)
  })
})
