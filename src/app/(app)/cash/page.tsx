import { CashView, type AccountRow } from '@/components/cash/CashView'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function CashPage({
  searchParams,
}: { searchParams: Promise<{ period?: string }> }) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'report.read')) {
    return <Forbidden locale={user?.locale} />
  }

  const params = await searchParams
  const period = /^\d{4}-\d{2}$/.test(params.period ?? '')
    ? (params.period as string)
    : new Date().toISOString().slice(0, 7)

  const supabase = await createServerSupabase()
  const [flow, queue] = await Promise.all([
    supabase.rpc('cashflow_by_account', { p_period: period }),
    supabase.from('bank_import_row').select('id', { count: 'exact', head: true }).is('resolved_at', null),
  ])

  const rows: AccountRow[] = (flow.data ?? []).map((r: {
    cash_account_code: string; display_name: string; is_clearing: boolean
    opening: number; received: number; paid: number; closing: number
  }) => ({
    code: r.cash_account_code,
    displayName: r.display_name,
    isClearing: r.is_clearing,
    opening: Number(r.opening),
    received: Number(r.received),
    paid: Number(r.paid),
    closing: Number(r.closing),
  }))

  return (
    <CashView period={period} rows={rows} unmatched={queue.count ?? 0} />
  )
}
