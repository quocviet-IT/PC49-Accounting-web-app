import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

/** Creates an entry, adds its lines, then tries to post it. */
async function postEntry(
  memo: string,
  lines: Array<{
    dr?: string
    cr?: string
    amount: number
    gold?: string
    uom?: 'GRAM' | 'OZ' | 'LUONG'
    qty?: number
    unitPrice?: number
  }>,
  entryDate = '2026-01-01',
): Promise<string> {
  const e = await db.query<{ id: string }>(
    `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
     VALUES ($1, to_char($1::date, 'YYYY-MM'), $2, 'MANUAL') RETURNING id`,
    [entryDate, memo],
  )
  const id = e.rows[0].id
  let seq = 0
  for (const l of lines) {
    seq += 1
    await db.query(
      `INSERT INTO pc49.journal_line
         (entry_id, seq, debit_account, credit_account, amount_usd,
          gold_type_code, uom, qty_native, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, seq, l.dr ?? null, l.cr ?? null, l.amount,
       l.gold ?? null, l.uom ?? null, l.qty ?? null, l.unitPrice ?? null],
    )
  }
  await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`, [id])
  return id
}

describe('journal balance', () => {
  it('accepts an entry whose line names both accounts', async () => {
    const id = await postEntry('sale of 1 luong VRP', [
      { dr: '131', cr: '511', amount: 5310 },
    ])
    const r = await db.query<{ posted: string | null }>(
      `SELECT posted_at::text AS posted FROM pc49.journal_entry WHERE id = $1`, [id],
    )
    expect(r.rows[0].posted).not.toBeNull()
  })

  it('refuses to post a one-sided entry', async () => {
    await expect(
      postEntry('opening balance with no counterpart', [{ dr: '1388', amount: 280270 }]),
    ).rejects.toThrow(/does not balance/i)
  })

  it('accepts a one-sided line once a companion line balances it', async () => {
    const id = await postEntry('opening balance against owner capital', [
      { dr: '1388', amount: 280270 },
      { cr: '4111', amount: 280270 },
    ])
    const r = await db.query<{ bal: string }>(
      `SELECT pc49.entry_balance($1)::text AS bal`, [id],
    )
    expect(Number(r.rows[0].bal)).toBe(0)
  })

  it('refuses an entry whose sides differ by a cent', async () => {
    await expect(
      postEntry('off by one cent', [
        { dr: '1388', amount: 100.00 },
        { cr: '4111', amount: 100.01 },
      ]),
    ).rejects.toThrow(/does not balance/i)
  })

  it('refuses a line naming neither account', async () => {
    await expect(
      postEntry('no accounts at all', [{ amount: 100 }]),
    ).rejects.toThrow(/journal_line_needs_an_account/)
  })
})

describe('the second unit', () => {
  it('carries weight alongside money on the same line', async () => {
    const id = await postEntry('sale of 1 luong VRP with weight', [
      { dr: '131', cr: '511', amount: 5310, gold: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5310 },
    ])
    const r = await db.query<{ qty_native: string; qty_gram: string; gold: string }>(
      `SELECT qty_native::text, qty_gram::text, gold_type_code AS gold
         FROM pc49.journal_line WHERE entry_id = $1`, [id],
    )
    expect(Number(r.rows[0].qty_native)).toBe(-1)
    expect(Number(r.rows[0].qty_gram)).toBe(-37.5)
    expect(r.rows[0].gold).toBe('RP')
  })

  it('converts ounces to grams using 31.105', async () => {
    const id = await postEntry('sale of 1 oz Credit Suisse', [
      { dr: '131', cr: '511', amount: 4480, gold: 'CS', uom: 'OZ', qty: -1 },
    ])
    const r = await db.query<{ qty_gram: string }>(
      `SELECT qty_gram::text FROM pc49.journal_line WHERE entry_id = $1`, [id],
    )
    expect(Number(r.rows[0].qty_gram)).toBeCloseTo(-31.105, 5)
  })

  it('leaves weight null on a line with no gold', async () => {
    const id = await postEntry('cash receipt', [{ dr: '1111', cr: '131', amount: 5310 }])
    const r = await db.query<{ qty_gram: string | null }>(
      `SELECT qty_gram::text FROM pc49.journal_line WHERE entry_id = $1`, [id],
    )
    expect(r.rows[0].qty_gram).toBeNull()
  })

  it('requires a unit when a gold type is named', async () => {
    await expect(
      postEntry('gold without a unit', [
        { dr: '131', cr: '511', amount: 5310, gold: 'RP', qty: -1 },
      ]),
    ).rejects.toThrow(/unit/i)
  })
})

describe('the entries of 1 January 2026', () => {
  // Taken from fixtures/golden-numbers.json, block journal_2026_01_01. The
  // opening balance gains the 4111 counterpart the source omits.
  const DAY = '2026-01-02' // a clean date, so the tests above do not pollute the totals

  it('posts all seven and balances every one', async () => {
    const entries = [
      ['HP no dau ky 2026', [{ dr: '1388', amount: 280270 }, { cr: '4111', amount: 280270 }]],
      ['Khach mua 1L VRP', [{ dr: '131', cr: '511', amount: 5310, gold: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5310 }]],
      ['Khach mua 1L VRP - thu tien', [{ dr: '1111', cr: '131', amount: 5310 }]],
      ['Khach mua 1L VRP - gia von', [{ dr: '632RP', cr: '156RP', amount: 5213, gold: 'RP', uom: 'LUONG', qty: -1 }]],
      ['Giao Duc 37.5gr vang Grain', [{ dr: '131', cr: '511', amount: 5217, gold: 'GRAIN', uom: 'GRAM', qty: -37.5, unitPrice: 139.12 }]],
      ['Giao Duc 37.5gr - thu tien', [{ dr: '1111', cr: '131', amount: 5217 }]],
      ['Giao Duc 37.5gr - gia von', [{ dr: '632Grain', cr: '155Grain', amount: 5212.5, gold: 'GRAIN', uom: 'GRAM', qty: -37.5 }]],
    ] as const

    for (const [memo, lines] of entries) {
      await postEntry(memo, lines as never, DAY)
    }

    const unbalanced = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.journal_entry e
        WHERE e.entry_date = $1 AND pc49.entry_balance(e.id) <> 0`, [DAY],
    )
    expect(Number(unbalanced.rows[0].n)).toBe(0)
  })

  it('totals 311,749.50 on each side', async () => {
    const r = await db.query<{ dr: string; cr: string }>(
      `SELECT sum(CASE WHEN l.debit_account  IS NOT NULL THEN l.amount_usd ELSE 0 END)::text AS dr,
              sum(CASE WHEN l.credit_account IS NOT NULL THEN l.amount_usd ELSE 0 END)::text AS cr
         FROM pc49.journal_line l
         JOIN pc49.journal_entry e ON e.id = l.entry_id
        WHERE e.entry_date = $1`, [DAY],
    )
    expect(Number(r.rows[0].dr)).toBeCloseTo(311749.5, 2)
    expect(Number(r.rows[0].cr)).toBeCloseTo(311749.5, 2)
  })

  // The source records the same physical movement twice: once on the revenue
  // line (131/511) and again on the cost line (632*/15x). Summing qty_gram
  // across every journal line therefore double counts it. Real inventory
  // movement is the cost lines alone, because those are the ones that credit an
  // inventory account.
  it('shows minus 150 grams when every line is summed, which double counts', async () => {
    const r = await db.query<{ g: string }>(
      `SELECT sum(l.qty_gram)::text AS g
         FROM pc49.journal_line l
         JOIN pc49.journal_entry e ON e.id = l.entry_id
        WHERE e.entry_date = $1`, [DAY],
    )
    expect(Number(r.rows[0].g)).toBeCloseTo(-150, 2)
  })

  it('moves 75 grams out of inventory, counting only lines that credit stock', async () => {
    const r = await db.query<{ g: string }>(
      `SELECT sum(l.qty_gram)::text AS g
         FROM pc49.journal_line l
         JOIN pc49.journal_entry e ON e.id = l.entry_id
         JOIN pc49.account a ON a.code = l.credit_account
        WHERE e.entry_date = $1
          AND a.code LIKE ANY (ARRAY['155%', '156%', '157%'])`, [DAY],
    )
    expect(Number(r.rows[0].g)).toBeCloseTo(-75, 2)
  })
})
