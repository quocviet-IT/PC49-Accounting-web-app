import { createServerSupabase } from '@/lib/supabase/server'
import type { Role } from '@/lib/auth/roles'
import type { Locale } from '@/lib/i18n'

export type CurrentUser = {
  id: string
  fullName: string
  role: Role
  locale: Locale
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('app_user')
    .select('id, full_name, role, locale')
    .eq('id', user.id)
    .single()

  if (!data) return null
  return {
    id: data.id as string,
    fullName: data.full_name as string,
    role: data.role as Role,
    locale: data.locale as Locale,
  }
}
