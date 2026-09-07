import { Overview, type AttentionItem, type RecentRow } from '@/components/home/Overview'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { combine, readState, type DataState } from '@/lib/data/result'

export default async function HomePage() {
  // The layout has already refused anyone who is not signed in; this guard is
  // what keeps TypeScript from having to trust that.
  const user = await getCurrentUser()
  if (!user) return null
  const role = user.role

  const today = new Date().toISOString().slice(0, 10)
  const period = today.slice(0, 7)
  const supabase = await createServerSupabase()

  const mayRead = can(role, 'report.read')
  const mayWriteTxn = can(role, 'goldTxn.write')
  const mayImportBank = can(role, 'bankImport.run')
  const mayRefine = can(role, 'refining.write') || can(role, 'refining.approve')

  const [totalAsset, spot, cash, deposits, refinery, recent, unresolved, uncosted, openLots] =
    await Promise.all([
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
      // The last ten, newest first. No telephone number: it is on the row for
      // whoever is serving that customer, not on a screen anybody may open.
      supabase.from('gold_txn')
        .select('id, txn_date, txn_type, partner_code, gold_type_code, qty, uom, amount, journal_entry_id')
        .is('voided_at', null)
        .order('txn_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('bank_import_row').select('id', { count: 'exact', head: true })
        .is('resolved_at', null),
      supabase.from('v_sale_without_cost').select('txn_id', { count: 'exact', head: true }),
      supabase.from('v_refining_lot_summary').select('lot_id, status'),
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

  const priceDate = (spot.data?.price_date as string | undefined) ?? null

  const counted = (read: { count: number | null; error: { message: string } | null }) =>
    (read.error
      ? { state: 'error' as const, messageKey: 'common.loadFailed' as const,
          detail: read.error.message }
      : { state: 'ready' as const, value: read.count ?? 0,
          fetchedAt: new Date().toISOString() })

  /**
   * What is waiting to be dealt with.
   *
   * Read with this reader's own session, so a role that may not see a queue
   * does not learn its size from a count taken with somebody else's rights.
   * An item nobody may act on is left out rather than shown as a dead end.
   */
  const attention: AttentionItem[] = []
  if (mayImportBank) {
    attention.push({
      key: 'unresolved',
      count: counted(unresolved),
      href: '/cash',
      titleKey: 'home.attn.unresolved',
      scope: period,
    })
  }
  if (mayWriteTxn) {
    attention.push({
      key: 'uncosted',
      count: counted(uncosted),
      href: '/prices',
      titleKey: 'home.attn.uncosted',
      scope: period,
    })
  }
  if (mayRefine) {
    attention.push({
      key: 'lots',
      // "Not finished" and not "overdue": there is no due date on a refining
      // lot, and inventing one to colour a row red would be a claim the data
      // cannot support.
      count: openLots.error
        ? { state: 'error', messageKey: 'common.loadFailed', detail: openLots.error.message }
        : { state: 'ready',
            value: ((openLots.data ?? []) as { status: string }[])
              .filter((l) => l.status !== 'CLOSED').length,
            fetchedAt: new Date().toISOString() },
      href: '/refining',
      titleKey: 'home.attn.lots',
      scope: null,
    })
  }

  const recentRows: DataState<RecentRow[]> = readState(
    recent,
    (rows: Record<string, unknown>[]) => rows.map((r) => ({
      id: r.id as string,
      txnDate: r.txn_date as string,
      txnType: r.txn_type as string,
      partnerCode: (r.partner_code as string) ?? null,
      goldTypeCode: r.gold_type_code as string,
      qty: Number(r.qty),
      uom: r.uom as string,
      amount: Number(r.amount),
      posted: r.journal_entry_id !== null,
    })),
    () => [],
  )

  return (
    <Overview
        inventoryValue={combine(gram, spotPerGram, (g, p) => g * p)}
        inventoryGram={gram}
        cashTotal={readState(cash, (v) => Number(v), () => 0)}
        openDeposits={counted(deposits)}
        atRefineryGram={readState(refinery, sumGrams, () => 0)}
        priceDate={priceDate}
        asOf={today}
        period={period}
        attention={attention}
        recent={recentRows}
        // Only where the capability actually opens the page. A link that leads
        // to Forbidden is worse than no link: it reads as a fault rather than
        // as a boundary.
        links={{
          inventory: mayRead,
          cash: mayRead,
          deposits: mayRead,
          refining: mayRefine,
          newTxn: mayWriteTxn,
          prices: mayWriteTxn,
          bankImport: mayImportBank,
          reports: mayRead,
        }}
      />
  )
}
