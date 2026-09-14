import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }))

type Profile = {
  id: string
  full_name: string
  role: string
  locale: string
  suspended_at: string | null
  must_change_password: boolean
}

const KT: Profile = {
  id: 'u-1', full_name: 'Ke toan VN', role: 'KT', locale: 'vi',
  suspended_at: null, must_change_password: false,
}

/**
 * A fresh copy of the module for each test. `getCurrentUser` is wrapped in
 * React's `cache`, and a copy kept between tests could hand one test the
 * answer another test set up.
 */
async function load({ claims, profile }: {
  claims: Record<string, unknown> | null
  profile: Profile | null
}) {
  vi.resetModules()
  const server = await import('@/lib/supabase/server')
  const getUser = vi.fn(async () => ({ data: { user: null }, error: null }))
  const getClaims = vi.fn(async () => (claims
    ? { data: { claims, header: {}, signature: new Uint8Array() }, error: null }
    : { data: null, error: new Error('Auth session missing!') }))
  const single = vi.fn(async () => (profile
    ? { data: profile, error: null }
    : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  vi.mocked(server.createServerSupabase).mockResolvedValue({ auth: { getClaims, getUser }, from } as never)
  const { getCurrentUser } = await import('@/lib/auth/currentUser')
  return { getCurrentUser, getUser, getClaims, from, eq }
}

describe('who is signed in', () => {
  it('reads identity from the session claims, without a round trip to Auth', async () => {
    const s = await load({ claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' }, profile: KT })
    expect(await s.getCurrentUser()).toEqual({
      id: 'u-1', email: 'accountant@ctyhp.vn', fullName: 'Ke toan VN',
      role: 'KT', locale: 'vi', mustChangePassword: false,
    })
    expect(s.getClaims).toHaveBeenCalledTimes(1)
    expect(s.getUser).not.toHaveBeenCalled()
    expect(s.eq).toHaveBeenCalledWith('id', 'u-1')
  })

  it('is nobody without a verified session, and reads no profile', async () => {
    const s = await load({ claims: null, profile: KT })
    expect(await s.getCurrentUser()).toBeNull()
    expect(s.from).not.toHaveBeenCalled()
  })

  it('is nobody when the account is suspended', async () => {
    const s = await load({
      claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' },
      profile: { ...KT, suspended_at: '2026-09-01T00:00:00Z' },
    })
    expect(await s.getCurrentUser()).toBeNull()
  })

  it('is nobody when the profile cannot be read', async () => {
    const s = await load({ claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' }, profile: null })
    expect(await s.getCurrentUser()).toBeNull()
  })

  it('carries the flag that forces a new password', async () => {
    const s = await load({
      claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' },
      profile: { ...KT, must_change_password: true },
    })
    expect((await s.getCurrentUser())?.mustChangePassword).toBe(true)
  })
})
