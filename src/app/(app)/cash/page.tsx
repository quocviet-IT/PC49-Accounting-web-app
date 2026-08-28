import { CashView, type AccountRow, type CashTxnRow, type QueueRow } from '@/components/cash/CashView'
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
  const [flow, queue, txns, held] = await Promise.all([
    supabase.rpc('cashflow_by_account', { p_period: period }),
    supabase.from('bank_import_row').select('id', { count: 'exact', head: true }).is('resolved_at', null),
    // The month's movements themselves. Importing a statement and then not
    // being able to see what came in is half a feature.
    supabase.from('cash_txn')
      .select('id, txn_date, cash_account_code, direction, amount, description, kt_note, source')
      .gte('txn_date', `${period}-01`)
      .lt('txn_date', nextMonth(period))
      .is('voided_at', null)
      .order('txn_date', { ascending: false })
      .limit(500),
    // The lines nobody could place, so the queue can be read rather than
    // merely counted.
    supabase.from('bank_import_row')
      .select('id, txn_date, raw_account_no, raw_account_name, raw_amount, description, reason')
      .is('resolved_at', null)
      .order('txn_date', { ascending: false })
      .limit(100),
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

  const movements: CashTxnRow[] = (txns.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    date: r.txn_date as string,
    account: r.cash_account_code as string,
    direction: r.direction as 'IN' | 'OUT',
    amount: Number(r.amount ?? 0),
    description: (r.description as string) ?? null,
    note: (r.kt_note as string) ?? null,
    source: r.source as string,
  }))

  const unplaced: QueueRow[] = (held.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    date: (r.txn_date as string) ?? null,
    accountNo: (r.raw_account_no as string) ?? null,
    accountName: (r.raw_account_name as string) ?? null,
    amount: r.raw_amount === null ? null : Number(r.raw_amount),
    description: (r.description as string) ?? null,
    reason: r.reason as string,
  }))

  return (
    <CashView
      period={period}
      rows={rows}
      unmatched={queue.count ?? 0}
      movements={movements}
      unplaced={unplaced}
    />
  )
}

/** The first day of the month after this one, for a half-open date range. */
function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}
