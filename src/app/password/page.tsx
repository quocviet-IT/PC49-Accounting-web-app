import { redirect } from 'next/navigation'
import { PasswordView } from '@/components/settings/PasswordView'
import { getCurrentUser } from '@/lib/auth/currentUser'

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

  // The same read the layout does, and it is the same read: one query whose
  // failure means no user, rather than a second one whose failure quietly
  // turned a required change into an optional one.
  return <PasswordView forced={user.mustChangePassword} />
}
