import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { csvBytes, reportFileName, toCsv } from '@/lib/export/csv'
import { findReport } from '@/lib/domain/reports'
import { reportSheets } from '@/lib/domain/report-data'
import type { Locale } from '@/lib/i18n'

/** The last day of a month, which is the date an as-at report is taken at. */
function endOf(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/**
 * One report as a file.
 *
 * It used to write the same three blocks whatever report was open, so a
 * download taken from the trial balance arrived holding a profit and loss.
 * That is worse than having no download: a file that says it is one thing and
 * holds another is a file somebody acts on.
 *
 * The figures come from the same functions the screen reads, through the same
 * module, so the file and the page cannot drift.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!can(user?.role ?? null, 'report.read')) {
    return new NextResponse('Not permitted', { status: 403 })
  }
  const locale: Locale = user?.locale ?? 'vi'
  const q = request.nextUrl.searchParams

  const report = findReport(q.get('report') ?? undefined)
  if (!report) {
    return new NextResponse('Name a report to download', { status: 400 })
  }

  const ok = (v: string | null, re: RegExp) => (v && re.test(v) ? v : null)
  const period = ok(q.get('period'), /^\d{4}-\d{2}$/) ?? new Date().toISOString().slice(0, 7)
  const window = {
    period,
    date: ok(q.get('date'), /^\d{4}-\d{2}-\d{2}$/) ?? endOf(period),
    from: ok(q.get('from'), /^\d{4}-\d{2}-\d{2}$/) ?? `${period}-01`,
    to: ok(q.get('to'), /^\d{4}-\d{2}-\d{2}$/) ?? endOf(period),
    account: q.get('account') ?? undefined,
  }

  const supabase = await createServerSupabase()
  const sheets = await reportSheets(supabase, report.id, window, locale)

  // Named after the report and the window it covers, so a folder of these is
  // still readable in six months.
  const stamp = report.range === 'day' ? window.date
    : report.range === 'range' ? `${window.from}_${window.to}`
      : period

  return new NextResponse(csvBytes(toCsv(sheets)) as BodyInit, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reportFileName(report.id, stamp)}"`,
      // A report is a snapshot of a moment; a cached copy would quietly show
      // last week's figures under this week's date.
      'Cache-Control': 'no-store',
    },
  })
}
