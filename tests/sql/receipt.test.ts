import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'
import { SIX_ITEMS, purchaseLine, receiptPayload } from '../support/receipt'

let db: PGlite
const KT = '11111111-1111-1111-1111-111111111111'
const GS = '22222222-2222-2222-2222-222222222222'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email)
      VALUES ('${KT}', 'accountant@ctyhp.vn'), ('${GS}', 'supervisor@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role)
      VALUES ('${KT}', 'Ke toan', 'KT'), ('${GS}', 'Giam sat', 'GS_US');
  `)
}, 60_000)

afterAll(async () => { await db?.close() })

/** The division as "amount method" per item, so a failure reads like the paper. */
async function allocate(amounts: number[], payments: { amount: number; method: string }[]) {
  const r = await db.query<{ a: { amount: number | string; method: string }[][] }>(
    `SELECT pc49.allocate_receipt_payments($1::numeric[], $2::jsonb) AS a`,
    [`{${amounts.join(',')}}`, JSON.stringify(payments)])
  return r.rows[0].a.map((line) => line.map((p) => `${Number(p.amount)} ${p.method}`))
}

describe('what the customer paid, divided between the items', () => {
  it('fills the items in order, as the example in the design', async () => {
    expect(await allocate([-950, -825, -1900, -4125, -525, -36],
      [{ amount: 5000, method: 'CASH' }, { amount: 3361, method: 'BANKWIRE' }]))
      .toEqual([['950 CASH'], ['825 CASH'], ['1900 CASH'],
        ['1325 CASH', '2800 BANKWIRE'], ['525 BANKWIRE'], ['36 BANKWIRE']])
  })

  it('leaves money paid over the total on the last item', async () => {
    expect(await allocate([-100, -50], [{ amount: 200, method: 'CASH' }]))
      .toEqual([['100 CASH'], ['100 CASH']])
  })

  it('leaves the last items short when too little was paid', async () => {
    expect(await allocate([-100, -50, -30], [{ amount: 120, method: 'CASH' }]))
      .toEqual([['100 CASH'], ['20 CASH'], []])
  })

  it('divides nothing when nothing was paid', async () => {
    expect(await allocate([-100, -50], [])).toEqual([[], []])
  })
})

describe('the receipt and its lines', () => {
  it('lets accounting write a receipt and a line that belongs to it', async () => {
    const made = await asRole(db, KT, async () => {
      const receipt = await db.query<{ id: string }>(
        `INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type, partner_code)
         VALUES ('PC49-2606-900', '2026-06-02', 'PO', 'KHACH') RETURNING id`)
      const line = await db.query<{ r: { txnId: string } }>(
        `SELECT pc49.write_gold_transaction($1::jsonb) AS r`,
        [JSON.stringify({
          txnDate: '2026-06-02', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM',
          qty: 9.4, unitPrice: 101.06382979, amount: -950, partnerCode: 'KHACH',
          payments: [{ amount: 950, method: 'CASH' }], salesPeople: [],
          docNo: 'PC49-2606-900', receiptId: receipt.rows[0].id, lineNo: 1,
          itemDesc: 'Nhẫn 24K (vụn)',
        })])
      return { receiptId: receipt.rows[0].id, txnId: line.rows[0].r.txnId }
    })
    const row = await db.query<{ doc_no: string; receipt_id: string; line_no: number; item_desc: string }>(
      `SELECT doc_no, receipt_id, line_no, item_desc FROM pc49.gold_txn WHERE id = $1`, [made.txnId])
    expect(row.rows[0]).toEqual({
      doc_no: 'PC49-2606-900', receipt_id: made.receiptId, line_no: 1, item_desc: 'Nhẫn 24K (vụn)',
    })
  })

  it('numbers a line written without a receipt exactly as before', async () => {
    const r = await asRole(db, KT, () => db.query<{ r: { txnId: string } }>(
      `SELECT pc49.write_gold_transaction($1::jsonb) AS r`,
      [JSON.stringify({
        txnDate: '2026-06-02', txnType: 'PO', goldTypeCode: 'SG', uom: 'GRAM',
        qty: 2, unitPrice: 50, amount: -100,
        payments: [{ amount: 100, method: 'CASH' }], salesPeople: [],
      })]))
    const row = await db.query<{ doc_no: string; receipt_id: string | null; line_no: number | null }>(
      `SELECT doc_no, receipt_id, line_no FROM pc49.gold_txn WHERE id = $1`, [r.rows[0].r.txnId])
    expect(row.rows[0].doc_no).toMatch(/^PC49-2606-\d{3}$/)
    expect(row.rows[0].receipt_id).toBeNull()
    expect(row.rows[0].line_no).toBeNull()
  })

  it('lets anyone signed in read receipts, and only accounting write them', async () => {
    await db.query(`INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type)
                    VALUES ('PC49-2606-901', '2026-06-02', 'PO')`)
    const seen = await asRole(db, GS, () => db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt`))
    expect(Number(seen.rows[0].n)).toBeGreaterThan(0)
    await expect(asRole(db, GS, () => db.query(
      `INSERT INTO pc49.gold_receipt (doc_no, txn_date, txn_type)
       VALUES ('X', '2026-06-02', 'PO')`))).rejects.toThrow(/row-level security/)
  })
})

type Saved = { receiptId: string; docNo: string; repeated: boolean }

async function saveReceipt(key: string, body: string, as = KT): Promise<Saved> {
  const r = await asRole(db, as, () => db.query<{ r: Saved }>(
    `SELECT pc49.save_gold_receipt($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

/** Each item's payments as "amount method + amount method", in item order. */
async function paidPerItem(receiptId: string) {
  const r = await db.query<{ paid: string }>(
    `SELECT coalesce(string_agg(gp.amount::float8::text || ' ' || gp.method::text, ' + '
                                ORDER BY gp.seq), '') AS paid
       FROM pc49.gold_txn t
       LEFT JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
      WHERE t.receipt_id = $1
      GROUP BY t.line_no ORDER BY t.line_no`, [receiptId])
  return r.rows.map((row) => row.paid)
}

describe('saving a receipt of several items', () => {
  it('writes one receipt and six items under one number, every item posted', async () => {
    const saved = await saveReceipt('six-items', receiptPayload({ partnerCode: 'SIX' }))
    const receipt = await db.query<{ doc_no: string; txn_type: string; partner_code: string }>(
      `SELECT doc_no, txn_type::text, partner_code FROM pc49.gold_receipt WHERE id = $1`,
      [saved.receiptId])
    expect(receipt.rows[0]).toEqual({ doc_no: saved.docNo, txn_type: 'PO', partner_code: 'SIX' })

    const lines = await db.query<{
      line_no: number; doc_no: string; item_desc: string; amount: string; posted: boolean
    }>(
      `SELECT line_no, doc_no, item_desc, amount::text, journal_entry_id IS NOT NULL AS posted
         FROM pc49.gold_txn WHERE receipt_id = $1 ORDER BY line_no`, [saved.receiptId])
    expect(lines.rows.map((l) => l.line_no)).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(lines.rows.map((l) => l.doc_no))).toEqual(new Set([saved.docNo]))
    expect(lines.rows.map((l) => l.item_desc)).toEqual(SIX_ITEMS.map((i) => i.itemDesc))
    expect(lines.rows.reduce((sum, l) => sum + Number(l.amount), 0)).toBe(-8361)
    expect(lines.rows.every((l) => l.posted)).toBe(true)
  })

  it('divides the payments as the design says, to the cent', async () => {
    const saved = await saveReceipt('six-paid', receiptPayload({ partnerCode: 'PAID' }))
    expect(await paidPerItem(saved.receiptId)).toEqual([
      '950 CASH', '825 CASH', '1900 CASH', '1325 CASH + 2800 BANKWIRE', '525 BANKWIRE', '36 BANKWIRE',
    ])
    const byMethod = await db.query<{ method: string; total: string }>(
      `SELECT gp.method::text AS method, sum(gp.amount)::float8::text AS total
         FROM pc49.gold_txn t JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
        WHERE t.receipt_id = $1 GROUP BY gp.method ORDER BY gp.method::text`, [saved.receiptId])
    expect(byMethod.rows).toEqual([
      { method: 'BANKWIRE', total: '3361' }, { method: 'CASH', total: '5000' },
    ])
  })

  it('leaves an overpayment on the last item, as a single transaction would', async () => {
    const saved = await saveReceipt('six-over', receiptPayload({
      partnerCode: 'OVER', payments: [{ amount: 9000, method: 'CASH' }],
    }))
    expect((await paidPerItem(saved.receiptId))[5]).toBe('675 CASH')
  })

  it('refuses a purchase whose payments never reach an item, and names the item', async () => {
    const count = async () => (await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt`)).rows[0].n
    const before = await count()
    await expect(saveReceipt('six-short', receiptPayload({
      partnerCode: 'SHORT', payments: [{ amount: 8000, method: 'CASH' }],
    }))).rejects.toThrow(/PAYMENT_SHORT: item 6/)
    expect(await count()).toBe(before)
  })

  it('credits the same people with the same shares on every item', async () => {
    const saved = await saveReceipt('six-staff', receiptPayload({ partnerCode: 'STAFF' }))
    const shares = await db.query<{ who: string }>(
      `SELECT string_agg(s.sales_person_code || ' ' || s.share_pct::float8::text, ', '
                         ORDER BY s.share_pct DESC) AS who
         FROM pc49.gold_txn t JOIN pc49.gold_txn_sales_person s ON s.txn_id = t.id
        WHERE t.receipt_id = $1 GROUP BY t.line_no ORDER BY t.line_no`, [saved.receiptId])
    expect(shares.rows.map((r) => r.who)).toEqual(Array(6).fill('L.Thanh 80, P.Minh 20'))
  })

  it('is one receipt however many times it is saved', async () => {
    const body = receiptPayload({ partnerCode: 'TWICE' })
    const first = await saveReceipt('six-twice', body)
    const again = await saveReceipt('six-twice', body)
    expect(first.repeated).toBe(false)
    expect(again).toEqual({ receiptId: first.receiptId, docNo: first.docNo, repeated: true })
    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.gold_receipt WHERE partner_code = 'TWICE'`)
    expect(n.rows[0].n).toBe('1')
  })

  it('refuses the same key for a different receipt', async () => {
    await saveReceipt('six-reused', receiptPayload({ partnerCode: 'REUSED' }))
    await expect(saveReceipt('six-reused', receiptPayload({ partnerCode: 'REUSED', remarks: 'khac' })))
      .rejects.toThrow(/REQUEST_KEY_REUSED/)
  })

  it('keeps a deposit to one item', async () => {
    const two = [SIX_ITEMS[0], SIX_ITEMS[1]].map(purchaseLine)
    await expect(saveReceipt('deposit-two', receiptPayload({
      partnerCode: 'DEP', txnType: 'DEPOSIT', lines: two,
    }))).rejects.toThrow(/RECEIPT_SINGLE/)
  })

  it('holds thirty items at most', async () => {
    const many = Array.from({ length: 31 }, () => purchaseLine(SIX_ITEMS[4]))
    await expect(saveReceipt('thirty-one', receiptPayload({
      partnerCode: 'MANY', lines: many, payments: [{ amount: 31 * 525, method: 'CASH' }],
    }))).rejects.toThrow(/RECEIPT_SIZE/)
  })

  it('refuses items that move in both directions', async () => {
    const memo = {
      itemDesc: 'x', goldTypeCode: 'SG', uom: 'GRAM', unitPrice: null, amount: 0,
      scrapDetail: null, goldPct: null,
    }
    await expect(saveReceipt('both-ways', receiptPayload({
      partnerCode: 'WAYS', txnType: 'MEMO', payments: [],
      lines: [{ ...memo, qty: 5 }, { ...memo, qty: -5 }],
    }))).rejects.toThrow(/RECEIPT_DIRECTION/)
  })

  it('is refused to somebody who may only read', async () => {
    await expect(saveReceipt('supervisor', receiptPayload({ partnerCode: 'GS' }), GS))
      .rejects.toThrow()
  })
})
