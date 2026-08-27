import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function newBatch(source: string, file = 'test.xlsx'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.import_batch (source, file_name) VALUES ($1, $2) RETURNING id`,
    [source, file])
  return r.rows[0].id
}

async function stage(batch: string, rowNo: number, payload: Record<string, unknown>) {
  const r = await db.query<{ status: string }>(
    `SELECT pc49.stage_import_row($1, $2, $3::jsonb)::text AS status`,
    [batch, rowNo, JSON.stringify(payload)])
  return r.rows[0].status
}

async function reasonFor(batch: string, rowNo: number): Promise<string | null> {
  const r = await db.query<{ reason: string | null }>(
    `SELECT reason FROM pc49.import_row WHERE batch_id = $1 AND row_no = $2`, [batch, rowNo])
  return r.rows[0].reason
}

describe('what the sheet could not answer either', () => {
  let batch: string
  beforeAll(async () => { batch = await newBatch('GOLD_TXN') })

  it.each([
    ['#REF!',   101],   // a broken cross-sheet reference
    ['#VALUE!', 102],   // a formula fed the wrong type
    ['#N/A',    103],   // a lookup that found nothing
    ['#DIV/0!', 104],   // a division by an empty cell
  ])('rejects a row holding %s', async (marker, row) => {
    const status = await stage(batch, row,
      { gold_type_code: 'SG', qty: '10', unit_price: marker })
    expect(status).toBe('REJECTED')
    expect(await reasonFor(batch, row)).toContain(marker)
  })

  it('rejects a row the accountant marked as not found', async () => {
    const status = await stage(batch, 200,
      { gold_type_code: 'SG', qty: '10', note: 'khong tim thay' })
    expect(status).toBe('REJECTED')
    expect(await reasonFor(batch, 200)).toMatch(/did not know/)
  })

  it('accepts "no information", which is a placeholder rather than a failure', async () => {
    // The source writes this in the phone column for a walk-in customer. It is
    // an answer, not a broken formula, and rejecting it would throw away most of
    // the customer list.
    const status = await stage(batch, 201,
      { gold_type_code: 'SG', qty: '10', contact: 'Không có thông tin' })
    expect(status).toBe('VALID')
  })
})

describe('rows naming something the system has never heard of', () => {
  it('rejects an unknown gold type by name, not by foreign key', async () => {
    const batch = await newBatch('GOLD_TXN')
    const status = await stage(batch, 1, { gold_type_code: 'PLATINUMM', qty: '5' })
    expect(status).toBe('REJECTED')
    expect(await reasonFor(batch, 1)).toBe('no gold type called PLATINUMM')
  })

  it('rejects an unknown account', async () => {
    const batch = await newBatch('JOURNAL')
    const status = await stage(batch, 1, { account_code: '999ZZZ', amount: '100' })
    expect(status).toBe('REJECTED')
    expect(await reasonFor(batch, 1)).toBe('no account called 999ZZZ')
  })

  it('rejects an unknown cash account', async () => {
    const batch = await newBatch('OPENING_CASH')
    const status = await stage(batch, 1, { cash_account_code: '1121-4500', amount: '100' })
    expect(status).toBe('REJECTED')
    expect(await reasonFor(batch, 1)).toBe('no cash account called 1121-4500')
  })

  it('accepts a row naming things that do exist', async () => {
    const batch = await newBatch('GOLD_TXN')
    expect(await stage(batch, 1, { gold_type_code: 'GRAIN', qty: '37.5' })).toBe('VALID')
  })
})

describe('a reason the accountant can read', () => {
  // The English text stays for the audit trail, but the screen builds its own
  // sentence from the code and the value, so a Vietnamese reader is not sent
  // back to the spreadsheet with an English error message.
  it.each([
    [{ gold_type_code: 'NOPE' },        'UNKNOWN_GOLD_TYPE',    'NOPE'],
    [{ account_code: '999ZZZ' },        'UNKNOWN_ACCOUNT',      '999ZZZ'],
    [{ cash_account_code: '1121-77' },  'UNKNOWN_CASH_ACCOUNT', '1121-77'],
    [{ gold_type_code: 'SG', memo: '#REF!' }, 'SHEET_ERROR',    '#REF!'],
  ])('names the code and the value for %j', async (payload, code, value) => {
    const batch = await newBatch('JOURNAL')
    await stage(batch, 1, payload)
    const r = await db.query<{ code: string; value: string; reason: string }>(
      `SELECT reason_code AS code, reason_value AS value, reason
         FROM pc49.import_row WHERE batch_id = $1`, [batch])
    expect(r.rows[0].code).toBe(code)
    expect(r.rows[0].value).toBe(value)
    expect(r.rows[0].reason).toContain(value)
  })

  it('leaves both empty on a row that was accepted', async () => {
    const batch = await newBatch('JOURNAL')
    await stage(batch, 1, { account_code: '131', amount: '1' })
    const r = await db.query<{ code: string | null; reason: string | null }>(
      `SELECT reason_code AS code, reason FROM pc49.import_row WHERE batch_id = $1`, [batch])
    expect(r.rows[0].code).toBeNull()
    expect(r.rows[0].reason).toBeNull()
  })

  it('has a sentence for a quantity that is simply absent', async () => {
    const batch = await newBatch('GOLD_TXN')
    await stage(batch, 1, { gold_type_code: 'SG', qty: '' })
    const r = await db.query<{ code: string; value: string | null }>(
      `SELECT reason_code AS code, reason_value AS value
         FROM pc49.import_row WHERE batch_id = $1`, [batch])
    expect(r.rows[0].code).toBe('MISSING_QTY')
    expect(r.rows[0].value).toBeNull()
  })
})

describe('a batch is reviewable before anything is written', () => {
  let batch: string
  beforeAll(async () => {
    batch = await newBatch('GOLD_TXN', 'PC49 Sale 01.2026')
    await stage(batch, 1, { gold_type_code: 'RP',    qty: '-1' })
    await stage(batch, 2, { gold_type_code: 'SG',    qty: '63.3' })
    await stage(batch, 3, { gold_type_code: 'NOPE',  qty: '1' })
    await stage(batch, 4, { gold_type_code: 'GRAIN', qty: '' })
  })

  it('counts what is good and what is not', async () => {
    const r = await db.query<{ total: string; valid: string; rejected: string }>(
      `SELECT row_count::text AS total, valid_count::text AS valid,
              rejected_count::text AS rejected
         FROM pc49.v_import_batch_summary WHERE batch_id = $1`, [batch])
    expect(Number(r.rows[0].total)).toBe(4)
    expect(Number(r.rows[0].valid)).toBe(2)
    expect(Number(r.rows[0].rejected)).toBe(2)
  })

  it('keeps a reason against every rejected row, pointing at the sheet row', async () => {
    const r = await db.query<{ row_no: number; reason: string }>(
      `SELECT row_no, reason FROM pc49.import_row
        WHERE batch_id = $1 AND status = 'REJECTED' ORDER BY row_no`, [batch])
    expect(r.rows.map((x) => x.row_no)).toEqual([3, 4])
    expect(r.rows[0].reason).toBe('no gold type called NOPE')
    expect(r.rows[1].reason).toBe('a gold transaction with no quantity')
  })

  it('writes nothing to the books until somebody commits', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn`)
    expect(Number(r.rows[0].n)).toBe(0)
  })

  it('takes a corrected row over the old one when the load is run again', async () => {
    expect(await stage(batch, 3, { gold_type_code: 'PT', qty: '1' })).toBe('VALID')
    const r = await db.query<{ valid: string; rejected: string }>(
      `SELECT valid_count::text AS valid, rejected_count::text AS rejected
         FROM pc49.v_import_batch_summary WHERE batch_id = $1`, [batch])
    expect(Number(r.rows[0].valid)).toBe(3)
    expect(Number(r.rows[0].rejected)).toBe(1)
  })
})

describe('the reconciliation the accountant signs off', () => {
  const AS_OF = '2026-01-31'

  beforeAll(async () => {
    // What the spreadsheets say January closed at, recorded before the detail
    // is loaded so the system can be asked whether the detail adds up to it.
    await db.exec(`
      INSERT INTO pc49.import_expected_figure (as_of, metric, metric_key, expected, source_note)
      VALUES ('${AS_OF}', 'INVENTORY_GRAM', 'GRAIN', 1717.39, 'NXT sheet'),
             ('${AS_OF}', 'INVENTORY_GRAM', 'SG',     132.44, 'NXT sheet'),
             ('${AS_OF}', 'CASH_BALANCE',   '1111', 184849.00, 'B. REPORT THUCHI'),
             ('${AS_OF}', 'CASH_BALANCE',   '1121-3388', 66607.04, 'B. REPORT THUCHI');

      INSERT INTO pc49.cash_opening_balance (cash_account_code, as_of, amount)
      VALUES ('1111', '2025-12-31', 184849.00),
             ('1121-3388', '2025-12-31', 66607.04);

      INSERT INTO pc49.inventory_movement
        (move_date, gold_type_code, bucket, qty_gram, source_type)
      VALUES ('2026-01-31', 'GRAIN', 'ON_HAND', 1717.39, 'OPENING'),
             ('2026-01-31', 'SG',    'ON_HAND',  100.00, 'OPENING');
    `)
  })

  it('agrees where the detail adds up', async () => {
    const r = await db.query<{ agrees: boolean; actual: string }>(
      `SELECT agrees, actual::text FROM pc49.import_reconciliation($1)
        WHERE metric = 'INVENTORY_GRAM' AND metric_key = 'GRAIN'`, [AS_OF])
    expect(r.rows[0].agrees).toBe(true)
    expect(Number(r.rows[0].actual)).toBeCloseTo(1717.39, 2)
  })

  it('says so plainly where it does not, and by how much', async () => {
    const r = await db.query<{ agrees: boolean; expected: string; actual: string; diff: string }>(
      `SELECT agrees, expected::text, actual::text, difference::text AS diff
         FROM pc49.import_reconciliation($1)
        WHERE metric = 'INVENTORY_GRAM' AND metric_key = 'SG'`, [AS_OF])
    expect(r.rows[0].agrees).toBe(false)
    expect(Number(r.rows[0].expected)).toBeCloseTo(132.44, 2)
    expect(Number(r.rows[0].actual)).toBeCloseTo(100, 2)
    expect(Number(r.rows[0].diff)).toBeCloseTo(-32.44, 2)
  })

  it('checks the cash balances too', async () => {
    const r = await db.query<{ key: string; agrees: boolean }>(
      `SELECT metric_key AS key, agrees FROM pc49.import_reconciliation($1)
        WHERE metric = 'CASH_BALANCE' ORDER BY metric_key`, [AS_OF])
    expect(r.rows.every((x) => x.agrees)).toBe(true)
  })

  it('reports only what somebody stated an expectation for', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.import_reconciliation($1)`, [AS_OF])
    expect(Number(r.rows[0].n)).toBe(4)
  })

  it('proves the ledger balances when an expectation is set for it', async () => {
    await db.exec(`
      INSERT INTO pc49.import_expected_figure (as_of, metric, metric_key, expected)
      VALUES ('${AS_OF}', 'LEDGER_DEBIT', 'ALL', 0),
             ('${AS_OF}', 'LEDGER_CREDIT', 'ALL', 0)`)
    const r = await db.query<{ metric: string; agrees: boolean }>(
      `SELECT metric, agrees FROM pc49.import_reconciliation($1)
        WHERE metric LIKE 'LEDGER%' ORDER BY metric`, [AS_OF])
    expect(r.rows.map((x) => x.agrees)).toEqual([true, true])
  })
})
