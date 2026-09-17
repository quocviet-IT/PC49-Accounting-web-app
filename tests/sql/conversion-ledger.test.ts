import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDb } from '../support/db'
import { NINI, conversionPayload } from '../support/conversion'
import { SIX_ITEMS, purchaseLine, receiptPayload } from '../support/receipt'

const KT = '11111111-1111-1111-1111-111111111111'

type Row = {
  receipt_key: string; doc_no: string; txn_type: string; partner_code: string | null
  remarks: string | null; revision: number; blocked_code: string | null; amount: string
  line_count: number; total_count: string
  lines: { lineNo: number; side: string | null; goldTypeCode: string }[]
  conversion_id: string | null; conversion_kind: string | null
  variance_note: string | null; variance_reason: string | null
}

type Filters = {
  from?: string; to?: string; type?: string; gold?: string; staff?: string
  method?: string; status?: string; query?: string
}
const ARGS = `p_from => $1, p_to => $2, p_type => $3, p_gold => $4, p_staff => $5,
              p_method => $6, p_status => $7, p_query => $8`
const params = (f: Filters) => [f.from ?? null, f.to ?? null, f.type ?? null, f.gold ?? null,
  f.staff ?? null, f.method ?? null, f.status ?? null, f.query ?? null]

let db: PGlite
const doc = { R: '', B: '', N: '', V: '', I: 'PC49-2604-900', L: 'PC49-2604-950' }
const key = { N: '', I: '' }

async function ledger(f: Filters = {}) {
  const r = await db.query<Row>(
    `SELECT receipt_key, doc_no, txn_type, partner_code, remarks, revision, blocked_code,
            amount::text, line_count, total_count::text, lines,
            conversion_id, conversion_kind, variance_note, variance_reason
       FROM pc49.gold_receipt_ledger(${ARGS})`, params(f))
  return r.rows
}
const docs = async (f: Filters = {}) => (await ledger(f)).map((r) => r.doc_no)
const row = async (docNo: string) => (await ledger()).find((r) => r.doc_no === docNo) as Row

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'accountant@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
  `)
  const call = async <T>(sql: string, args: unknown[]) =>
    (await asRole(db, KT, () => db.query<{ r: T }>(sql, args))).rows[0].r

  // R: a receipt of one item.
  const r = await call<{ docNo: string }>(`SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, ['R',
    receiptPayload({ txnDate: '2026-04-10', partnerCode: 'KHACH R', lines: [purchaseLine(SIX_ITEMS[0])],
                     payments: [{ amount: 950, method: 'CASH' }] })])
  // B: a transaction saved before receipts.
  const b = await call<{ txnId: string }>(`SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`, ['B',
    JSON.stringify({ txnDate: '2026-04-11', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM', qty: 10,
      unitPrice: 50, amount: -500, partnerCode: 'KHACH B', scrapDetail: null, goldPct: null,
      remarks: null, payments: [{ amount: 500, method: 'CASH' }], salesPeople: [] })])
  // N: the Nini exchange.
  const n = await call<{ conversionId: string; docNo: string }>(
    `SELECT pc49.save_gold_conversion($1, $2::jsonb) AS r`,
    ['N', conversionPayload(NINI, { convDate: '2026-04-12', note: 'doi voi Nini' })])
  // V: a melt that came up short, explained.
  const v = await call<{ docNo: string }>(`SELECT pc49.save_gold_conversion($1, $2::jsonb) AS r`, ['V',
    conversionPayload({ kind: 'TRANSFER',
      out: [{ goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 1000 }],
      in: [{ goldTypeCode: 'PT', uom: 'GRAM', qty: 900 }] },
    { convDate: '2026-04-14', varianceReason: 'hao hut' })])

  // I: a conversion as the loader wrote it: no number of its own, each leg its own number.
  const i = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_conversion (conv_date, kind, note)
     VALUES ('2026-04-15', 'TRANSFER', '2026-04-15#1') RETURNING id`)
  for (const [type, gold, uom, qty, d] of [
    ['TRANSFER_OUT', '9999', 'LUONG', -1, 'PC49-2604-901'],
    ['TRANSFER_IN', 'GRAIN', 'GRAM', 37.5, 'PC49-2604-900'],
  ] as const) {
    await db.query(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount,
                                  conversion_id, doc_no, remarks)
       VALUES ('2026-04-15', $1, $2, $3, $4, 0, $5, $6, 'Transfer 1L vang 9999 ra 37.5gr vang Grain')`,
      [type, gold, uom, qty, i.rows[0].id, d])
  }

  // L: a refining lot's transfer out, a row of its own.
  const lot = await db.query<{ id: string }>(
    `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.CONV') RETURNING id`)
  await db.query(
    `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount, refining_lot_id, doc_no)
     VALUES ('2026-04-16', 'TRANSFER_OUT', 'SG', 'GRAM', -30, 0, $1, 'PC49-2604-950')`, [lot.rows[0].id])

  const bDoc = await db.query<{ doc_no: string }>(`SELECT doc_no FROM pc49.gold_txn WHERE id = $1`, [b.txnId])
  Object.assign(doc, { R: r.docNo, B: bDoc.rows[0].doc_no, N: n.docNo, V: v.docNo })
  Object.assign(key, { N: n.conversionId, I: i.rows[0].id })
}, 180_000)

afterAll(async () => { await db?.close() })

describe('the ledger, a conversion a row', () => {
  it('lists each conversion once, beside receipts and single rows', async () => {
    const rows = await ledger()
    expect(rows.map((r) => r.doc_no)).toEqual([doc.L, doc.I, doc.V, doc.N, doc.B, doc.R])
    expect(rows.map((r) => r.line_count)).toEqual([1, 2, 2, 4, 1, 1])
    expect(rows.map((r) => r.conversion_id !== null)).toEqual([false, true, true, true, false, false])
  })

  it('shows a conversion by its own number, partner and note, its legs by side', async () => {
    const n = await row(doc.N)
    expect(n).toMatchObject({
      receipt_key: key.N, conversion_kind: 'TRANSFER', partner_code: 'Nini',
      remarks: 'doi voi Nini', variance_note: null,
    })
    expect(Number(n.amount)).toBe(0)
    expect(n.lines.map((l) => [l.side, l.lineNo, l.goldTypeCode])).toEqual([
      ['out', 1, 'RP'], ['in', 1, 'CS'], ['in', 2, 'OTH'], ['in', 3, 'GRAIN'],
    ])
  })

  it('carries the variance and the reason given for it', async () => {
    const v = await row(doc.V)
    expect(v.variance_note).toMatch(/percent difference/)
    expect(v.variance_reason).toBe('hao hut')
  })

  it('shows a loaded conversion by its smallest number and its legs’ remarks', async () => {
    const i = await row(doc.I)
    expect(i).toMatchObject({
      receipt_key: key.I, remarks: 'Transfer 1L vang 9999 ra 37.5gr vang Grain', revision: 1,
    })
  })

  it('lets a conversion be corrected as a whole, and locks a refining lot leg', async () => {
    expect((await row(doc.N)).blocked_code).toBeNull()
    expect((await row(doc.I)).blocked_code).toBeNull()
    expect((await row(doc.L)).blocked_code).toBe('REFINING_LEG')
    expect(await docs({ status: 'locked' })).toEqual([doc.L])
    expect(await docs({ status: 'correctable' })).toEqual([doc.I, doc.V, doc.N, doc.B, doc.R])
  })

  it('finds a conversion by any one of its legs', async () => {
    expect(await docs({ gold: 'CS' })).toEqual([doc.N])
    expect(await docs({ query: 'nini' })).toEqual([doc.N])
    expect(await docs({ type: 'TRANSFER_IN' })).toEqual([doc.I, doc.V, doc.N])
  })

  it('counts a conversion once', async () => {
    expect((await ledger())[0].total_count).toBe('6')
    const totals = await db.query<{ n: string }>(
      `SELECT receipt_count::text AS n FROM pc49.gold_receipt_ledger_totals(${ARGS})`, params({}))
    expect(totals.rows[0].n).toBe('6')
  })

  it('checks each line inside the query rather than calling a function per row', async () => {
    const plan = await db.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT count(*) FROM pc49.gold_txn t
        WHERE pc49.gold_receipt_ledger_match(t, NULL::date, NULL::date, NULL, NULL, NULL, NULL, NULL, NULL)`)
    expect(plan.rows.map((r) => r['QUERY PLAN']).join(' ')).not.toContain('gold_receipt_ledger_match')
  })

  it('does not let the receipt functions cancel a conversion', async () => {
    await expect(asRole(db, KT, () => db.query(
      `SELECT pc49.void_gold_receipt($1, 'nham cho')`, [key.N]))).rejects.toThrow(/LINE_BLOCKED/)
  })
})
