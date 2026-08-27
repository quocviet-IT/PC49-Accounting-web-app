import { describe, it, expect } from 'vitest'
import { readEnv } from '@/lib/env'

describe('readEnv', () => {
  it('returns the configuration when every variable is present', () => {
    const env = readEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    })
    expect(env).toEqual({
      supabaseUrl: 'https://abc.supabase.co',
      supabaseAnonKey: 'anon-key',
    })
  })

  it('names the missing variable in the error', () => {
    expect(() => readEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }))
      .toThrowError('Missing environment variable: NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })
})
