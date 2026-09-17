import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDb } from '../support/db'
import { SIX_ITEMS, purchaseLine, receiptPayload } from '../support/receipt'

const KT = '11111111-1111-1111-1111-111111111111'

type Row = {
  receipt_key: string
  receipt_id: string | null
  doc_no: string
  line_count: number
  amount: string
  blocked_code: string | null
  total_count: string
  lines: { itemDesc: string | null; goldTypeCode: string; amount: number }[]
  payments: { seq: number; amount: number; method: string }[]
  sold_by: { code: string; sharePct: number }[]
}

type Filters = {
  from?: string; to?: string; type?: string; gold?: string; staff?: string
  method?: string; status?: string; query?: string; limit?: number | null; offset?: number
}
const ARGS = `p_from => $1, p_to => $2, p_type => $3, p_gold => $4, p_staff => $5,
              p_method => $6, p_status => $7, p_query => $8`
const params = (f: Filters) => [f.from ?? null, f.to ?? null, f.type ?? null, f.gold ?? null,
  f.staff ?? null, f.method ?? null, f.status ?? null, f.query ?? null]

let db: PGlite
const doc = { A: '', B: '', C: '', E: '' }
const key = { A: '', B: '', C: '', E: '' }

async function ledger(f: Filters = {}) {
  const r = await db.query<Row>(
    `SELECT receipt_key, receipt_id, doc_no, line_count, amount::text, blocked_code,
            total_count::text, lines, payments, sold_by
       FROM pc49.gold_receipt_ledger(${ARGS}, p_limit => $9, p_offset => $10)`,
    [...params(f), f.limit === undefined ? 50 : f.limit, f.offset ?? 0])
  return r.rows
}
const docs = async (f: Filters = {}) => (await ledger(f)).map((r) => r.doc_no)

async function save(k: string, body: string) {
  const r = await asRole(db, KT, () => db.query<{ r: { receiptId: string; docNo: string } }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [k, body]))
  return r.rows[0].r
}

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'accountant@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
  `)

  // A: a scrap ring and a bar, paid part in cash and part by wire.
  const a = await save('A', receiptPayload({
    txnDate: '2026-03-10', partnerCode: 'KHACH A',
    lines: [purchaseLine(SIX_ITEMS[0]), purchaseLine(SIX_ITEMS[2])],
    payments: [{ amount: 950, method: 'CASH' }, { amount: 1900, method: 'BANKWIRE' }],
  }))

  // B: saved the way everything was saved before receipts.
  const b = await asRole(db, KT, () => db.query<{ r: { txnId: string } }>(
    `SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`, ['B', JSON.stringify({
      txnDate: '2026-03-12', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM', qty: 10,
      unitPrice: 50, amount: -500, partnerCode: 'KHACH B', scrapDetail: null, goldPct: null,
      remarks: null, payments: [{ amount: 500, method: 'CASH' }],
      salesPeople: [{ code: 'P.Minh', sharePct: 100 }],
    })]))
  const bId = b.rows[0].r.txnId

  // C: one Rong Phung sold.
  const c = await save('C', receiptPayload({
    txnDate: '2026-03-15', txnType: 'SALE', partnerCode: 'KHACH C',
    lines: [{ itemDesc: 'RP 1 luong', goldTypeCode: 'RP', uom: 'LUONG', qty: -1,
              unitPrice: 5000, amount: 5000, scrapDetail: null, goldPct: null }],
    payments: [{ amount: 5000, method: 'ZELLE' }],
  }))

  // D: typed twice and cancelled, so never listed.
  const d = await save('D', receiptPayload({
    txnDate: '2026-03-20', partnerCode: 'KHACH D',
    lines: [purchaseLine(SIX_ITEMS[1])], payments: [{ amount: 825, method: 'CASH' }],
  }))
  await asRole(db, KT, () => db.query(
    `SELECT pc49.void_gold_receipt($1, 'nhap trung')`, [d.receiptId]))

  // E: two scrap items, the second already picked into a refining lot.
  const e = await save('E', receiptPayload({
    txnDate: '2026-03-25', partnerCode: 'KHACH E',
    lines: [purchaseLine(SIX_ITEMS[1]), purchaseLine(SIX_ITEMS[5])],
    payments: [{ amount: 861, method: 'CASH' }],
  }))
  const second = await db.query<{ id: string }>(
    `SELECT id FROM pc49.gold_txn WHERE receipt_id = $1 AND line_no = 2`, [e.receiptId])
  const lot = await db.query<{ id: string }>(
    `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.LEDGER') RETURNING id`)
  await db.query(`INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`,
    [lot.rows[0].id, second.rows[0].id])

  const bDoc = await db.query<{ doc_no: string }>(
    `SELECT doc_no FROM pc49.gold_txn WHERE id = $1`, [bId])
  Object.assign(doc, { A: a.docNo, B: bDoc.rows[0].doc_no, C: c.docNo, E: e.docNo })
  Object.assign(key, { A: a.receiptId, B: bId, C: c.receiptId, E: e.receiptId })
}, 180_000)

afterAll(async () => { await db?.close() })

describe('the ledger, one receipt a row', () => {
  it('lists receipts newest first, an older transaction as one item, never a cancelled one', async () => {
    const rows = await ledger()
    expect(rows.map((r) => r.doc_no)).toEqual([doc.E, doc.C, doc.B, doc.A])
    expect(rows.map((r) => r.line_count)).toEqual([2, 1, 1, 2])
    expect(rows.map((r) => r.receipt_key)).toEqual([key.E, key.C, key.B, key.A])
    expect(rows[2].receipt_id).toBeNull()
  })

  it('carries the items, what they come to, and what was paid by each method', async () => {
    const [a] = await ledger({ query: doc.A })
    expect(a.lines.map((l) => l.itemDesc)).toEqual(['Nhẫn 24K (vụn)', 'Thỏi RCM'])
    expect(Number(a.amount)).toBe(-2850)
    expect(a.payments.map((p) => `${Number(p.amount)} ${p.method}`))
      .toEqual(['950 CASH', '1900 BANKWIRE'])
    expect(a.sold_by.map((p) => `${p.code} ${Number(p.sharePct)}`))
      .toEqual(['L.Thanh 80', 'P.Minh 20'])
  })

  it('finds a receipt by any one of its items, and shows all of them', async () => {
    const bars = await ledger({ gold: 'GRAIN' })
    expect(bars.map((r) => r.doc_no)).toEqual([doc.A])
    expect(bars[0].lines).toHaveLength(2)
    expect(await docs({ method: 'BANKWIRE' })).toEqual([doc.A])
    expect(await docs({ staff: 'P.Minh' })).toEqual([doc.E, doc.C, doc.B, doc.A])
  })

  it('searches what the items are called, without accents', async () => {
    expect(await docs({ query: 'thoi rcm' })).toEqual([doc.A])
  })

  it('locks a whole receipt when one of its items cannot be corrected', async () => {
    expect(await docs({ status: 'locked' })).toEqual([doc.E])
    expect(await docs({ status: 'correctable' })).toEqual([doc.C, doc.B, doc.A])
    expect((await ledger({ query: doc.E }))[0].blocked_code).toBe('REFINING_SOURCE')
  })

  it('pages by receipts and counts receipts', async () => {
    const page = await ledger({ limit: 2, offset: 0 })
    expect(page.map((r) => r.doc_no)).toEqual([doc.E, doc.C])
    expect(page.every((r) => r.total_count === '4')).toBe(true)
  })

  it('totals the items as before and counts receipts', async () => {
    const all = await db.query<{ n: string; purchases: string; sales: string }>(
      `SELECT receipt_count::text AS n, purchases::text, sales::text
         FROM pc49.gold_receipt_ledger_totals(${ARGS})`, params({}))
    expect(all.rows[0].n).toBe('4')
    expect(Number(all.rows[0].purchases)).toBe(2850 + 500 + 861)
    expect(Number(all.rows[0].sales)).toBe(5000)

    const bars = await db.query<{ n: string; purchases: string }>(
      `SELECT receipt_count::text AS n, purchases::text
         FROM pc49.gold_receipt_ledger_totals(${ARGS})`, params({ gold: 'GRAIN' }))
    expect(bars.rows[0].n).toBe('1')
    expect(Number(bars.rows[0].purchases)).toBe(1900)
  })

  it('checks each item inside the query rather than calling a function per row', async () => {
    const plan = await db.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT count(*) FROM pc49.gold_txn t
        WHERE pc49.gold_receipt_ledger_match(t, NULL::date, NULL::date, NULL, NULL, NULL, NULL, NULL, NULL)`)
    expect(plan.rows.map((r) => r['QUERY PLAN']).join(' ')).not.toContain('gold_receipt_ledger_match')
  })

  it('is read with the permissions of the person asking', async () => {
    const r = await asRole(db, KT, () => db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt_ledger()`))
    expect(r.rows[0].n).toBe('4')
  })
})
