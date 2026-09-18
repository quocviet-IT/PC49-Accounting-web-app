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

  const [goldTypesResult, salesResult, partnerResult, ledgerResult, totalsResult,
    flowResult, toleranceResult] =
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
      // What the conversion form may offer on each side, and how far apart the
      // two sides may be before a reason is asked for.
      supabase.from('gold_flow_rule').select('gold_type_code, txn_type')
        .in('txn_type', ['TRANSFER_IN', 'TRANSFER_OUT']),
      supabase.from('system_param').select('value')
        .eq('key', 'CONVERSION_WEIGHT_TOLERANCE_PCT').maybeSingle(),
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
      flowRules={(flowResult.data ?? []) as { gold_type_code: string; txn_type: string }[]}
      tolerancePct={Number(toleranceResult.data?.value ?? 0.5)}
      rows={((ledgerResult.data ?? []) as Record<string, unknown>[]).map(toReceiptRow)}
      totals={{
        count: Number(totals?.receipt_count ?? 0),
        purchases: Number(totals?.purchases ?? 0),
        sales: Number(totals?.sales ?? 0),
        grams: (totals?.grams_by_gold ?? {}) as Record<string, number>,
        // In and out apart, each in its own unit and in grams (0089).
        moves: Object.fromEntries(
          Object.entries((totals?.moves_by_gold ?? {}) as Record<string, Record<string, unknown>>)
            .map(([code, m]) => [code, {
              in: Number(m.in ?? 0), inGrams: Number(m.inGrams ?? 0),
              out: Number(m.out ?? 0), outGrams: Number(m.outGrams ?? 0),
            }])),
      }}
    />
  )
}
