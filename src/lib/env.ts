/** Every application table lives in this schema, never in `public`. */
export const DB_SCHEMA = 'pc49'

export type AppEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
}

/**
 * Supabase renamed the browser-safe key: `sb_publishable_...` supersedes the
 * older anon key. Both are accepted so a project created under either naming
 * works, with the newer name winning when both are present.
 */
const KEY_NAMES = ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const

export function readEnv(source: Record<string, string | undefined>): AppEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Missing environment variable: NEXT_PUBLIC_SUPABASE_URL')

  const key = KEY_NAMES.map((name) => source[name]).find(Boolean)
  if (!key) throw new Error(`Missing environment variable: ${KEY_NAMES.join(' or ')}`)

  return { supabaseUrl: url, supabaseAnonKey: key }
}
