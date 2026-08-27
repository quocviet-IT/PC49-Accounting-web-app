import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite

/** Posts a one-line entry, which balances itself. */
async function post(date: string, dr: string, cr: string, amount: number,
                    partner?: string, gold?: { code: string; uom: string; qty: number }) {
  const e = await db.query<{ id: string }>(
    `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind, partner_code)
     VALUES ($1, to_char($1::date, 'YYYY-MM'), 'test', 'MANUAL', $2) RETURNING id`,
    [date, partner ?? null])
  await db.query(
    `INSERT INTO pc49.journal_line
       (entry_id, seq, debit_account, credit_account, amount_usd, gold_type_code, uom, qty_native)
     VALUES ($1, 1, $2, $3, $4, $5, $6, $7)`,
    [e.rows[0].id, dr, cr, amount, gold?.code ?? null, gold?.uom ?? null, gold?.qty ?? null])
  await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`, [e.rows[0].id])
}

beforeAll(async () => {
  db = await createTestDb()

  // January 2026, from fixtures/golden-numbers.json block profit_and_loss_2026_01.
  await post('2026-01-15', '131', '511', 791124)     // sales revenue
  await post('2026-01-15', '131', '515', 6.81)       // financial income

  const cogs: [string, number][] = [
    ['632RP',    468738],
    ['632ML',     50116],
    ['632CS',     86295],
    ['632-9999',  95641],
    ['632SG',      9900],
    ['632Grain', 49432.54209],
  ]
  for (const [account, amount] of cogs) {
    await post('2026-01-15', account, '156RP', amount)
  }
}, 60_000)
afterAll(async () => { await db?.close() })

describe('the profit and loss report', () => {
  async function line(code: string): Promise<number> {
    const r = await db.query<{ amount: string }>(
      `SELECT amount::text FROM pc49.pl_report('2026-01') WHERE code = $1`, [code])
    return Number(r.rows[0].amount)
  }

  it('totals revenue at 791,130.81', async () => {
    expect(await line('REV_TOTAL')).toBeCloseTo(791130.81, 2)
  })

  it('splits revenue into sales and other', async () => {
    expect(await line('REV_OPER')).toBeCloseTo(791124, 2)
    expect(await line('REV_OTHER')).toBeCloseTo(6.81, 2)
  })

  it('totals cost of sales at 760,122.54', async () => {
    expect(await line('COGS_TOTAL')).toBeCloseTo(760122.54, 2)
  })

  // The source sheet carries 760,122.5421 because a spreadsheet multiplies
  // unrounded figures all the way to a total. A ledger stores money to the cent,
  // so the same month closes at 760,122.54. The gap is the rounding the
  // spreadsheet never did, not a missing 0.21 cents of cost.
  it('rounds to the cent, where the spreadsheet does not', async () => {
    expect(await line('COGS_GRAIN')).toBeCloseTo(49432.54, 2)
    expect(await line('COGS_GRAIN')).not.toBeCloseTo(49432.54209, 4)
  })

  it('breaks cost of sales down by gold type', async () => {
    expect(await line('COGS_RP')).toBeCloseTo(468738, 2)
    expect(await line('COGS_ML')).toBeCloseTo(50116, 2)
    expect(await line('COGS_CS')).toBeCloseTo(86295, 2)
    expect(await line('COGS_9999')).toBeCloseTo(95641, 2)
    expect(await line('COGS_SG')).toBeCloseTo(9900, 2)
    expect(await line('COGS_GRAIN')).toBeCloseTo(49432.54, 2)
  })

  it('shows a gold type with no movement as zero rather than omitting it', async () => {
    expect(await line('COGS_AE')).toBe(0)
    expect(await line('COGS_PT')).toBe(0)
  })

  it('arrives at a gross profit of 31,008.27', async () => {
    expect(await line('GROSS_PROFIT')).toBeCloseTo(31008.27, 2)
  })

  it('returns the lines in report order, subtotal above its components', async () => {
    const r = await db.query<{ code: string }>(
      `SELECT code FROM pc49.pl_report('2026-01') LIMIT 4`)
    expect(r.rows.map((x) => x.code)).toEqual(
      ['REV_TOTAL', 'REV_OPER', 'REV_SALES', 'REV_OTHER'])
  })

  it('picks up a line item added as data, with no code change', async () => {
    await db.query(
      `INSERT INTO pc49.pl_line_definition
         (code, name_vi, name_en, kind, accounts, indent, sort_order)
       VALUES ('EXP_ADMIN', 'Chi phí quản lý', 'Administrative expense',
               'ACCOUNTS', ARRAY['642'], 1, 500)`)
    await post('2026-01-20', '642', '1111', 1250)
    const r = await db.query<{ amount: string }>(
      `SELECT amount::text FROM pc49.pl_report('2026-01') WHERE code = 'EXP_ADMIN'`)
    expect(Number(r.rows[0].amount)).toBeCloseTo(1250, 2)
  })

  it('leaves another period empty', async () => {
    const r = await db.query<{ amount: string }>(
      `SELECT amount::text FROM pc49.pl_report('2026-02') WHERE code = 'GROSS_PROFIT'`)
    expect(Number(r.rows[0].amount)).toBe(0)
  })
})

describe('receivables and payables', () => {
  beforeAll(async () => {
    await post('2026-02-05', '131', '511', 6000, 'NNI')
    await post('2026-02-06', '331', '1111', 2000, 'CTY1')
  })

  it('reports a customer balance against the receivable account', async () => {
    const r = await db.query<{ closing: string }>(
      `SELECT closing_value::text AS closing FROM pc49.apar_report('2026-02')
        WHERE partner_code = 'NNI' AND account_code = '131'`)
    expect(Number(r.rows[0].closing)).toBeCloseTo(6000, 2)
  })

  it('carries an opening balance forward from an earlier period', async () => {
    const r = await db.query<{ opening: string; closing: string }>(
      `SELECT opening_value::text AS opening, closing_value::text AS closing
         FROM pc49.apar_report('2026-03')
        WHERE partner_code = 'NNI' AND account_code = '131'`)
    expect(Number(r.rows[0].opening)).toBeCloseTo(6000, 2)
    expect(Number(r.rows[0].closing)).toBeCloseTo(6000, 2)
  })

  it('drops a counterparty once its balance nets to zero', async () => {
    await post('2026-04-01', '131', '511', 500, 'SETTLED')
    const owing = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.apar_report('2026-04')
        WHERE partner_code = 'SETTLED'`)
    expect(Number(owing.rows[0].n)).toBe(1)

    await post('2026-05-01', '1111', '131', 500, 'SETTLED')   // paid in full
    const settled = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.apar_report('2026-06')
        WHERE partner_code = 'SETTLED'`)
    expect(Number(settled.rows[0].n)).toBe(0)
  })
})

describe('the total assets report', () => {
  beforeAll(async () => {
    await db.exec(`
      INSERT INTO pc49.spot_price_daily (price_date, metal, spot_per_oz)
      VALUES ('2026-01-31', 'GOLD', 4890);
      INSERT INTO pc49.inventory_movement
        (move_date, gold_type_code, bucket, qty_gram, source_type)
      VALUES ('2026-01-10', 'GRAIN', 'ON_HAND', 1000, 'OPENING');
      INSERT INTO pc49.cash_opening_balance (cash_account_code, as_of, amount)
      VALUES ('1111', '2025-12-31', 184849),
             ('1121-3388', '2025-12-31', 66607.04),
             ('1121-9530', '2025-12-31', 20808.95),
             ('1121-6086', '2025-12-31', 2476.92);
    `)
  })

  it('values inventory at the last spot price on or before the date', async () => {
    const r = await db.query<{ gram: string; spot: string; value: string }>(
      `SELECT inventory_gram::text AS gram, spot_per_gram::text AS spot,
              inventory_value::text AS value
         FROM pc49.total_asset_report('2026-01-31')`)
    expect(Number(r.rows[0].gram)).toBeCloseTo(1000, 2)
    // 4,890 an ounce divided by 31.1, the valuation divisor, not 31.105.
    expect(Number(r.rows[0].spot)).toBeCloseTo(157.2347267, 6)
    expect(Number(r.rows[0].value)).toBeCloseTo(157234.73, 2)
  })

  it('separates cash from bank, as the source does', async () => {
    const r = await db.query<{ cash: string; bank: string }>(
      `SELECT cash::text, bank::text FROM pc49.total_asset_report('2026-01-31')`)
    expect(Number(r.rows[0].cash)).toBeCloseTo(184849, 2)
    expect(Number(r.rows[0].bank)).toBeCloseTo(89892.91, 2)
  })

  it('takes AR and AP from the ledger rather than a keyed-in figure', async () => {
    // The source sheet shows both as zero for all twelve months while its own
    // AP/AR report shows movement. Here they are derived, so there is one answer.
    const r = await db.query<{ ar: string }>(
      `SELECT receivable::text AS ar FROM pc49.total_asset_report('2026-01-31')`)
    expect(Number(r.rows[0].ar)).toBeGreaterThan(0)
  })

  it('computes the cash flow total as inventory plus receivables plus money, less payables', async () => {
    const r = await db.query<{
      value: string; ar: string; ap: string; cash: string; bank: string; total: string
    }>(`SELECT inventory_value::text AS value, receivable::text AS ar, payable::text AS ap,
               cash::text, bank::text, cash_flow_total::text AS total
          FROM pc49.total_asset_report('2026-01-31')`)
    const x = r.rows[0]
    const expected = Number(x.value) + Number(x.ar) + Number(x.cash) + Number(x.bank) - Number(x.ap)
    expect(Number(x.total)).toBeCloseTo(expected, 2)
  })
})
