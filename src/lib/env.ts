export type AppEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
}

const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'] as const

export function readEnv(source: Record<string, string | undefined>): AppEnv {
  for (const key of REQUIRED) {
    if (!source[key]) throw new Error(`Missing environment variable: ${key}`)
  }
  return {
    supabaseUrl: source.NEXT_PUBLIC_SUPABASE_URL as string,
    supabaseAnonKey: source.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
  }
}
