import { redirect } from 'next/navigation'
import { PasswordView } from '@/components/settings/PasswordView'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Deliberately outside the (app) group.
 *
 * The layout in there sends anybody holding a temporary password here, and a
 * screen that lives under that layout would send itself here for ever. Sitting
 * outside also means the shell is not drawn around it, which is right: while
 * the flag is set there is nowhere else to navigate to.
 */
export default async function PasswordPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from('app_user').select('must_change_password').eq('id', user.id).single()

  return <PasswordView forced={Boolean(data?.must_change_password)} />
}
