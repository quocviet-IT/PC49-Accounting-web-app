import { Overview } from '@/components/home/Overview'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { createServerSupabase } from '@/lib/supabase/server'
import { combine, readState, type DataState } from '@/lib/data/result'

export default async function HomePage() {
  // The layout has already refused anyone who is not signed in; this guard is
  // what keeps TypeScript from having to trust that.
  const user = await getCurrentUser()
  if (!user) return null

  const today = new Date().toISOString().slice(0, 10)
  const supabase = await createServerSupabase()

  const [totalAsset, spot, cash, deposits, refinery] = await Promise.all([
    supabase.from('v_inventory_total_asset').select('qty_gram').eq('owner_code', 'PC49'),
    supabase.from('spot_price_daily').select('spot_per_gram, price_date')
      .eq('metal', 'GOLD').lte('price_date', today)
      .order('price_date', { ascending: false }).limit(1).maybeSingle(),
    // Cash still goes through `cash_balance`, so the dashboard and the Cash
    // screen cannot disagree about what a balance is — but the summing happens
    // in the database rather than as one round trip per account.
    supabase.rpc('cash_total', { p_as_of: today }),
    supabase.from('v_deposit_open').select('id', { count: 'exact', head: true }),
    supabase.from('inventory_movement').select('qty_gram')
      .eq('bucket', 'AT_REFINERY').eq('owner_code', 'PC49'),
  ])

  const sumGrams = (rows: { qty_gram: number }[]) =>
    rows.reduce((s, r) => s + Number(r.qty_gram), 0)

  const gram = readState(totalAsset, sumGrams, () => 0)

  // A missing spot price is not a failure to read anything — the read worked
  // and there is no price for the day. So it is `unavailable` with a reason
  // somebody can act on, not an error and certainly not a valuation of zero.
  const spotPerGram: DataState<number> = spot.error
    ? { state: 'error', messageKey: 'common.loadFailed', detail: spot.error.message }
    : spot.data
      ? { state: 'ready', value: Number(spot.data.spot_per_gram),
          fetchedAt: new Date().toISOString() }
      : { state: 'unavailable', reasonKey: 'home.noSpot' }

  const priceDate = spot.data?.price_date as string | undefined

  return (
    <Overview
        inventoryValue={combine(gram, spotPerGram, (g, p) => g * p)}
        cashTotal={readState(cash, (v) => Number(v), () => 0)}
        openDeposits={
          deposits.error
            ? { state: 'error', messageKey: 'common.loadFailed',
                detail: deposits.error.message }
            : { state: 'ready', value: deposits.count ?? 0,
                fetchedAt: new Date().toISOString() }
        }
        atRefineryGram={readState(refinery, sumGrams, () => 0)}
        priceDate={priceDate ?? null}
      />
  )
}
