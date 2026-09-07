import {
  CashView, type AccountRow, type CashTxnRow, type LoanRow, type QueueRow, type ReconRow,
} from '@/components/cash/CashView'
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
  const [flow, queue, txns, held, recon, loans] = await Promise.all([
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
    // Whether the books have been squared with the other side, for the close of
    // this month.
    supabase.from('cash_reconciliation')
      .select('cash_account_code, rec_date, our_closing, us_closing, difference, status, reason')
      .gte('rec_date', `${period}-01`)
      .lt('rec_date', nextMonth(period)),
    // Money lent between the group's own entities: the reason 1388 has an
    // opening balance nobody could name a credit side for.
    supabase.from('v_internal_loan_balance').select('counterparty, outstanding'),
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

  const reconciled: ReconRow[] = (recon.data ?? []).map((r: Record<string, unknown>) => ({
    account: r.cash_account_code as string,
    date: r.rec_date as string,
    ours: Number(r.our_closing ?? 0),
    theirs: Number(r.us_closing ?? 0),
    difference: Number(r.difference ?? 0),
    status: r.status as string,
    reason: (r.reason as string) ?? null,
  }))

  const loanBalances: LoanRow[] = (loans.data ?? []).map((r: Record<string, unknown>) => ({
    counterparty: r.counterparty as string,
    outstanding: Number(r.outstanding ?? 0),
  }))

  // The last day of the month, which is the date a close is reconciled at.
  const [y, m] = period.split('-').map(Number)
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

  return (
    <CashView
        balancesFailed={Boolean(flow.error)}
      period={period}
      rows={rows}
      unmatched={queue.count ?? 0}
      movements={movements}
      unplaced={unplaced}
      recon={reconciled}
      loans={loanBalances}
      monthEnd={monthEnd}
    />
  )
}

/** The first day of the month after this one, for a half-open date range. */
function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)
}
