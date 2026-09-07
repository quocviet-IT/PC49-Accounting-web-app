import { InventoryView, type MovementRow, type StockRow } from '@/components/gold/InventoryView'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function InventoryPage({
  searchParams,
}: { searchParams: Promise<{ period?: string; asOf?: string }> }) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'report.read')) {
    return <Forbidden locale={user?.locale} />
  }

  const params = await searchParams
  const period = /^\d{4}-\d{2}$/.test(params.period ?? '')
    ? (params.period as string)
    : new Date().toISOString().slice(0, 7)
  // The stock table used to answer only "what do we hold right now". Every
  // other question anybody asks of a stock report is about a date: the closing
  // figure when a period was signed off, what was held the day before a count.
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? '')
    ? (params.asOf as string)
    : new Date().toISOString().slice(0, 10)

  const supabase = await createServerSupabase()
  const [types, stock, movement] = await Promise.all([
    supabase.from('gold_type').select('code, name_vi, name_en, native_uom').eq('is_active', true).order('sort_order'),
    // All three figures with one cut-off, in one round trip. The three views
    // this replaces sum every movement ever recorded and cannot take a date —
    // a view has no arguments.
    supabase.rpc('inventory_as_of', { p_as_of: asOf, p_owner: 'PC49' }),
    // Opening, in, out, closing for the month — the shape the source's NXT
    // sheet has, and the one the accountant reconciles against.
    supabase.rpc('stock_movement_report', { p_period: period, p_owner: 'PC49' }),
  ])

  const held = new Map<string, { book: number; physical: number; total: number }>()
  for (const r of (stock.data ?? []) as {
    gold_type_code: string; book_gram: number; physical_gram: number; total_gram: number
  }[]) {
    held.set(r.gold_type_code, {
      book: Number(r.book_gram), physical: Number(r.physical_gram), total: Number(r.total_gram),
    })
  }

  const rows: StockRow[] = (types.data ?? []).map((g: { code: string; name_vi: string; name_en: string; native_uom: string }) => ({
    code: g.code,
    nameVi: g.name_vi,
    nameEn: g.name_en,
    uom: g.native_uom,
    book: held.get(g.code)?.book ?? 0,
    physical: held.get(g.code)?.physical ?? 0,
    total: held.get(g.code)?.total ?? 0,
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

  return (
    <InventoryView
        rows={rows}
        period={period}
        asOf={asOf}
        movements={movements}
        stockFailed={Boolean(stock.error)}
    />
  )
}
