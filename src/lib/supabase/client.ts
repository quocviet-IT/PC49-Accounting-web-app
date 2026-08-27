import { createBrowserClient } from '@supabase/ssr'
import { DB_SCHEMA, readEnv } from '@/lib/env'

export function createBrowserSupabase() {
  const env = readEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey, {
    db: { schema: DB_SCHEMA },
  })
}
