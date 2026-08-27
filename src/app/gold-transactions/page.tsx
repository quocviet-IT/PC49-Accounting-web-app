import { AppShell } from '@/components/AppShell'
import { TxnGrid, type GoldTypeOption, type SavedRow } from '@/components/gold/TxnGrid'
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
      <AppShell role={role}>
        <p>{t(user?.locale ?? 'vi', 'auth.forbidden')}</p>
      </AppShell>
    )
  }

  const params = await searchParams
  const txnDate = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '')
    ? (params.date as string)
    : new Date().toISOString().slice(0, 10)

  const supabase = await createServerSupabase()

  const [goldTypesResult, salesResult, existingResult] = await Promise.all([
    supabase.from('gold_type')
      .select('code, name_vi, name_en, native_uom')
      .eq('is_active', true)
      .order('sort_order'),
    supabase.from('sales_person').select('code').eq('is_active', true).order('code'),
    supabase.from('gold_txn')
      .select('id, txn_type, partner_code, sales_person_code, gold_type_code, scrap_detail, uom, qty, unit_price, amount, remarks')
      .eq('txn_date', txnDate)
      .is('voided_at', null)
      .order('created_at'),
  ])

  return (
    <AppShell role={role}>
      <TxnGrid
        txnDate={txnDate}
        goldTypes={(goldTypesResult.data ?? []) as GoldTypeOption[]}
        salesPeople={(salesResult.data ?? []).map((s: { code: string }) => s.code)}
        existing={(existingResult.data ?? []) as SavedRow[]}
      />
    </AppShell>
  )
}
