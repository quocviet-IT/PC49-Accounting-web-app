import { AppShell } from '@/components/AppShell'
import { InventoryView, type StockRow } from '@/components/gold/InventoryView'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { t } from '@/lib/i18n'

type Bucketed = { gold_type_code: string; qty_gram: number }

export default async function InventoryPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'report.read')) {
    return <AppShell role={role}><p>{t(user?.locale ?? 'vi', 'auth.forbidden')}</p></AppShell>
  }

  const supabase = await createServerSupabase()
  const [types, book, physical, total] = await Promise.all([
    supabase.from('gold_type').select('code, name_vi, name_en, native_uom').eq('is_active', true).order('sort_order'),
    supabase.from('v_inventory_book').select('gold_type_code, qty_gram').eq('owner_code', 'PC49'),
    supabase.from('v_inventory_physical').select('gold_type_code, qty_gram').eq('owner_code', 'PC49'),
    supabase.from('v_inventory_total_asset').select('gold_type_code, qty_gram').eq('owner_code', 'PC49'),
  ])

  const by = (rows: Bucketed[] | null) =>
    Object.fromEntries((rows ?? []).map((r) => [r.gold_type_code, Number(r.qty_gram)]))
  const b = by(book.data as Bucketed[] | null)
  const p = by(physical.data as Bucketed[] | null)
  const a = by(total.data as Bucketed[] | null)

  const rows: StockRow[] = (types.data ?? []).map((g: { code: string; name_vi: string; name_en: string; native_uom: string }) => ({
    code: g.code,
    nameVi: g.name_vi,
    nameEn: g.name_en,
    uom: g.native_uom,
    book: b[g.code] ?? 0,
    physical: p[g.code] ?? 0,
    total: a[g.code] ?? 0,
  }))

  return <AppShell role={role}><InventoryView rows={rows} /></AppShell>
}
