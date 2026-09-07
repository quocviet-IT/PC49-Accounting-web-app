import { PriceGrid, type PriceRow, type SpotRow, type Uncosted } from '@/components/prices/PriceGrid'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

/** The day before the one being shown, which is where prices are carried from. */
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default async function PricesPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'goldTxn.write')) {
    return <Forbidden locale={user?.locale} />
  }

  const params = await searchParams
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '')
    ? (params.date as string)
    : new Date().toISOString().slice(0, 10)

  const supabase = await createServerSupabase()
  const [gridResult, spotResult, uncostedResult] = await Promise.all([
    supabase.rpc('price_grid', { p_date: date }),
    supabase.from('spot_price_daily').select('metal, spot_per_oz, spot_per_gram')
      .eq('price_date', date),
    // Sales that were posted before anyone set that day's price. Shown on this
    // screen because this is the screen where the omission gets fixed.
    supabase.from('v_uncosted_by_day').select('txn_date, gold_type_code, sales, revenue')
      .order('txn_date', { ascending: false }).limit(50),
  ])

  const rows: PriceRow[] = (gridResult.data ?? []).map((r: Record<string, unknown>) => ({
    code: r.gold_type_code as string,
    nameVi: r.name_vi as string,
    nameEn: r.name_en as string,
    uom: r.native_uom as string,
    marketPrice: r.market_price === null ? null : Number(r.market_price),
    avgPurchasePrice: r.avg_purchase_price === null ? null : Number(r.avg_purchase_price),
    variance: r.variance === null ? null : Number(r.variance),
    tradedQty: Number(r.traded_qty ?? 0),
    soldQty: Number(r.sold_qty ?? 0),
  }))

  const spot: SpotRow[] = (['GOLD', 'PLATINUM'] as const).map((metal) => {
    const found = (spotResult.data ?? []).find(
      (r: { metal: string }) => r.metal === metal)
    return {
      metal,
      perOz: found ? Number(found.spot_per_oz) : null,
      perGram: found ? Number(found.spot_per_gram) : null,
    }
  })

  const uncosted: Uncosted[] = (uncostedResult.data ?? []).map((r: Record<string, unknown>) => ({
    date: r.txn_date as string,
    code: r.gold_type_code as string,
    sales: Number(r.sales ?? 0),
    revenue: Number(r.revenue ?? 0),
  }))

  // Keyed on the date so moving to another day mounts a fresh grid. A new day is
  // a new set of figures, and anything half-typed for the old one must not
  // survive into it.
  return (
    <PriceGrid
      key={date}
      date={date}
      previous={dayBefore(date)}
      rows={rows}
      spot={spot}
      uncosted={uncosted}
      failed={{
        grid: Boolean(gridResult.error),
        spot: Boolean(spotResult.error),
        uncosted: Boolean(uncostedResult.error),
      }}
    />
  )
}
