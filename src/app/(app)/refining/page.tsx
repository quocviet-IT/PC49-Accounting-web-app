import { RefiningView, type LotRow, type ShareRow } from '@/components/refining/RefiningView'
import type { GoldOption } from '@/components/refining/LotLifecycle'
import type { AvailablePurchase, PickedBand } from '@/components/refining/PurchasePicker'
import type { LotLineValue } from '@/components/refining/LotLines'
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
  const [summary, share, types, availableResult, sourceResult, bandResult,
         lineResult] = await Promise.all([
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
    // The picked purchases, read through the link that scopes them. Reading
    // them as "every transaction, then look some up" fetched the whole history
    // to draw a handful of rows, and would have started losing them silently
    // the moment the table outgrew the API's row cap.
    supabase.from('refining_lot_source')
      .select(`lot_id,
               gold_txn(id, txn_date, partner_code, scrap_detail, gold_pct,
                        qty_gram, amount, voided_at)`),
    supabase.from('v_refining_lot_source_summary')
      .select('lot_id, grade_band, purchase_count, gross_weight_gram, pure_weight_gram, avg_gold_pct, total_cost'),
    // A lot read the way sheet 3.3 reads it: send, assay, and the difference.
    supabase.from('v_refining_lot_line_value')
      .select('lot_id, seq, owner_code, source_desc, gross_weight_gram, gold_pct, pure_weight_gram, estimated_value, assay_pct, assay_weight_gram, assay_pure_weight_gram, assay_value, purity_variance, weight_variance, value_variance')
      .order('seq'),
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

  const pickedByLot = new Map<string, AvailablePurchase[]>()
  // Cast through `unknown` because the generated types call the embedded
  // transaction an array and it is not one. `refining_lot_source.txn_id` is a
  // plain many-to-one reference, and PostgREST returns a single object for it
  // — checked against the client's own API rather than assumed, because
  // guessing wrong here would silently drop every picked purchase.
  for (const link of (sourceResult.data ?? []) as unknown as {
    lot_id: string
    gold_txn: Record<string, unknown> | null
  }[]) {
    // A cancelled purchase is still linked to the lot it was picked into, and
    // still belongs on the list — taking it out silently would make a lot's
    // totals disagree with the rows it says they came from.
    if (!link.gold_txn) continue
    const list = pickedByLot.get(link.lot_id) ?? []
    list.push(toPurchase(link.gold_txn))
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

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

  const linesByLot = new Map<string, LotLineValue[]>()
  for (const r of (lineResult.data ?? []) as Record<string, unknown>[]) {
    const lotId = r.lot_id as string
    const list = linesByLot.get(lotId) ?? []
    list.push({
      lotId,
      seq: Number(r.seq),
      ownerCode: r.owner_code as string,
      sourceDesc: (r.source_desc as string) ?? null,
      grossWeightGram: num(r.gross_weight_gram),
      goldPct: num(r.gold_pct),
      pureWeightGram: num(r.pure_weight_gram),
      estimatedValue: num(r.estimated_value),
      assayPct: num(r.assay_pct),
      assayWeightGram: num(r.assay_weight_gram),
      assayPureWeightGram: num(r.assay_pure_weight_gram),
      assayValue: num(r.assay_value),
      purityVariance: num(r.purity_variance),
      weightVariance: num(r.weight_variance),
      valueVariance: num(r.value_variance),
    })
    linesByLot.set(lotId, list)
  }

  return (
    <RefiningView
        lots={lots}
        shares={shares}
        goldTypes={goldTypes}
        available={available}
        pickedByLot={Object.fromEntries(pickedByLot)}
        bandsByLot={Object.fromEntries(bandsByLot)}
        linesByLot={Object.fromEntries(linesByLot)}
    />
  )
}
