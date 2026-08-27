import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)
afterAll(async () => { await db?.close() })

async function deposit(partner: string, amount = 550): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code)
     VALUES ('2026-01-01', 'DEPOSIT', 'RP', 'LUONG', -1, $1, $2) RETURNING id`,
    [amount, partner],
  )
  return r.rows[0].id
}

async function pickup(depositId: string, amount = 4760): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, amount, partner_code, deposit_ref_id)
     VALUES ('2026-01-15', 'PICKUP', 'RP', 'LUONG', -1, $1, 'X', $2) RETURNING id`,
    [amount, depositId],
  )
  return r.rows[0].id
}

describe('the deposit lifecycle', () => {
  it('requires a pickup to name the deposit it settles', async () => {
    await expect(
      db.query(`INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
                VALUES ('2026-01-15', 'PICKUP', 'RP', 'LUONG', -1, 4760)`),
    ).rejects.toThrow(/gold_txn_pickup_needs_deposit/)
  })

  it('forbids a plain sale from naming a deposit', async () => {
    const d = await deposit('A')
    await expect(
      db.query(`INSERT INTO pc49.gold_txn
                  (txn_date, txn_type, gold_type_code, uom, qty, amount, deposit_ref_id)
                VALUES ('2026-01-15', 'SALE', 'RP', 'LUONG', -1, 5310, $1)`, [d]),
    ).rejects.toThrow(/gold_txn_deposit_ref_only_on_settlement/)
  })

  it('settles a deposit with a pickup', async () => {
    const d = await deposit('B')
    const p = await pickup(d)
    const r = await db.query<{ ref: string }>(
      `SELECT deposit_ref_id AS ref FROM pc49.gold_txn WHERE id = $1`, [p],
    )
    expect(r.rows[0].ref).toBe(d)
  })

  it('leaves the deposit row untouched, unlike the spreadsheet', async () => {
    const d = await deposit('C')
    await pickup(d)
    const r = await db.query<{ type: string; amount: string }>(
      `SELECT txn_type::text AS type, amount::text FROM pc49.gold_txn WHERE id = $1`, [d],
    )
    expect(r.rows[0].type).toBe('DEPOSIT')
    expect(Number(r.rows[0].amount)).toBe(550)
  })

  it('refuses a second pickup against the same deposit', async () => {
    const d = await deposit('D')
    await pickup(d)
    await expect(pickup(d)).rejects.toThrow(/already settled/i)
  })

  it('refuses a pickup after the deposit was cancelled', async () => {
    const d = await deposit('E')
    await db.query(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, gold_type_code, uom, qty, amount, deposit_ref_id)
       VALUES ('2026-01-10', 'CANCEL', 'RP', 'LUONG', 1, 0, $1)`, [d],
    )
    await expect(pickup(d)).rejects.toThrow(/already settled/i)
  })

  it('refuses to settle something that is not a deposit', async () => {
    const s = await db.query<{ id: string }>(
      `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
       VALUES ('2026-01-01', 'SALE', 'RP', 'LUONG', -1, 5310) RETURNING id`,
    )
    await expect(pickup(s.rows[0].id)).rejects.toThrow(/not a deposit/i)
  })

  it('lists open deposits and drops them once settled', async () => {
    const before = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_deposit_open`,
    )
    const d = await deposit('F')
    const mid = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_deposit_open`,
    )
    expect(Number(mid.rows[0].n)).toBe(Number(before.rows[0].n) + 1)

    await pickup(d)
    const after = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.v_deposit_open`,
    )
    expect(Number(after.rows[0].n)).toBe(Number(before.rows[0].n))
  })
})
