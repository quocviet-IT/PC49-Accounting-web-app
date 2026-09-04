import { RefiningView, type LotRow, type ShareRow } from '@/components/refining/RefiningView'
import type { GoldOption } from '@/components/refining/LotLifecycle'
import type { AvailablePurchase, PickedBand } from '@/components/refining/PurchasePicker'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function RefiningPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'refining.write') && !can(role, 'refining.approve')) {
    return <Forbidden locale={user?.locale} />
  }

  const supabase = await createServerSupabase()
  const [summary, share, types, availableResult, sourceResult, bandResult, txnResult] =
    await Promise.all([
    supabase.from('v_refining_lot_summary')
      .select('lot_id, lot_code, status, sent_date, assay_date, received_date, total_gross_gram, total_assay_gram, spot_variance_per_gram, spot_variance_value')
      .order('sent_date', { ascending: false }),
    supabase.from('v_refining_owner_share')
      .select('lot_id, owner_code, assay_weight_gram, share_pct, received_gram'),
    supabase.from('gold_type').select('code, name_vi, name_en')
      .eq('is_active', true).order('sort_order'),
    // The scrap bought but not yet sent anywhere, which is the list the
    // checkbox column sits beside in sheet 1.Scrap Gold.
    supabase.from('v_refining_available_purchase')
      .select('id, txn_date, partner_code, scrap_detail, gold_pct, grade_band, qty_gram, amount')
      .order('txn_date'),
    supabase.from('refining_lot_source').select('lot_id, txn_id'),
    supabase.from('v_refining_lot_source_summary')
      .select('lot_id, grade_band, purchase_count, gross_weight_gram, pure_weight_gram, avg_gold_pct, total_cost'),
    // Picked rows are no longer "available", so they are read as themselves.
    supabase.from('gold_txn')
      .select('id, txn_date, partner_code, scrap_detail, gold_pct, qty_gram, amount')
      .is('voided_at', null),
  ])

  const lots: LotRow[] = (summary.data ?? []).map((r: Record<string, unknown>) => ({
    lotId: r.lot_id as string,
    lotCode: r.lot_code as string,
    status: r.status as string,
    sentDate: (r.sent_date as string) ?? null,
    assayDate: (r.assay_date as string) ?? null,
    receivedDate: (r.received_date as string) ?? null,
    totalGrossGram: Number(r.total_gross_gram ?? 0),
    totalAssayGram: Number(r.total_assay_gram ?? 0),
    spotVariancePerGram: r.spot_variance_per_gram === null ? null : Number(r.spot_variance_per_gram),
    spotVarianceValue: r.spot_variance_value === null ? null : Number(r.spot_variance_value),
  }))

  const shares: ShareRow[] = (share.data ?? []).map((r: Record<string, unknown>) => ({
    lotId: r.lot_id as string,
    ownerCode: r.owner_code as string,
    assayWeightGram: Number(r.assay_weight_gram ?? 0),
    sharePct: Number(r.share_pct ?? 0),
    receivedGram: Number(r.received_gram ?? 0),
  }))

  const goldTypes: GoldOption[] = (types.data ?? []).map(
    (g: { code: string; name_vi: string; name_en: string }) => ({
      code: g.code, nameVi: g.name_vi, nameEn: g.name_en,
    }))

  const toPurchase = (r: Record<string, unknown>): AvailablePurchase => ({
    id: r.id as string,
    txnDate: r.txn_date as string,
    partnerCode: (r.partner_code as string) ?? null,
    scrapDetail: (r.scrap_detail as string) ?? null,
    goldPct: r.gold_pct === null || r.gold_pct === undefined ? null : Number(r.gold_pct),
    gradeBand: (r.grade_band as string) ?? null,
    qtyGram: Number(r.qty_gram ?? 0),
    amount: Number(r.amount ?? 0),
  })

  const available: AvailablePurchase[] = (availableResult.data ?? []).map(toPurchase)

  const txnById = new Map<string, Record<string, unknown>>(
    (txnResult.data ?? []).map((r: Record<string, unknown>) => [r.id as string, r]))

  const pickedByLot = new Map<string, AvailablePurchase[]>()
  for (const link of (sourceResult.data ?? []) as { lot_id: string; txn_id: string }[]) {
    const txn = txnById.get(link.txn_id)
    if (!txn) continue
    const list = pickedByLot.get(link.lot_id) ?? []
    list.push(toPurchase(txn))
    pickedByLot.set(link.lot_id, list)
  }

  const bandsByLot = new Map<string, PickedBand[]>()
  for (const r of (bandResult.data ?? []) as Record<string, unknown>[]) {
    const lotId = r.lot_id as string
    const list = bandsByLot.get(lotId) ?? []
    list.push({
      gradeBand: (r.grade_band as string) ?? null,
      purchaseCount: Number(r.purchase_count ?? 0),
      grossWeightGram: Number(r.gross_weight_gram ?? 0),
      pureWeightGram: Number(r.pure_weight_gram ?? 0),
      avgGoldPct: r.avg_gold_pct === null || r.avg_gold_pct === undefined
        ? null : Number(r.avg_gold_pct),
      totalCost: Number(r.total_cost ?? 0),
    })
    bandsByLot.set(lotId, list)
  }

  return (
    <RefiningView
        lots={lots}
        shares={shares}
        goldTypes={goldTypes}
        available={available}
        pickedByLot={Object.fromEntries(pickedByLot)}
        bandsByLot={Object.fromEntries(bandsByLot)}
    />
  )
}
