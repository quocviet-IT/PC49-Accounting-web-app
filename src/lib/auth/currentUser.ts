import { createServerSupabase } from '@/lib/supabase/server'
import type { Role } from '@/lib/auth/roles'
import type { Locale } from '@/lib/i18n'

export type CurrentUser = {
  id: string
  /** From the auth record rather than the profile: it is what people sign in as. */
  email: string
  fullName: string
  role: Role
  locale: Locale
  /**
   * Set when an administrator issued the password and it has not been changed.
   *
   * It is read here, with the role, rather than by the layout on its own. That
   * read discarded its error, so a query that failed left the flag undefined
   * and let somebody who was required to change their password straight in.
   * Folded into this one, a failed read returns no user at all — which sends
   * them to the door. An authentication check has to fail closed.
   */
  mustChangePassword: boolean
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('app_user')
    .select('id, full_name, role, locale, suspended_at, must_change_password')
    .eq('id', user.id)
    .single()

  if (!data) return null

  // A closed account is not a role that may do less. It is no role at all —
  // which is what `pc49.effective_role()` has always said, and what every
  // policy in the database reads. Reading `role` here without asking whether
  // the account is open put the two out of step: the database returned nothing
  // to somebody the screens still let in, so they reached the entry grid and
  // found it empty rather than being turned round at the door.
  if (data.suspended_at) return null
  return {
    id: data.id as string,
    email: user.email ?? '',
    fullName: data.full_name as string,
    role: data.role as Role,
    locale: data.locale as Locale,
    mustChangePassword: Boolean(data.must_change_password),
  }
}
