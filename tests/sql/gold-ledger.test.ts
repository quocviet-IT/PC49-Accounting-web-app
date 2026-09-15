import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, createTestDb } from '../support/db'

const CLERK = '00000000-0000-0000-0000-0000000000c1'

// Every Vietnamese vowel carrying a mark, lower case then capitals, and đ/Đ —
// the same list, in the same order, the migration folds.
const MARKED =
  'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ'
  + 'ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ'
const PLAIN = ('a'.repeat(17) + 'e'.repeat(11) + 'i'.repeat(5) + 'o'.repeat(17)
  + 'u'.repeat(11) + 'y'.repeat(5) + 'd').repeat(2)

type Row = { id: string; doc_no: string; total_count: string; blocked_reason: string | null }

let db: PGlite

async function txn(v: {
  date: string; doc: string; type: string; gold: string; uom: string; qty: number
  amount: number; price?: number | null; partner?: string | null; remarks?: string | null
  depositRef?: string | null
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn (txn_date, doc_no, txn_type, gold_type_code, uom, qty,
                                unit_price, amount, partner_code, remarks, deposit_ref_id)
     VALUES ($1, $2, $3::pc49.txn_type, $4, $5::pc49.uom, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [v.date, v.doc, v.type, v.gold, v.uom, v.qty, v.price ?? null, v.amount,
     v.partner ?? null, v.remarks ?? null, v.depositRef ?? null])
  return r.rows[0].id
}

type Filters = {
  from?: string; to?: string; type?: string; gold?: string; staff?: string
  method?: string; status?: string; query?: string; limit?: number | null; offset?: number
}
const ARGS = `p_from => $1, p_to => $2, p_type => $3, p_gold => $4, p_staff => $5,
              p_method => $6, p_status => $7, p_query => $8`
const params = (f: Filters) => [f.from ?? null, f.to ?? null, f.type ?? null, f.gold ?? null,
  f.staff ?? null, f.method ?? null, f.status ?? null, f.query ?? null]

async function ledger(f: Filters = {}) {
  const r = await db.query<Row>(
    `SELECT id, doc_no, total_count::text, blocked_reason
       FROM pc49.gold_txn_ledger(${ARGS}, p_limit => $9, p_offset => $10)`,
    [...params(f), f.limit === undefined ? 50 : f.limit, f.offset ?? 0])
  return r.rows
}
const docs = async (f: Filters = {}) => (await ledger(f)).map((r) => r.doc_no)

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${CLERK}', 'clerk@example.com');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${CLERK}', 'Clerk', 'KT');
    INSERT INTO pc49.sales_person (code, full_name)
      VALUES ('AN', 'An'), ('BINH', 'Binh'), ('CHI', 'Chi') ON CONFLICT (code) DO NOTHING;
    INSERT INTO pc49.partner (code, phone)
      VALUES ('KHÁNH', '090 123 4567'), ('MINH', '091 000 0000')
      ON CONFLICT (code) DO UPDATE SET phone = excluded.phone;
  `)

  const po1 = await txn({ date: '2026-01-05', doc: 'PO-001', type: 'PO', gold: 'SG', uom: 'GRAM',
    qty: 10, price: 100, amount: -1000, partner: 'KHÁNH', remarks: 'Giao tại quầy' })
  await db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                  VALUES ($1, 1, 'AP', 1000, 'CASH')`, [po1])
  await db.query(`INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct)
                  VALUES ($1, 'AN', 100)`, [po1])

  const sale = await txn({ date: '2026-01-20', doc: 'SALE-778', type: 'SALE', gold: 'RP', uom: 'LUONG',
    qty: -1, price: 5000, amount: 5000, partner: 'MINH', remarks: 'Đã giao' })
  await db.query(`INSERT INTO pc49.gold_txn_payment (txn_id, seq, direction, amount, method)
                  VALUES ($1, 1, 'AR', 5000, 'BANKWIRE')`, [sale])
  await db.query(`INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct)
                  VALUES ($1, 'BINH', 80), ($1, 'CHI', 20)`, [sale])

  await txn({ date: '2026-01-31', doc: 'PO-002', type: 'PO_VENDOR', gold: 'SG', uom: 'GRAM',
    qty: 5, price: 90, amount: -450 })
  await txn({ date: '2026-02-01', doc: 'PO-003', type: 'PO', gold: 'SG', uom: 'GRAM',
    qty: 2, price: 80, amount: -160 })

  // A deposit and its pickup: neither may be corrected on its own (0055).
  const dep = await txn({ date: '2026-01-10', doc: 'DEP-001', type: 'DEPOSIT', gold: 'RP',
    uom: 'LUONG', qty: -1, amount: 550, partner: 'MINH' })
  await txn({ date: '2026-01-15', doc: 'PU-001', type: 'PICKUP', gold: 'RP', uom: 'LUONG',
    qty: -1, amount: 4760, partner: 'MINH', depositRef: dep })

  // Cancelled the proper way: it must never appear in the ledger.
  const gone = await txn({ date: '2026-01-12', doc: 'PO-VOID', type: 'PO', gold: 'SG', uom: 'GRAM',
    qty: 1, price: 10, amount: -10 })
  await db.query(`SELECT pc49.void_gold_txn($1, 'typed twice')`, [gone])
}, 180_000)
afterAll(async () => { await db?.close() })

describe('search that forgives accents, case and punctuation', () => {
  it('folds every marked vowel and đ to its plain letter', async () => {
    const r = await db.query<{ f: string }>(`SELECT pc49.fold_search($1) AS f`, [MARKED])
    expect(r.rows[0].f).toBe(PLAIN)
  })

  it('reads a name, a phone number and a document number the way people type them', async () => {
    const r = await db.query<{ a: string; b: string; c: string; d: string }>(
      `SELECT pc49.fold_search('KHÁNH') AS a, pc49.fold_search('090 123 4567') AS b,
              pc49.fold_search('PO-001') AS c, pc49.fold_search(NULL) AS d`)
    expect(r.rows[0]).toEqual({ a: 'khanh', b: '0901234567', c: 'po001', d: '' })
  })
})

describe('the gold ledger', () => {
  it('lists every live transaction, newest first, and never a cancelled one', async () => {
    expect(await docs()).toEqual(['PO-003', 'PO-002', 'SALE-778', 'PU-001', 'DEP-001', 'PO-001'])
  })

  it('takes a date range inclusive of both ends', async () => {
    expect(await docs({ from: '2026-01-05', to: '2026-01-31' }))
      .toEqual(['PO-002', 'SALE-778', 'PU-001', 'DEP-001', 'PO-001'])
    expect(await docs({ from: '2026-02-01' })).toEqual(['PO-003'])
    expect(await docs({ to: '2026-01-05' })).toEqual(['PO-001'])
  })

  it('filters by type and by gold', async () => {
    expect(await docs({ type: 'PO' })).toEqual(['PO-003', 'PO-001'])
    expect(await docs({ gold: 'RP' })).toEqual(['SALE-778', 'PU-001', 'DEP-001'])
  })

  it('finds a person on an order whether they lead it or hold a share', async () => {
    expect(await docs({ staff: 'CHI' })).toEqual(['SALE-778'])
    expect(await docs({ staff: 'AN' })).toEqual(['PO-001'])
  })

  it('filters by how an order was paid', async () => {
    expect(await docs({ method: 'BANKWIRE' })).toEqual(['SALE-778'])
  })

  it('searches document, customer, phone and remarks without accents', async () => {
    for (const query of ['po-001', 'khanh', '0901234567', 'giao tai']) {
      expect(await docs({ query })).toEqual(['PO-001'])
    }
    expect(await docs({ query: 'da giao' })).toEqual(['SALE-778'])
  })

  it('treats a search of nothing but punctuation as no search at all', async () => {
    expect(await docs({ query: ' - ' })).toEqual(await docs())
  })

  it('checks each transaction inside the query rather than calling a function per row', async () => {
    // A SQL function that sets its own search_path is never inlined, so
    // PostgreSQL called the predicate once per transaction: on 1062 rows that
    // was about 75 ms of the page's 104 and 63 of the totals' 84 (15-09).
    const plan = await db.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT count(*) FROM pc49.gold_txn t
        WHERE pc49.gold_txn_ledger_match(t, NULL::date, NULL::date, NULL, NULL, NULL, NULL, NULL, NULL)`)
    expect(plan.rows.map((r) => r['QUERY PLAN']).join(' ')).not.toContain('gold_txn_ledger_match')
  })

  it('separates what may be corrected from what may not', async () => {
    expect(await docs({ status: 'locked' })).toEqual(['PU-001', 'DEP-001'])
    expect(await docs({ status: 'correctable' })).toEqual(['PO-003', 'PO-002', 'SALE-778', 'PO-001'])
    const rows = await ledger({ query: 'DEP-001' })
    expect(rows[0].blocked_reason).toMatch(/pickup/)
  })

  it('pages without changing the count of what matched', async () => {
    const page2 = await ledger({ limit: 2, offset: 2 })
    expect(page2.map((r) => r.doc_no)).toEqual(['SALE-778', 'PU-001'])
    expect(page2.every((r) => r.total_count === '6')).toBe(true)
    expect(await docs({ limit: null })).toHaveLength(6)
  })

  it('totals what the filter matched, purchases and sales as money that changed hands', async () => {
    const r = await db.query<{ n: string; purchases: string; sales: string; grams: Record<string, number> }>(
      `SELECT transaction_count::text AS n, purchases::text, sales::text, grams_by_gold AS grams
         FROM pc49.gold_txn_ledger_totals(${ARGS})`, params({ to: '2026-01-31' }))
    expect(r.rows[0].n).toBe('5')
    expect(Number(r.rows[0].purchases)).toBe(1450)
    expect(Number(r.rows[0].sales)).toBe(9760)
    expect(Number(r.rows[0].grams.SG)).toBe(15)
    expect(Number(r.rows[0].grams.RP)).toBe(-112.5)
  })

  it('is read with the permissions of the person asking', async () => {
    const r = await asRole(db, CLERK, () => db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_txn_ledger()`))
    expect(r.rows[0].n).toBe('6')
  })
})
