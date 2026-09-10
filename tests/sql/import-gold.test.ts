import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function newBatch(source = 'GOLD_TXN'): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.import_batch (source, file_name) VALUES ($1, 'test.csv') RETURNING id`,
    [source])
  return r.rows[0].id
}

async function stage(batch: string, rowNo: number, payload: Record<string, string>) {
  const r = await db.query<{ status: string }>(
    `SELECT pc49.stage_import_row($1, $2, $3::jsonb)::text AS status`,
    [batch, rowNo, JSON.stringify(payload)])
  return r.rows[0].status
}

const commit = (batch: string) =>
  db.query(`SELECT * FROM pc49.commit_import_batch($1, false)`, [batch])

async function turnedBack(batch: string, rowNo: number) {
  const r = await db.query<{ code: string; value: string }>(
    `SELECT reason_code AS code, reason_value AS value
       FROM pc49.import_row WHERE batch_id = $1 AND row_no = $2`, [batch, rowNo])
  return r.rows[0]
}

/** A scrap purchase, the commonest row in the workbook. */
const buy = {
  txn_date: '2026-01-15', txn_type: 'PO', gold_type_code: 'SG', uom: 'GRAM',
  qty: '10', unit_price: '65', amount: '-650', partner_code: 'Chi Lan',
  scrap_detail: '14k/grs',
}

describe('a transaction arrives with the money and the people on it', () => {
  it('writes the payments the sheet recorded against it', async () => {
    // Without a payment line post_gold_txn refuses to post, so a transaction
    // loaded without its money is a transaction that never reaches the books.
    const b = await newBatch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:400|AP:CHECK:250' })
    await commit(b)
    const r = await db.query<{ seq: number; direction: string; method: string; amount: string }>(
      `SELECT p.seq, p.direction::text AS direction, p.method::text AS method, p.amount::text AS amount
         FROM pc49.gold_txn_payment p
         JOIN pc49.import_row r ON r.committed_ref = p.txn_id
        WHERE r.batch_id = $1 ORDER BY p.seq`, [b])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ seq: 1, direction: 'AP', method: 'CASH' })
    expect(Number(r.rows[0].amount)).toBe(400)
    expect(r.rows[1].method).toBe('CHECK')
  })

  it('splits two sales people eighty-twenty, in the order they were written', async () => {
    const b = await newBatch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:650', sales: 'N.Ý/T.Quỳnh' })
    await commit(b)
    const r = await db.query<{ code: string; share: string }>(
      `SELECT s.sales_person_code AS code, s.share_pct::text AS share
         FROM pc49.gold_txn_sales_person s
         JOIN pc49.import_row r ON r.committed_ref = s.txn_id
        WHERE r.batch_id = $1 ORDER BY s.share_pct DESC`, [b])
    expect(r.rows.map((x) => [x.code, Number(x.share)]))
      .toEqual([['N.Ý', 80], ['T.Quỳnh', 20]])
  })

  it('registers a sales person the system has never seen', async () => {
    // Seven names in the workbook are not in the system. Waiting for somebody
    // to declare them by hand holds up 113 rows of trading.
    const b = await newBatch()
    await stage(b, 2, { ...buy, payments: 'AP:CASH:650', sales: 'Q.Nghi' })
    await commit(b)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.sales_person WHERE code = 'Q.Nghi'`)
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('registers a customer the system has never seen', async () => {
    const b = await newBatch()
    await stage(b, 2, { ...buy, partner_code: 'Nguyễn Văn Mới', payments: 'AP:CASH:650' })
    await commit(b)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.partner WHERE code = 'Nguyễn Văn Mới'`)
    expect(Number(r.rows[0].n)).toBe(1)
  })

  it('turns back a row naming four sales people', async () => {
    // The accountant settled it: three at most. A fourth name is a typo, and
    // inventing a share for it invents a commission split nobody agreed to.
    const b = await newBatch()
    expect(await stage(b, 2, { ...buy, sales: 'A/B/C/D' })).toBe('REJECTED')
    expect(await turnedBack(b, 2)).toMatchObject({ code: 'TOO_MANY_SALES', value: 'A/B/C/D' })
  })

  it('turns back a payment it cannot read', async () => {
    const b = await newBatch()
    expect(await stage(b, 2, { ...buy, payments: 'AP:VENMO:400' })).toBe('REJECTED')
    expect(await turnedBack(b, 2)).toMatchObject({ code: 'BAD_PAYMENT', value: 'AP:VENMO:400' })
  })
})

describe('a transfer says why it happened', () => {
  it('makes one conversion out of the rows that share a key', async () => {
    // The sheet writes a conversion as loose rows on one day. A conversion is
    // what ties them together, and it is what the system demands before gold
    // may leave one type and appear as another.
    const b = await newBatch()
    await stage(b, 2, { txn_date: '2026-01-05', txn_type: 'TRANSFER_OUT',
      gold_type_code: 'GRAIN', uom: 'GRAM', qty: '-975', amount: '0', conv_key: '2026-01-05#1' })
    await stage(b, 3, { txn_date: '2026-01-05', txn_type: 'TRANSFER_IN',
      gold_type_code: 'RP', uom: 'LUONG', qty: '26', amount: '0', conv_key: '2026-01-05#1' })
    await commit(b)
    const r = await db.query<{ n: string; convs: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT t.conversion_id)::text AS convs
         FROM pc49.gold_txn t JOIN pc49.import_row r ON r.committed_ref = t.id
        WHERE r.batch_id = $1`, [b])
    expect(r.rows[0]).toMatchObject({ n: '2', convs: '1' })
  })

  it('turns back a transfer with nothing to explain it', async () => {
    // Ten days in six months do not balance in grams when the day is added up.
    // Inventing a conversion for those is inventing something that never
    // happened, so they come back to be looked at instead.
    const b = await newBatch()
    expect(await stage(b, 2, { txn_date: '2026-02-11', txn_type: 'TRANSFER_OUT',
      gold_type_code: 'RP', uom: 'LUONG', qty: '-5', amount: '0' })).toBe('REJECTED')
    expect(await turnedBack(b, 2)).toMatchObject({ code: 'NO_CONVERSION', value: '2026-02-11' })
  })

  it('hangs a scrap transfer on the refining lot it went to', async () => {
    await db.query(
      `INSERT INTO pc49.refining_lot (lot_code, refinery_name) VALUES ('S26.09', 'Test')`)
    const b = await newBatch()
    await stage(b, 2, { txn_date: '2026-01-06', txn_type: 'TRANSFER_OUT',
      gold_type_code: 'SG', uom: 'GRAM', qty: '-195.09', amount: '0', lot_code: 'S26.09' })
    await commit(b)
    const r = await db.query<{ lot: string }>(
      `SELECT l.lot_code AS lot FROM pc49.gold_txn t
         JOIN pc49.refining_lot l ON l.id = t.refining_lot_id
         JOIN pc49.import_row r ON r.committed_ref = t.id
        WHERE r.batch_id = $1`, [b])
    expect(r.rows[0].lot).toBe('S26.09')
  })

  it('says which lot it cannot find rather than dropping the link', async () => {
    const b = await newBatch()
    await stage(b, 2, { txn_date: '2026-01-06', txn_type: 'TRANSFER_OUT',
      gold_type_code: 'SG', uom: 'GRAM', qty: '-10', amount: '0', lot_code: 'S26.NOPE' })
    await expect(commit(b)).rejects.toThrow(/S26\.NOPE/)
  })

  it('points a pickup at the deposit it settles', async () => {
    // The sheet keeps the deposit and the collection on one row. The system
    // records it as it happened: money taken one day, gold handed over another.
    const b = await newBatch()
    await stage(b, 2, { txn_date: '2026-01-10', txn_type: 'DEPOSIT',
      gold_type_code: 'RP', uom: 'LUONG', qty: '1', amount: '0',
      partner_code: 'Kelvin Tran', payments: 'AR:CASH:2000', deposit_key: 'd-1' })
    await stage(b, 3, { txn_date: '2026-01-28', txn_type: 'PICKUP',
      gold_type_code: 'RP', uom: 'LUONG', qty: '-1', amount: '5310',
      partner_code: 'Kelvin Tran', payments: 'AR:CASH:3310', deposit_key: 'd-1' })
    await commit(b)
    const r = await db.query<{ dep: string; pick: string }>(
      `SELECT d.id::text AS dep, p.deposit_ref_id::text AS pick
         FROM pc49.import_row rp
         JOIN pc49.gold_txn p ON p.id = rp.committed_ref
         JOIN pc49.import_row rd ON rd.batch_id = rp.batch_id AND rd.row_no = 2
         JOIN pc49.gold_txn d ON d.id = rd.committed_ref
        WHERE rp.batch_id = $1 AND rp.row_no = 3`, [b])
    expect(r.rows[0].pick).toBe(r.rows[0].dep)
  })
})

describe('a batch reaches the books', () => {
  beforeAll(async () => {
    await db.query(`INSERT INTO pc49.accounting_period (period, status)
                    VALUES ('2026-03', 'OPEN') ON CONFLICT (period) DO NOTHING`)
  })

  it('posts every committed transaction, oldest first', async () => {
    const b = await newBatch()
    await stage(b, 2, { ...buy, txn_date: '2026-03-15', payments: 'AP:CASH:650' })
    await stage(b, 3, { ...buy, txn_date: '2026-03-16', payments: 'AP:CASH:650' })
    await commit(b)
    const bad = await db.query(`SELECT * FROM pc49.post_import_batch($1)`, [b])
    expect(bad.rows).toEqual([])
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn t
         JOIN pc49.import_row i ON i.committed_ref = t.id
        WHERE i.batch_id = $1 AND t.journal_entry_id IS NOT NULL`, [b])
    expect(Number(r.rows[0].n)).toBe(2)
  })

  it('names the row it could not post instead of stopping at it', async () => {
    // One bad row must not hold up the other 1,125. Whoever is loading needs
    // to know which row, by the line number it has in the spreadsheet.
    const b = await newBatch()
    await stage(b, 2, { ...buy, txn_date: '2026-03-17', payments: 'AP:CASH:650' })
    await stage(b, 3, { ...buy, txn_date: '2026-03-18' })
    await commit(b)
    const bad = await db.query<{ row_no: number; error: string }>(
      `SELECT row_no, error FROM pc49.post_import_batch($1)`, [b])
    expect(bad.rows).toHaveLength(1)
    expect(bad.rows[0].row_no).toBe(3)
    expect(bad.rows[0].error).toMatch(/no payments/i)
    const ok = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn t
         JOIN pc49.import_row i ON i.committed_ref = t.id
        WHERE i.batch_id = $1 AND t.journal_entry_id IS NOT NULL`, [b])
    expect(Number(ok.rows[0].n)).toBe(1)
  })

  it('is safe to run twice', async () => {
    const b = await newBatch()
    await stage(b, 2, { ...buy, txn_date: '2026-03-19', payments: 'AP:CASH:650' })
    await commit(b)
    await db.query(`SELECT * FROM pc49.post_import_batch($1)`, [b])
    const again = await db.query(`SELECT * FROM pc49.post_import_batch($1)`, [b])
    expect(again.rows).toEqual([])
  })
})
