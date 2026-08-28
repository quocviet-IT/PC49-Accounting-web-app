import { PeriodList, type PeriodRow } from '@/components/settings/PeriodList'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

/** The twelve months ending with the one we are in. */
function recentPeriods(count = 14): string[] {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    return d.toISOString().slice(0, 7)
  })
}

export default async function PeriodsPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'period.close')) {
    return <Forbidden locale={user?.locale} />
  }

  const months = recentPeriods()
  const supabase = await createServerSupabase()

  const [stateResult, entryResult] = await Promise.all([
    supabase.from('accounting_period').select('period, status, closed_at, note'),
    // How much is in each month, so closing is a decision made with the size of
    // the month in view rather than blind.
    supabase.from('journal_entry').select('period, posted_at').is('voided_at', null),
  ])

  const byPeriod = new Map(
    (stateResult.data ?? []).map((r: { period: string }) => [r.period, r]))

  const counts = new Map<string, { posted: number; draft: number }>()
  for (const e of entryResult.data ?? []) {
    const row = counts.get(e.period) ?? { posted: 0, draft: 0 }
    if (e.posted_at) row.posted += 1
    else row.draft += 1
    counts.set(e.period, row)
  }

  const rows: PeriodRow[] = months.map((period) => {
    const state = byPeriod.get(period) as
      { status?: string; closed_at?: string; note?: string } | undefined
    const count = counts.get(period) ?? { posted: 0, draft: 0 }
    return {
      period,
      // A month with no row has never been touched, and is open.
      closed: state?.status === 'CLOSED',
      closedAt: state?.closed_at ?? null,
      note: state?.note ?? null,
      posted: count.posted,
      draft: count.draft,
    }
  })

  return (
    <PeriodList rows={rows} />
  )
}
