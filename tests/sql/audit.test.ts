import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asUser } from '../support/db'

let db: PGlite
const ALICE = '11111111-1111-1111-1111-111111111111'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${ALICE}', 'alice@example.com');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES ('${ALICE}', 'Alice', 'KT');
  `)
}, 60_000)
afterAll(async () => { await db?.close() })

async function auditFor(entityId: string) {
  const r = await db.query<{ action: string; entity_type: string; actor: string | null }>(
    `SELECT action::text, entity_type, actor::text
       FROM pc49.audit_log WHERE entity_id = $1 ORDER BY at, id`, [entityId],
  )
  return r.rows
}

describe('audit trail', () => {
  let entryId: string

  it('records an insert with the new row and no previous row', async () => {
    const e = await db.query<{ id: string }>(
      `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
       VALUES ('2026-04-01', '2026-04', 'audited entry', 'MANUAL') RETURNING id`,
    )
    entryId = e.rows[0].id

    const r = await db.query<{ action: string; before: unknown; after: { memo: string } }>(
      `SELECT action::text, before, after FROM pc49.audit_log WHERE entity_id = $1`, [entryId],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].action).toBe('INSERT')
    expect(r.rows[0].before).toBeNull()
    expect(r.rows[0].after.memo).toBe('audited entry')
  })

  it('records an update with both rows', async () => {
    await db.query(`UPDATE pc49.journal_entry SET memo = 'renamed' WHERE id = $1`, [entryId])
    const r = await db.query<{ before: { memo: string }; after: { memo: string } }>(
      `SELECT before, after FROM pc49.audit_log
        WHERE entity_id = $1 AND action = 'UPDATE' ORDER BY at DESC LIMIT 1`, [entryId],
    )
    expect(r.rows[0].before.memo).toBe('audited entry')
    expect(r.rows[0].after.memo).toBe('renamed')
  })

  it('records posting as its own action', async () => {
    await db.query(
      `INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
       VALUES ($1, 1, '131', '511', 100)`, [entryId],
    )
    await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`, [entryId])
    const actions = (await auditFor(entryId)).map((x) => x.action)
    expect(actions).toContain('POST')
  })

  it('records a void as its own action', async () => {
    await db.query(
      `UPDATE pc49.journal_entry SET voided_at = now(), void_reason = 'keyed twice'
        WHERE id = $1`, [entryId],
    )
    const actions = (await auditFor(entryId)).map((x) => x.action)
    expect(actions).toContain('VOID')
  })

  it('records the line as well as the entry', async () => {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.audit_log WHERE entity_type = 'journal_line'`,
    )
    expect(Number(r.rows[0].n)).toBeGreaterThan(0)
  })

  it('records who closed a period', async () => {
    await asUser(db, ALICE, async () => {
      await db.query(
        `INSERT INTO pc49.accounting_period (period, status, closed_at)
         VALUES ('2026-04', 'CLOSED', now())`,
      )
    })
    const r = await db.query<{ actor: string | null; entity_type: string }>(
      `SELECT actor::text, entity_type FROM pc49.audit_log
        WHERE entity_type = 'accounting_period' ORDER BY at DESC LIMIT 1`,
    )
    expect(r.rows[0].entity_type).toBe('accounting_period')
    expect(r.rows[0].actor).toBe(ALICE)
  })

  it('leaves the actor null when nobody is signed in', async () => {
    const r = await db.query<{ actor: string | null }>(
      `SELECT actor::text FROM pc49.audit_log WHERE entity_id = $1 AND action = 'INSERT'`,
      [entryId],
    )
    expect(r.rows[0].actor).toBeNull()
  })
})

describe('nothing is ever deleted', () => {
  it('refuses to delete a line belonging to a posted entry', async () => {
    const e = await db.query<{ id: string }>(
      `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
       VALUES ('2026-05-01', '2026-05', 'posted then attacked', 'MANUAL') RETURNING id`,
    )
    const id = e.rows[0].id
    await db.query(
      `INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
       VALUES ($1, 1, '131', '511', 250)`, [id],
    )
    await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`, [id])

    await expect(
      db.query(`DELETE FROM pc49.journal_line WHERE entry_id = $1`, [id]),
    ).rejects.toThrow(/posted/i)
  })
})
