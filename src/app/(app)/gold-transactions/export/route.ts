import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { csvBytes, reportFileName, toCsv } from '@/lib/export/csv'
import type { Locale } from '@/lib/i18n'
import { parseLedgerQuery, rpcArgs } from '@/components/gold/ledgerQuery'
import { ledgerSheet } from '@/components/gold/ledgerCsv'
import { toLedgerRow } from '@/components/gold/ledgerRow'
import type { LedgerRow } from '@/components/gold/types'

/**
 * The API answers with at most a thousand rows and does not say it cut the
 * rest, so the ledger is read a thousand at a time until a short batch.
 */
const BATCH = 1000

/**
 * The gold ledger, filtered exactly as the screen was, as a file.
 *
 * Every matching row, not the page on screen: somebody exporting a month wants
 * the month. The same filter module and the same database function as the
 * screen, so the file and the list cannot disagree about what a filter means.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!can(user?.role ?? null, 'goldTxn.write')) {
    return new NextResponse('Not permitted', { status: 403 })
  }
  const locale: Locale = user?.locale ?? 'vi'
  const query = parseLedgerQuery(Object.fromEntries(request.nextUrl.searchParams))
  const supabase = await createServerSupabase()

  const goldTypes = await supabase.from('gold_type').select('code, name_vi, name_en')
  const names = new Map(((goldTypes.data ?? []) as { code: string; name_vi: string; name_en: string }[])
    .map((g) => [g.code, locale === 'vi' ? g.name_vi : g.name_en]))

  const rows: LedgerRow[] = []
  for (let offset = 0; ; offset += BATCH) {
    const { data, error } = await supabase.rpc('gold_txn_ledger',
      { ...rpcArgs(query), p_limit: BATCH, p_offset: offset })
    // A file that stops halfway is worse than no file: it gets summed as if it
    // were whole.
    if (error) {
      return new NextResponse(`Could not read the ledger: ${error.message}`, { status: 500 })
    }
    const batch = (data ?? []) as Record<string, unknown>[]
    rows.push(...batch.map(toLedgerRow))
    if (batch.length < BATCH) break
  }

  const sheet = ledgerSheet(rows, locale, (code) => names.get(code) ?? code)
  const stamp = query.from || query.to
    ? `${query.from ?? 'dau'}_${query.to ?? 'nay'}`
    : 'tat-ca'

  return new NextResponse(csvBytes(toCsv([sheet])) as BodyInit, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reportFileName('giao-dich-vang', stamp)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
