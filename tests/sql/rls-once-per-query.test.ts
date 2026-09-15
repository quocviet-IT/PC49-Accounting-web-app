import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'

let db: PGlite

beforeAll(async () => { db = await createTestDb() }, 180_000)
afterAll(async () => { await db?.close() })

describe('row-level security asks who is signed in once per query', () => {
  it('reads the role and the user through a sub-select in every policy', async () => {
    // A bare call in a policy is made for every row the policy checks. Wrapped
    // in a sub-select it is made once for the query. On 15-09 the bare calls
    // were 18 ms of a 1062-row scan that took half a millisecond without them.
    const r = await db.query<{ policy: string; expr: string }>(`
      SELECT tablename || '.' || policyname AS policy,
             coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
        FROM pg_policies
       WHERE schemaname = 'pc49'`)
    expect(r.rows.length).toBeGreaterThan(70)
    const perRow = r.rows
      .filter(({ expr }) => {
        const bare = expr.split('SELECT pc49.effective_role()').join('').split('SELECT auth.uid()').join('')
        return bare.includes('effective_role()') || bare.includes('auth.uid()')
      })
      .map(({ policy }) => policy)
    expect(perRow).toEqual([])
  })
})
