import { AppShell } from '@/components/AppShell'
import { ConversionView, type BankTxn, type GoldOption } from '@/components/bank/ConversionView'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { t } from '@/lib/i18n'

export default async function BankConversionPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'goldTxn.write')) {
    return <AppShell role={role}><p>{t(user?.locale ?? 'vi', 'auth.forbidden')}</p></AppShell>
  }

  const supabase = await createServerSupabase()
  const [allocation, types, param] = await Promise.all([
    supabase.from('v_bank_allocation')
      .select('cash_txn_id, txn_date, amount, description, allocated_value, residual_cash, allocation_lines')
      .order('txn_date', { ascending: false })
      .limit(200),
    supabase.from('gold_type').select('code, name_vi, name_en, native_uom')
      .eq('is_active', true).order('sort_order'),
    supabase.from('system_param').select('value')
      .eq('key', 'BANK_PRICE_TOLERANCE_USD').maybeSingle(),
  ])

  const transactions: BankTxn[] = (allocation.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.cash_txn_id as string,
    txnDate: r.txn_date as string,
    amount: Number(r.amount),
    description: (r.description as string) ?? null,
    allocatedValue: Number(r.allocated_value ?? 0),
    residualCash: Number(r.residual_cash ?? 0),
    lines: Number(r.allocation_lines ?? 0),
  }))

  const goldTypes: GoldOption[] = (types.data ?? []).map((g: {
    code: string; name_vi: string; name_en: string; native_uom: string
  }) => ({ code: g.code, nameVi: g.name_vi, nameEn: g.name_en, uom: g.native_uom }))

  return (
    <AppShell role={role}>
      <ConversionView
        transactions={transactions}
        goldTypes={goldTypes}
        tolerance={Number(param.data?.value ?? 100)}
      />
    </AppShell>
  )
}
