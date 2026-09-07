import { UsersView, type PersonRow } from '@/components/settings/UsersView'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function UsersPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'user.manage') || !user) {
    return <Forbidden locale={user?.locale} />
  }

  const supabase = await createServerSupabase()
  // The function refuses anybody who is not an administrator, so this is the
  // same answer whether it is asked from here or from anywhere else.
  const { data, error } = await supabase.rpc('user_directory')

  const people: PersonRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    email: (r.email as string) ?? '',
    fullName: (r.full_name as string) ?? '',
    role: r.role as string,
    suspendedAt: (r.suspended_at as string) ?? null,
    mustChangePassword: Boolean(r.must_change_password),
    createdAt: (r.created_at as string) ?? '',
  }))

  return <UsersView people={people} meId={user.id} loadFailed={Boolean(error)} />
}
