import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => ({ auth })) }))

const { updateSession } = await import('@/lib/supabase/session')
const request = () => new NextRequest('http://localhost:3000/gold-transactions')

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  auth.getClaims.mockReset()
  auth.getUser.mockReset()
})

describe('the proxy in front of every page', () => {
  it('lets a verified session through without asking Supabase Auth', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'u-1' } }, error: null })
    const { signedIn, response } = await updateSession(request())
    expect(signedIn).toBe(true)
    expect(response.status).toBe(200)
    expect(auth.getUser).not.toHaveBeenCalled()
  })

  it('treats a session it cannot verify as signed out', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: new Error('Invalid JWT') })
    expect((await updateSession(request())).signedIn).toBe(false)
  })

  it('treats claims with nobody in them as signed out', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })
    expect((await updateSession(request())).signedIn).toBe(false)
  })
})
