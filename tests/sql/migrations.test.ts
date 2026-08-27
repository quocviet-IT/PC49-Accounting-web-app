import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asUser } from '../support/db'

let db: PGlite

const ALICE = '11111111-1111-1111-1111-111111111111'
const BOB = '22222222-2222-2222-2222-222222222222'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${ALICE}', 'alice@example.com'),
      ('${BOB}', 'bob@example.com');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES
      ('${ALICE}', 'Alice', 'KT'),
      ('${BOB}', 'Bob', 'ADMIN');
  `)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('every migration applies to a clean database', () => {
  it('records itself in schema_migrations', async () => {
    const r = await db.query<{ version: string }>(
      'SELECT version FROM pc49.schema_migrations ORDER BY version',
    )
    expect(r.rows.map((x) => x.version)).toContain('0001_foundation')
  })

  it('creates app_user with row level security enabled', async () => {
    const r = await db.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class
        WHERE oid = 'pc49.app_user'::regclass`,
    )
    expect(r.rows[0].relrowsecurity).toBe(true)
  })

  it('declares the four roles in order', async () => {
    const r = await db.query<{ label: string }>(
      `SELECT enumlabel AS label FROM pg_enum
        WHERE enumtypid = 'pc49.user_role'::regtype
        ORDER BY enumsortorder`,
    )
    expect(r.rows.map((x) => x.label)).toEqual(['KT', 'GS_US', 'OC', 'ADMIN'])
  })
})

describe('effective_role', () => {
  it('returns the role of the signed-in user', async () => {
    const role = await asUser(db, ALICE, async () => {
      const r = await db.query<{ role: string }>('SELECT pc49.effective_role() AS role')
      return r.rows[0].role
    })
    expect(role).toBe('KT')
  })

  it('returns null for a suspended user', async () => {
    await db.exec(`UPDATE pc49.app_user SET suspended_at = now() WHERE id = '${ALICE}'`)
    const role = await asUser(db, ALICE, async () => {
      const r = await db.query<{ role: string | null }>('SELECT pc49.effective_role() AS role')
      return r.rows[0].role
    })
    expect(role).toBeNull()
    await db.exec(`UPDATE pc49.app_user SET suspended_at = NULL WHERE id = '${ALICE}'`)
  })

  it('returns null for a deactivated user', async () => {
    await db.exec(`UPDATE pc49.app_user SET is_active = false WHERE id = '${ALICE}'`)
    const role = await asUser(db, ALICE, async () => {
      const r = await db.query<{ role: string | null }>('SELECT pc49.effective_role() AS role')
      return r.rows[0].role
    })
    expect(role).toBeNull()
    await db.exec(`UPDATE pc49.app_user SET is_active = true WHERE id = '${ALICE}'`)
  })

  it('returns null when nobody is signed in', async () => {
    const r = await db.query<{ role: string | null }>('SELECT pc49.effective_role() AS role')
    expect(r.rows[0].role).toBeNull()
  })
})

describe('security invariants', () => {
  it('enables row level security on every table in the pc49 schema', async () => {
    const r = await db.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'pc49' AND c.relkind = 'r' AND NOT c.relrowsecurity
        ORDER BY c.relname`,
    )
    expect(r.rows.map((x) => x.table_name)).toEqual([])
  })

  it('gives every table with row level security at least one policy', async () => {
    const r = await db.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'pc49' AND c.relkind = 'r' AND c.relrowsecurity
          AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
        ORDER BY c.relname`,
    )
    expect(r.rows.map((x) => x.table_name)).toEqual([])
  })
})
