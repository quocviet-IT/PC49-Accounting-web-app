import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const sql = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/0001_foundation.sql'),
  'utf8',
)

describe('0001_foundation', () => {
  it('enables row level security on app_user', () => {
    expect(sql).toContain('ALTER TABLE pc49.app_user ENABLE ROW LEVEL SECURITY')
  })

  it('declares all four roles', () => {
    expect(sql).toContain("CREATE TYPE pc49.user_role AS ENUM ('KT', 'GS_US', 'OC', 'ADMIN')")
  })

  it('strips the role from a suspended user', () => {
    expect(sql).toContain('suspended_at IS NULL')
  })

  it('uses no floating point types', () => {
    expect(sql).not.toMatch(/\b(float|double precision|real)\b/i)
  })

  it('avoids the reserved word current_role as a function name', () => {
    expect(sql).not.toMatch(/FUNCTION\s+pc49\.current_role/i)
    expect(sql).toMatch(/FUNCTION\s+pc49\.effective_role/i)
  })
})
