import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * The shell, rendered once for every signed-in screen.
 *
 * It used to be inside each page, which meant navigating rebuilt the whole
 * sidebar: a collapsed column sprang open, an expanded group closed itself, and
 * the chrome flashed on every click. Here it mounts once and the page below is
 * the only thing that changes.
 *
 * Being signed in is settled here too, rather than in thirteen places. What a
 * role may *do* still belongs to the page — a screen knows which capability it
 * needs and this layout does not.
 *
 * And so is still holding the password somebody else chose. A temporary
 * password is read aloud across a counter; until it is replaced it is a
 * password two people know, so nothing behind this layout opens while the flag
 * is set. `/password` sits outside the group precisely so it stays reachable.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  const supabase = await createServerSupabase()

  if (!user) {
    // Two different nobodies. Somebody who never signed in goes to the door;
    // somebody holding a live session whose account was closed has their
    // session ended, because sending them to the door instead makes the proxy
    // and this layout bounce them between each other for ever.
    const { data: { user: stillSignedIn } } = await supabase.auth.getUser()
    redirect(stillSignedIn ? '/auth/closed' : '/login')
  }

  const { data } = await supabase
    .from('app_user').select('must_change_password').eq('id', user.id).single()
  if (data?.must_change_password) redirect('/password')

  return (
    <AppShell role={user.role} email={user.email}>
      {children}
    </AppShell>
  )
}
