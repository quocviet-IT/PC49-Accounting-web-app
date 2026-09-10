import { TxnScreen, type GoldTypeOption, type SavedRow } from '@/components/gold/TxnScreen'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { t } from '@/lib/i18n'

export default async function GoldTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await getCurrentUser()
  const role = user?.role ?? null

  if (!can(role, 'goldTxn.write')) {
    return (
      <Forbidden locale={user?.locale} />
    )
  }

  const params = await searchParams
  const txnDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '')
    ? (params.date as string)
    : new Date().toISOString().slice(0, 10)

  const supabase = await createServerSupabase()

  const [goldTypesResult, salesResult, partnerResult, existingResult,
         correctableResult] = await Promise.all([
    supabase.from('gold_type')
      .select('code, name_vi, name_en, native_uom')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('sales_person').select('code').eq('is_active', true).order('code'),
    // Who has been traded with, and how to reach them. Offered as suggestions
    // on the row so the codes converge on one spelling instead of drifting.
    supabase.from('partner').select('code, phone').eq('is_active', true).order('code'),
    // Payments and shares come nested rather than as two unfiltered reads of
    // their own. Fetched flat they had no filter at all — every payment ever
    // recorded, to draw one day — which grows without bound and, worse, meets
    // whatever row cap the API is configured with and stops returning the rest
    // without saying so. A day would quietly lose its payments.
    supabase.from('gold_txn')
      .select(`id, doc_no, txn_type, partner_code, sales_person_code, gold_type_code,
               scrap_detail, gold_pct, uom, qty, unit_price, amount, remarks,
               gold_txn_payment(seq, amount, method),
               gold_txn_sales_person(sales_person_code, share_pct)`)
      .eq('txn_date', txnDate)
      .is('voided_at', null)
      .order('seq', { referencedTable: 'gold_txn_payment', ascending: true })
      .order('share_pct', { referencedTable: 'gold_txn_sales_person', ascending: false })
      .order('created_at'),
    // Whether each row may be corrected here, and the revision the screen is
    // showing — so Sửa can be greyed out with a reason rather than refused
    // after the fact, and so a correction can tell if the row has moved.
    supabase.from('v_gold_txn_correctable')
      .select('id, revision, blocked_reason')
      .eq('txn_date', txnDate),
  ])

  /** One row as it arrives, with its payments and its staff already attached. */
  type Nested = Omit<SavedRow, 'payments' | 'soldBy' | 'revision' | 'blockedReason'> & {
    gold_txn_payment: { seq: number; amount: number; method: string }[] | null
    gold_txn_sales_person: { sales_person_code: string; share_pct: number }[] | null
  }

  // Without this read the screen cannot tell a row that may be corrected from
  // one the books have closed over. Offering Sửa on all of them would be a
  // button that can only be refused, so the reason it cannot be judged is
  // shown instead.
  const correctableFailed = Boolean(correctableResult.error)
  const unknownReason = t(user?.locale ?? 'vi', 'common.loadFailed')

  const stateById = new Map<string, { revision: number; blockedReason: string | null }>(
    ((correctableResult.data ?? []) as Record<string, unknown>[]).map((r) => [
      r.id as string,
      { revision: Number(r.revision ?? 1), blockedReason: (r.blocked_reason as string) ?? null },
    ]))

  return (
    // Keyed by the day so changing the date starts the grid over. A change of
    // `?date=` alone keeps the same route segment mounted, which would carry
    // half-typed rows from one day across into the next and offer to save them
    // there.
    <TxnScreen
        key={txnDate}
        txnDate={txnDate}
        // A day whose rows did not arrive must not be offered as a blank
        // grid: that is how the same purchase gets typed in twice.
        loadFailed={Boolean(existingResult.error || goldTypesResult.error)}
        goldTypes={(goldTypesResult.data ?? []) as GoldTypeOption[]}
        // These two are suggestions, not facts on the screen: both fields are
        // free text, and an empty phone is never written back over a stored
        // one (see actions.ts — the upsert omits the key when it is blank). So
        // a catalogue that did not load degrades the typing aid and asserts
        // nothing false, which is why it does not stop the day being entered.
        salesPeople={(salesResult.data ?? []).map((s: { code: string }) => s.code)}
        partners={(partnerResult.data ?? []) as { code: string; phone: string | null }[]}
        existing={((existingResult.data ?? []) as Nested[])
          .map((r) => ({
            ...r,
            payments: (r.gold_txn_payment ?? []).map((p) => ({
              seq: p.seq, amount: Number(p.amount), method: p.method,
            })),
            soldBy: (r.gold_txn_sales_person ?? []).map((p) => ({
              code: p.sales_person_code, sharePct: Number(p.share_pct),
            })),
            revision: stateById.get(r.id)?.revision ?? 1,
            blockedReason: correctableFailed
              ? unknownReason
              : stateById.get(r.id)?.blockedReason ?? null,
          }))}
      />
  )
}
