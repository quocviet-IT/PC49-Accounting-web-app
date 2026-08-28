import { InventoryView, type MovementRow, type StockRow } from '@/components/gold/InventoryView'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

type Bucketed = { gold_type_code: string; qty_gram: number }

export default async function InventoryPage({
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

  const supabase = await createServerSupabase()
  const [types, book, physical, total, movement] = await Promise.all([
    supabase.from('gold_type').select('code, name_vi, name_en, native_uom').eq('is_active', true).order('sort_order'),
    supabase.from('v_inventory_book').select('gold_type_code, qty_gram').eq('owner_code', 'PC49'),
    supabase.from('v_inventory_physical').select('gold_type_code, qty_gram').eq('owner_code', 'PC49'),
    supabase.from('v_inventory_total_asset').select('gold_type_code, qty_gram').eq('owner_code', 'PC49'),
    // Opening, in, out, closing for the month — the shape the source's NXT
    // sheet has, and the one the accountant reconciles against.
    supabase.rpc('stock_movement_report', { p_period: period, p_owner: 'PC49' }),
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

  const movements: MovementRow[] = (movement.data ?? []).map((r: Record<string, unknown>) => ({
    code: r.gold_type_code as string,
    opening: Number(r.opening_gram ?? 0),
    receipt: Number(r.receipt_gram ?? 0),
    issue: Number(r.issue_gram ?? 0),
    closing: Number(r.closing_gram ?? 0),
    openingValue: Number(r.opening_value ?? 0),
    closingValue: Number(r.closing_value ?? 0),
    adjustment: Number(r.adjustment ?? 0),
  }))

  return <InventoryView rows={rows} period={period} movements={movements} />
}
