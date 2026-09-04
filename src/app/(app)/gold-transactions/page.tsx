import { TxnGrid, type GoldTypeOption, type SavedRow } from '@/components/gold/TxnGrid'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

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

  const [goldTypesResult, salesResult, existingResult, paymentsResult, sharesResult] =
    await Promise.all([
    supabase.from('gold_type')
      .select('code, name_vi, name_en, native_uom')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('sales_person').select('code').eq('is_active', true).order('code'),
    supabase.from('gold_txn')
      .select('id, txn_type, partner_code, sales_person_code, gold_type_code, scrap_detail, gold_pct, uom, qty, unit_price, amount, remarks')
      .eq('txn_date', txnDate)
      .is('voided_at', null)
      .order('created_at'),
    // How each one was settled. Without this the payment columns on a saved row
    // were drawn empty, so an accountant who had just typed "4,300 CASH" saw it
    // vanish on save and had no way to tell whether it had been recorded.
    supabase.from('gold_txn_payment')
      .select('txn_id, seq, amount, method')
      .order('seq'),
    // Who is credited with each order, and for what part of it. An order may
    // be worked by two people; the column on the row holds only the leading
    // name, so the split has to be read from its own table.
    supabase.from('gold_txn_sales_person')
      .select('txn_id, sales_person_code, share_pct')
      .order('share_pct', { ascending: false }),
  ])

  const paidByTxn = new Map<string, { seq: number; amount: number; method: string }[]>()
  for (const p of (paymentsResult.data ?? []) as
       { txn_id: string; seq: number; amount: number; method: string }[]) {
    const list = paidByTxn.get(p.txn_id) ?? []
    list.push({ seq: p.seq, amount: Number(p.amount), method: p.method })
    paidByTxn.set(p.txn_id, list)
  }

  const soldByTxn = new Map<string, { code: string; sharePct: number }[]>()
  for (const p of (sharesResult.data ?? []) as
       { txn_id: string; sales_person_code: string; share_pct: number }[]) {
    const list = soldByTxn.get(p.txn_id) ?? []
    list.push({ code: p.sales_person_code, sharePct: Number(p.share_pct) })
    soldByTxn.set(p.txn_id, list)
  }

  return (
    // Keyed by the day so changing the date starts the grid over. A change of
    // `?date=` alone keeps the same route segment mounted, which would carry
    // half-typed rows from one day across into the next and offer to save them
    // there.
    <TxnGrid
        key={txnDate}
        txnDate={txnDate}
        goldTypes={(goldTypesResult.data ?? []) as GoldTypeOption[]}
        salesPeople={(salesResult.data ?? []).map((s: { code: string }) => s.code)}
        existing={((existingResult.data ?? []) as Omit<SavedRow, 'payments' | 'soldBy'>[])
          .map((r) => ({
            ...r,
            payments: paidByTxn.get(r.id) ?? [],
            soldBy: soldByTxn.get(r.id) ?? [],
          }))}
      />
  )
}
