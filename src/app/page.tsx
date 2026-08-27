import { AppShell } from '@/components/AppShell'
import { getCurrentUser } from '@/lib/auth/currentUser'

export default async function HomePage() {
  const user = await getCurrentUser()
  return (
    <AppShell role={user?.role ?? null}>
      <h1>{user ? user.fullName : ''}</h1>
    </AppShell>
  )
}
