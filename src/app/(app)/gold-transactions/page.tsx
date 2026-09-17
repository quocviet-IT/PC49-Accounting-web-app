import { TxnScreen, type GoldTypeOption } from '@/components/gold/TxnScreen'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { parseLedgerQuery, rpcArgs } from '@/components/gold/ledgerQuery'
import { toReceiptRow } from '@/components/gold/ledgerRow'

export default async function GoldTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getCurrentUser()
  const role = user?.role ?? null

  if (!can(role, 'goldTxn.write')) {
    return (
      <Forbidden locale={user?.locale} />
    )
  }

  // The filter is the address: every day, newest first, unless it says
  // otherwise. An old `?date=` link opens on that one day.
  const query = parseLedgerQuery(await searchParams)
  const today = new Date().toISOString().slice(0, 10)
  const supabase = await createServerSupabase()
  const args = rpcArgs(query)

  const [goldTypesResult, salesResult, partnerResult, ledgerResult, totalsResult] =
    await Promise.all([
      supabase.from('gold_type')
        .select('code, name_vi, name_en, native_uom')
        .eq('is_active', true)
        .order('sort_order'),
      supabase.from('sales_person').select('code').eq('is_active', true).order('code'),
      // Who has been traded with, and how to reach them, offered as suggestions
      // so the codes converge on one spelling instead of drifting.
      supabase.from('partner').select('code, phone').eq('is_active', true).order('code'),
      // One page of receipts, with the count of every receipt the filter
      // matched (0076). The database pages and filters.
      supabase.rpc('gold_receipt_ledger',
        { ...args, p_limit: query.size, p_offset: (query.page - 1) * query.size }),
      // The totals of the whole filter, not of the page on screen.
      supabase.rpc('gold_receipt_ledger_totals', args),
    ])

  const totals = ((totalsResult.data ?? []) as Record<string, unknown>[])[0]

  return (
    <TxnScreen
      query={query}
      today={today}
      // Rows that did not arrive must not be offered as an empty ledger: that
      // is how the same purchase gets typed in twice.
      loadFailed={Boolean(ledgerResult.error || totalsResult.error || goldTypesResult.error)}
      goldTypes={(goldTypesResult.data ?? []) as GoldTypeOption[]}
      salesPeople={(salesResult.data ?? []).map((s: { code: string }) => s.code)}
      partners={(partnerResult.data ?? []) as { code: string; phone: string | null }[]}
      rows={((ledgerResult.data ?? []) as Record<string, unknown>[]).map(toReceiptRow)}
      totals={{
        count: Number(totals?.receipt_count ?? 0),
        purchases: Number(totals?.purchases ?? 0),
        sales: Number(totals?.sales ?? 0),
        grams: (totals?.grams_by_gold ?? {}) as Record<string, number>,
      }}
    />
  )
}
