import { Overview } from '@/components/home/Overview'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function HomePage() {
  // The layout has already refused anyone who is not signed in; this guard is
  // what keeps TypeScript from having to trust that.
  const user = await getCurrentUser()
  if (!user) return null

  const today = new Date().toISOString().slice(0, 10)
  const supabase = await createServerSupabase()

  const [totalAsset, spot, cash, deposits, refinery] = await Promise.all([
    supabase.from('v_inventory_total_asset').select('qty_gram').eq('owner_code', 'PC49'),
    supabase.from('spot_price_daily').select('spot_per_gram')
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

  const gram = (totalAsset.data ?? []).reduce(
    (s: number, r: { qty_gram: number }) => s + Number(r.qty_gram), 0)
  const spotPerGram = spot.data ? Number(spot.data.spot_per_gram) : null

  const cashTotal = Number(cash.data ?? 0)

  const atRefinery = (refinery.data ?? []).reduce(
    (s: number, r: { qty_gram: number }) => s + Number(r.qty_gram), 0)

  return (
    <Overview
        inventoryValue={spotPerGram === null ? null : gram * spotPerGram}
        cashTotal={cashTotal}
        openDeposits={deposits.count ?? 0}
        atRefineryGram={atRefinery}
        spotMissing={spotPerGram === null}
      />
  )
}
