import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { csvBytes, reportFileName, toCsv, type Sheet } from '@/lib/export/csv'
import { t, type Locale } from '@/lib/i18n'

/**
 * The month's reports as a file.
 *
 * One file with the three blocks the screen shows, in the order it shows them,
 * so what somebody opens in Excel is what they were looking at. The figures are
 * the same database functions the screen reads — a second calculation here
 * would be a second answer to the same question.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!can(user?.role ?? null, 'report.read')) {
    return new NextResponse('Not permitted', { status: 403 })
  }
  const locale: Locale = user?.locale ?? 'vi'

  const asked = request.nextUrl.searchParams.get('period') ?? ''
  const period = /^\d{4}-\d{2}$/.test(asked) ? asked : new Date().toISOString().slice(0, 7)
  const [y, m] = period.split('-').map(Number)
  const asOf = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

  const supabase = await createServerSupabase()
  const [pl, apar, assets] = await Promise.all([
    supabase.rpc('pl_report', { p_period: period }),
    supabase.rpc('apar_report', { p_period: period }),
    supabase.rpc('total_asset_report', { p_as_of: asOf }),
  ])

  const label = (key: Parameters<typeof t>[1]) => t(locale, key)
  const a = Array.isArray(assets.data) ? assets.data[0] : assets.data

  const sheets: Sheet[] = [
    {
      title: `${label('rep.pl')} — ${period}`,
      header: [label('rep.line'), label('rep.amount')],
      rows: (pl.data ?? []).map((r: Record<string, unknown>) => [
        // The indent carries the report's structure; spaces keep it in a file
        // that has no notion of one.
        `${'    '.repeat(Number(r.indent ?? 0))}${locale === 'vi' ? r.name_vi : r.name_en}`,
        Number(r.amount ?? 0),
      ]),
    },
    {
      title: `${label('rep.apar')} — ${period}`,
      header: [label('rep.partner'), label('rep.account'),
               label('rep.opening'), label('rep.closing')],
      rows: (apar.data ?? []).map((r: Record<string, unknown>) => [
        r.partner_code as string,
        r.account_code as string,
        Number(r.opening_value ?? 0),
        Number(r.closing_value ?? 0),
      ]),
    },
    {
      title: `${label('rep.assets')} — ${asOf}`,
      header: [label('rep.line'), label('rep.amount')],
      rows: a ? [
        [label('rep.inventoryValue'), Number(a.inventory_value ?? 0)],
        [label('rep.receivable'), Number(a.receivable ?? 0)],
        [label('rep.payable'), Number(a.payable ?? 0)],
        [label('rep.cash'), Number(a.cash ?? 0)],
        [label('rep.bank'), Number(a.bank ?? 0)],
        [label('rep.cashFlowTotal'), Number(a.cash_flow_total ?? 0)],
      ] : [],
    },
  ]

  return new NextResponse(csvBytes(toCsv(sheets)) as BodyInit, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        `attachment; filename="${reportFileName('bao-cao', period)}"`,
      // A report is a snapshot of a moment; a cached copy would quietly show
      // last week's figures under this week's date.
      'Cache-Control': 'no-store',
    },
  })
}
