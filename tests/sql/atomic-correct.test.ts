import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'

let db: PGlite
const KT = '11111111-1111-1111-1111-111111111111'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${KT}', 'kt@pc49.test');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${KT}', 'Ke toan', 'KT');
    INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
      VALUES ('2026-07-01', 'SG', 60.00)
      ON CONFLICT (price_date, gold_type_code) DO NOTHING;
  `)
}, 60_000)

afterAll(async () => { await db?.close() })

function payload(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    txnDate: '2026-07-01',
    txnType: 'PO',
    goldTypeCode: 'SG',
    uom: 'GRAM',
    qty: 20,
    unitPrice: 600,
    amount: -12000,
    partnerCode: 'A CUSTOMER',
    remarks: 'gia go nham',
    payments: [{ amount: 12000, method: 'CASH' }],
    salesPeople: [{ code: 'L.Thanh', sharePct: 100 }],
    ...over,
  })
}

let seq = 0
async function save(over: Record<string, unknown> = {}) {
  seq += 1
  const r = await asRole(db, KT, () =>
    db.query<{ r: { txnId: string } }>(
      `SELECT pc49.save_gold_transaction($1, $2::jsonb) AS r`, [`save-${seq}`, payload(over)]))
  return r.rows[0].r.txnId
}

async function revisionOf(id: string): Promise<number> {
  const r = await db.query<{ v: number }>(
    `SELECT revision AS v FROM pc49.gold_txn WHERE id = $1`, [id])
  return r.rows[0].v
}

async function correct(key: string, id: string, rev: number, over: Record<string, unknown> = {}) {
  return asRole(db, KT, () =>
    db.query<{ r: Record<string, unknown> }>(
      `SELECT pc49.correct_gold_transaction($1, $2, $3, $4, $5::jsonb) AS r`,
      [key, id, rev, 'Đơn giá gõ nhầm 600 thay vì 60', payload(over)]))
}

describe('opening a correction writes nothing', () => {
  it('leaves the original live until the correction is confirmed', async () => {
    // The whole fault: the old flow reversed the original the moment somebody
    // pressed Sửa, and only then offered a draft to type. Everything between
    // was a hole — the books had a hole in them, not the screen.
    const id = await save()
    const before = await db.query<{ voided: string | null; entry: string | null }>(
      `SELECT voided_at::text AS voided, journal_entry_id::text AS entry
         FROM pc49.gold_txn WHERE id = $1`, [id])
    expect(before.rows[0].voided).toBeNull()
    expect(before.rows[0].entry).toBeTruthy()
  })
})

describe('a correction is one transaction', () => {
  it('reverses the original and posts the replacement together', async () => {
    const id = await save()
    const r = await correct('fix-1', id, await revisionOf(id), { unitPrice: 60, amount: -1200 })
    const made = r.rows[0].r as { txnId: string; replacedTxnId: string }

    const rows = await db.query<{ id: string; voided: string | null; price: string;
                                 corrects: string | null }>(
      `SELECT id::text, voided_at::text AS voided, unit_price::text AS price,
              corrects_txn_id::text AS corrects
         FROM pc49.gold_txn WHERE id IN ($1, $2) ORDER BY voided_at NULLS LAST`, [id, made.txnId])

    const replacement = rows.rows.find((x) => x.id === made.txnId)!
    const original = rows.rows.find((x) => x.id === id)!
    expect(original.voided).toBeTruthy()
    expect(replacement.voided).toBeNull()
    expect(Number(replacement.price)).toBe(60)
    // The replacement says what it replaces, so the pair can be read back.
    expect(replacement.corrects).toBe(id)
    expect(made.replacedTxnId).toBe(id)
  })

  it('leaves the original untouched when the replacement will not post', async () => {
    // A replacement whose shares do not add up fails after the reversal has
    // been written inside the function. If the boundary is right, the original
    // comes back as if nothing happened.
    const id = await save()
    const rev = await revisionOf(id)
    await expect(correct('fix-bad', id, rev, {
      salesPeople: [{ code: 'L.Thanh', sharePct: 60 }, { code: 'P.Minh', sharePct: 30 }],
    })).rejects.toThrow(/come to 100 percent/)

    const after = await db.query<{ voided: string | null; entry: string | null; rev: number }>(
      `SELECT voided_at::text AS voided, journal_entry_id::text AS entry, revision AS rev
         FROM pc49.gold_txn WHERE id = $1`, [id])
    expect(after.rows[0].voided).toBeNull()
    expect(after.rows[0].entry).toBeTruthy()
    expect(after.rows[0].rev).toBe(rev)
  })

  it('needs a reason', async () => {
    const id = await save()
    const rev = await revisionOf(id)
    await expect(asRole(db, KT, () =>
      db.query(`SELECT pc49.correct_gold_transaction($1, $2, $3, $4, $5::jsonb)`,
        ['fix-noreason', id, rev, '   ', payload()])))
      .rejects.toThrow(/needs a reason/)
  })
})

describe('two people correcting the same row', () => {
  it('tells the second one to look again instead of overwriting', async () => {
    const id = await save()
    const rev = await revisionOf(id)

    await correct('fix-first', id, rev)
    // The second arrived holding the revision they read before the first
    // committed. Overwriting silently would throw away work they never saw.
    await expect(correct('fix-second', id, rev)).rejects.toThrow(/CONFLICT/)
  })

  it('refuses to correct something already cancelled', async () => {
    const id = await save()
    await asRole(db, KT, () =>
      db.query(`SELECT pc49.void_gold_txn($1, 'huy rieng')`, [id]))
    await expect(correct('fix-voided', id, await revisionOf(id)))
      .rejects.toThrow(/already been cancelled/)
  })
})

describe('what must not be corrected this way', () => {
  it('refuses a purchase already picked into a refining lot', async () => {
    const id = await save()
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.CORRECT') RETURNING id`)
    await db.query(
      `INSERT INTO pc49.refining_lot_source (lot_id, txn_id) VALUES ($1, $2)`,
      [lot.rows[0].id, id])

    // Reversing it would leave the lot pointing at a cancelled purchase, and
    // the screen cannot know that because it never loads the relation.
    await expect(correct('fix-refining', id, await revisionOf(id)))
      .rejects.toThrow(/picked into a refining lot/)
  })

  it('says why, rather than offering a button that does nothing', async () => {
    const id = await save()
    const free = await db.query<{ why: string | null }>(
      `SELECT pc49.correction_blocked_reason($1) AS why`, [id])
    expect(free.rows[0].why).toBeNull()

    await db.query(`SELECT pc49.void_gold_txn($1, 'huy')`, [id])
    const blocked = await db.query<{ why: string }>(
      `SELECT pc49.correction_blocked_reason($1) AS why`, [id])
    expect(blocked.rows[0].why).toMatch(/already been cancelled/)
  })
})

describe('the revision moves whenever the row does', () => {
  it('is bumped by any writer, not only the ones that remember', async () => {
    // The handoff warns against using updated_at as the token because only one
    // writer maintains it. A trigger is what makes this one true of all of them.
    const id = await save()
    const before = await revisionOf(id)
    await db.query(`UPDATE pc49.gold_txn SET remarks = 'sua tay' WHERE id = $1`, [id])
    expect(await revisionOf(id)).toBe(before + 1)
  })
})

describe('asking twice', () => {
  it('returns the first correction rather than reversing twice', async () => {
    const id = await save()
    const rev = await revisionOf(id)
    const first = await correct('fix-retry', id, rev)
    const again = await correct('fix-retry', id, rev)
    const a = first.rows[0].r as { txnId: string }
    const b = again.rows[0].r as { txnId: string; repeated: boolean }
    expect(b.txnId).toBe(a.txnId)
    expect(b.repeated).toBe(true)
  })
})
