import { AppShell } from '@/components/AppShell'
import { Overview } from '@/components/home/Overview'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function HomePage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!user) return <AppShell role={null}><span /></AppShell>

  const today = new Date().toISOString().slice(0, 10)
  const supabase = await createServerSupabase()

  const [totalAsset, spot, accounts, deposits, refinery] = await Promise.all([
    supabase.from('v_inventory_total_asset').select('qty_gram').eq('owner_code', 'PC49'),
    supabase.from('spot_price_daily').select('spot_per_gram')
      .eq('metal', 'GOLD').lte('price_date', today)
      .order('price_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('cash_account').select('code, account_type').eq('is_active', true),
    supabase.from('v_deposit_open').select('id', { count: 'exact', head: true }),
    supabase.from('inventory_movement').select('qty_gram')
      .eq('bucket', 'AT_REFINERY').eq('owner_code', 'PC49'),
  ])

  const gram = (totalAsset.data ?? []).reduce(
    (s: number, r: { qty_gram: number }) => s + Number(r.qty_gram), 0)
  const spotPerGram = spot.data ? Number(spot.data.spot_per_gram) : null

  // Cash is summed per account through the balance function, so the dashboard
  // and the Cash screen can never disagree about what a balance is.
  let cashTotal = 0
  for (const a of (accounts.data ?? []) as { code: string; account_type: string }[]) {
    if (a.account_type === 'CLEARING') continue
    const { data } = await supabase.rpc('cash_balance', { p_account: a.code, p_as_of: today })
    cashTotal += Number(data ?? 0)
  }

  const atRefinery = (refinery.data ?? []).reduce(
    (s: number, r: { qty_gram: number }) => s + Number(r.qty_gram), 0)

  return (
    <AppShell role={role}>
      <Overview
        inventoryValue={spotPerGram === null ? null : gram * spotPerGram}
        cashTotal={cashTotal}
        openDeposits={deposits.count ?? 0}
        atRefineryGram={atRefinery}
        spotMissing={spotPerGram === null}
      />
    </AppShell>
  )
}
