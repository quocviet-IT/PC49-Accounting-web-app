import {
  ReferenceView, type Param, type GoldTypeRow, type CashAccountRow, type SalesPersonRow,
  type PartnerRow,
} from '@/components/settings/ReferenceView'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function ReferencePage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'catalog.manage')) {
    return <Forbidden locale={user?.locale} />
  }

  const supabase = await createServerSupabase()
  const [paramResult, goldResult, cashResult, salesResult, partnerResult, accountResult] =
    await Promise.all([
    supabase.from('system_param')
      .select('key, value, unit, description, description_vi').order('key'),
    supabase.from('gold_type')
      .select('code, name_vi, name_en, native_uom, inventory_account, cogs_account, is_active')
      .order('sort_order'),
    supabase.from('cash_account')
      .select('code, display_name, account_type, bank_name, status_note, is_active')
      .order('sort_order'),
    supabase.from('sales_person').select('code, full_name, is_active').order('code'),
    supabase.from('partner').select('code, full_name, phone, is_active').order('code'),
    supabase.from('account').select('code'),
  ])

  const params: Param[] = (paramResult.data ?? []).map((r: Record<string, unknown>) => ({
    key: r.key as string,
    value: Number(r.value),
    unit: (r.unit as string) ?? null,
    description: r.description as string,
    descriptionVi: (r.description_vi as string) ?? null,
  }))

  const goldTypes: GoldTypeRow[] = (goldResult.data ?? []).map((r: Record<string, unknown>) => ({
    code: r.code as string,
    nameVi: r.name_vi as string,
    nameEn: r.name_en as string,
    uom: r.native_uom as string,
    inventoryAccount: r.inventory_account as string,
    cogsAccount: r.cogs_account as string,
    isActive: Boolean(r.is_active),
  }))

  const cashAccounts: CashAccountRow[] = (cashResult.data ?? []).map(
    (r: Record<string, unknown>) => ({
      code: r.code as string,
      displayName: r.display_name as string,
      accountType: r.account_type as string,
      bankName: (r.bank_name as string) ?? null,
      statusNote: (r.status_note as string) ?? null,
      isActive: Boolean(r.is_active),
    }))

  const salesPeople: SalesPersonRow[] = (salesResult.data ?? []).map(
    (r: Record<string, unknown>) => ({
      code: r.code as string,
      fullName: (r.full_name as string) ?? null,
      isActive: Boolean(r.is_active),
    }))

  const partners: PartnerRow[] = (partnerResult.data ?? []).map(
    (r: Record<string, unknown>) => ({
      code: r.code as string,
      fullName: (r.full_name as string) ?? null,
      phone: (r.phone as string) ?? null,
      isActive: Boolean(r.is_active),
    }))

  return (
    <ReferenceView
        params={params}
        goldTypes={goldTypes}
        cashAccounts={cashAccounts}
        salesPeople={salesPeople}
        partners={partners}
        accountCount={accountResult.data?.length ?? 0}
      />
  )
}
