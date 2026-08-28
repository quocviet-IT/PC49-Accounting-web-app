import { ReportsView, type PlLine, type AparLine, type Assets } from '@/components/reports/ReportsView'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function ReportsPage({
  searchParams,
}: { searchParams: Promise<{ period?: string }> }) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'report.read')) {
    return <Forbidden locale={user?.locale} />
  }

  const params = await searchParams
  const period = /^\d{4}-\d{2}$/.test(params.period ?? '')
    ? (params.period as string)
    : new Date().toISOString().slice(0, 7)

  // The last day of the period, which is the date the assets report is taken at.
  const [y, m] = period.split('-').map(Number)
  const asOf = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)

  const supabase = await createServerSupabase()
  const [plResult, aparResult, assetResult] = await Promise.all([
    supabase.rpc('pl_report', { p_period: period }),
    supabase.rpc('apar_report', { p_period: period }),
    supabase.rpc('total_asset_report', { p_as_of: asOf }),
  ])

  const pl: PlLine[] = (plResult.data ?? []).map((r: Record<string, unknown>) => ({
    code: r.code as string,
    nameVi: r.name_vi as string,
    nameEn: r.name_en as string,
    kind: r.kind as PlLine['kind'],
    indent: Number(r.indent ?? 0),
    amount: Number(r.amount ?? 0),
  }))

  const apar: AparLine[] = (aparResult.data ?? []).map((r: Record<string, unknown>) => ({
    partnerCode: r.partner_code as string,
    accountCode: r.account_code as string,
    opening: Number(r.opening_value ?? 0),
    closing: Number(r.closing_value ?? 0),
  }))

  const a = Array.isArray(assetResult.data) ? assetResult.data[0] : assetResult.data
  const assets: Assets | null = a ? {
    inventoryGram: Number(a.inventory_gram ?? 0),
    inventoryValue: Number(a.inventory_value ?? 0),
    receivable: Number(a.receivable ?? 0),
    payable: Number(a.payable ?? 0),
    cash: Number(a.cash ?? 0),
    bank: Number(a.bank ?? 0),
    total: Number(a.cash_flow_total ?? 0),
  } : null

  return (
    <ReportsView period={period} pl={pl} apar={apar} assets={assets} />
  )
}
