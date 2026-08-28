import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { getCurrentUser } from '@/lib/auth/currentUser'

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
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <AppShell role={user.role} email={user.email}>
      {children}
    </AppShell>
  )
}
