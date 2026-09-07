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
    .select('id, kind, impact, description, status, page_url, page_route, page_title, reporter_role, triage_note, triaged_at, created_at, reporter_id, screenshot_path')
    .order('created_at', { ascending: false })
    .limit(300)
  if (status) query = query.eq('status', status)

  const { data, error } = await query

  // The bucket is private, so a screenshot is reached through a link that
  // expires rather than by its path. Signed as this reader: the storage policy
  // refuses one for a report that is not theirs, which is the same answer the
  // row itself would give.
  const paths = (data ?? [])
    .map((r: Record<string, unknown>) => r.screenshot_path as string | null)
    .filter((p): p is string => Boolean(p))
  const links = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('feedback-screenshots')
      .createSignedUrls(paths, 60 * 10)
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) links.set(s.path, s.signedUrl)
    }
  }

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
    screenshotUrl: links.get(r.screenshot_path as string) ?? null,
    mine: r.reporter_id === user.id,
  }))

  // Counts for the tabs, so somebody can see there is a queue without opening
  // each one. Read unfiltered, which row-level security narrows to what this
  // reader may see anyway.
  const { data: all, error: countError } = await supabase
    .from('feedback_report').select('status')
  const counts: Record<string, number> = {}
  for (const r of all ?? []) counts[r.status as string] = (counts[r.status as string] ?? 0) + 1

  return (
    <FeedbackQueue
      rows={rows}
      // Both errors were discarded. An empty queue reads as "nothing
      // outstanding", and this is the screen somebody opens to check that the
      // problem they reported did not vanish.
      loadFailed={Boolean(error || countError)}
      status={status}
      counts={counts}
      canTriage={user.role === 'ADMIN'}
    />
  )
}
