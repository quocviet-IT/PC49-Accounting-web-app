import { getCurrentUser } from '@/lib/auth/currentUser'
import { createServerSupabase } from '@/lib/supabase/server'
import { FeedbackQueue, type ReportRow } from '@/components/feedback/FeedbackQueue'

const STATUSES = ['NEW', 'LOOKING', 'FIXED', 'DECLINED'] as const

export default async function FeedbackPage({
  searchParams,
}: { searchParams: Promise<{ status?: string }> }) {
  const user = await getCurrentUser()
  // No permission check: anybody signed in may look, and row-level security
  // decides what they see — their own reports, or the queue if they administer
  // the system. Reporting a problem is not a privilege, and neither is seeing
  // what happened to what you reported.
  if (!user) return null

  const params = await searchParams
  const status = (STATUSES as readonly string[]).includes(params.status ?? '')
    ? (params.status as (typeof STATUSES)[number])
    : null

  const supabase = await createServerSupabase()
  let query = supabase
    .from('feedback_report')
    .select('id, kind, impact, description, status, page_url, page_route, page_title, reporter_role, triage_note, triaged_at, created_at, reporter_id')
    .order('created_at', { ascending: false })
    .limit(300)
  if (status) query = query.eq('status', status)

  const { data } = await query

  const rows: ReportRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    kind: r.kind as string,
    impact: r.impact as string,
    description: r.description as string,
    status: r.status as string,
    pageUrl: r.page_url as string,
    pageTitle: (r.page_title as string) ?? null,
    reporterRole: (r.reporter_role as string) ?? null,
    triageNote: (r.triage_note as string) ?? null,
    createdAt: r.created_at as string,
    mine: r.reporter_id === user.id,
  }))

  // Counts for the tabs, so somebody can see there is a queue without opening
  // each one. Read unfiltered, which row-level security narrows to what this
  // reader may see anyway.
  const { data: all } = await supabase.from('feedback_report').select('status')
  const counts: Record<string, number> = {}
  for (const r of all ?? []) counts[r.status as string] = (counts[r.status as string] ?? 0) + 1

  return (
    <FeedbackQueue
      rows={rows}
      status={status}
      counts={counts}
      canTriage={user.role === 'ADMIN'}
    />
  )
}
