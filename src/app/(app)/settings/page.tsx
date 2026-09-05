import { SettingsHub, type HubCard } from '@/components/settings/SettingsHub'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function SettingsPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  const mayClose = can(role, 'period.close')
  const mayManage = can(role, 'catalog.manage')
  const mayImport = can(role, 'dataImport.run')
  const mayManagePeople = can(role, 'user.manage')
  if (!mayClose && !mayManage && !mayImport && !mayManagePeople) {
    return <Forbidden locale={user?.locale} />
  }

  const supabase = await createServerSupabase()

  // Each card says what is behind it, so the hub reads as a status board rather
  // than a list of links.
  const [closed, params, batches, uncosted, people] = await Promise.all([
    supabase.from('accounting_period').select('period').eq('status', 'CLOSED'),
    supabase.from('system_param').select('key'),
    supabase.from('import_batch').select('id').is('committed_at', null),
    supabase.from('v_sale_without_cost').select('txn_id'),
    // Only an administrator may read this, and only an administrator is shown
    // the card, so an empty answer for everybody else is the right answer.
    mayManagePeople
      ? supabase.from('app_user').select('id').is('suspended_at', null)
      : Promise.resolve({ data: [] }),
  ])

  const cards: HubCard[] = [
    {
      key: 'import',
      href: '/import',
      titleKey: 'set.import',
      noteKey: 'set.importNote',
      count: batches.data?.length ?? 0,
      countLabelKey: 'set.batchCount',
      show: mayImport,
    },
    {
      key: 'periods',
      href: '/settings/periods',
      titleKey: 'set.periods',
      noteKey: 'set.periodsNote',
      count: closed.data?.length ?? 0,
      countLabelKey: 'set.closedCount',
      show: mayClose,
    },
    {
      key: 'reference',
      href: '/settings/reference',
      titleKey: 'set.reference',
      noteKey: 'set.referenceNote',
      count: params.data?.length ?? 0,
      countLabelKey: 'set.paramCount',
      show: mayManage,
    },
    {
      key: 'users',
      href: '/settings/users',
      titleKey: 'set.users',
      noteKey: 'set.usersNote',
      count: people.data?.length ?? 0,
      countLabelKey: 'set.userCount',
      show: mayManagePeople,
    },
  ]

  return (
    <SettingsHub
        cards={cards.filter((c) => c.show)}
        uncosted={mayImport ? (uncosted.data?.length ?? 0) : 0}
      />
  )
}
