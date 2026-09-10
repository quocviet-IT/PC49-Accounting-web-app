import { notFound } from 'next/navigation'
import { LotDetail } from '@/components/refining/LotDetail'
import type {
  Bag, BandTotal, GoldOption, Lot, OwnerShare, Purchase, Receipt,
} from '@/components/refining/types'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/**
 * One lot, read the way sheet 3.2 PC49 SCRAP GOLD reads it: the bags that
 * went (green), what the refinery found (blue), and what changed — plus, while
 * it is still a draft, the purchases that could still go in.
 */
export default async function LotPage({ params }: { params: Promise<{ lotId: string }> }) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'refining.write') && !can(role, 'refining.approve')) {
    return <Forbidden locale={user?.locale} />
  }
  const { lotId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(lotId)) notFound()

  const supabase = await createServerSupabase()
  const lotResult = await supabase.from('refining_lot')
    .select('id, lot_code, status, refinery_name, note, sent_date, assay_date, received_date, spot_gold_per_oz_sent, spot_pt_per_oz_sent, spot_gold_per_oz_assay, spot_pt_per_oz_assay, fee_pct_gold, fee_pct_pt')
    .eq('id', lotId).maybeSingle()
  if (lotResult.error) {
    return <LotDetail lot={null} bags={[]} bands={[]} available={[]} picked={[]} shares={[]}
                      receipts={[]} goldTypes={[]} canApprove={false} loadFailed />
  }
  if (!lotResult.data) notFound()
  const r = lotResult.data as Record<string, unknown>
  const lot: Lot = {
    id: r.id as string,
    lotCode: r.lot_code as string,
    status: r.status as Lot['status'],
    refineryName: (r.refinery_name as string) ?? null,
    note: (r.note as string) ?? null,
    sentDate: (r.sent_date as string) ?? null,
    assayDate: (r.assay_date as string) ?? null,
    receivedDate: (r.received_date as string) ?? null,
    spotGoldSent: num(r.spot_gold_per_oz_sent),
    spotPtSent: num(r.spot_pt_per_oz_sent),
    spotGoldAssay: num(r.spot_gold_per_oz_assay),
    spotPtAssay: num(r.spot_pt_per_oz_assay),
    feePctGold: num(r.fee_pct_gold),
    feePctPt: num(r.fee_pct_pt),
  }

  const [lineValues, lineTypes, bands, availableRes, pickedRes, shareRes, receiptRes, types] =
    await Promise.all([
      supabase.from('v_refining_lot_line_value')
        .select('id, seq, owner_code, metal, source_desc, gross_weight_gram, gold_pct, pure_weight_gram, spot_per_oz_sent, loss_pct, estimated_value, spot_per_oz_assay, assay_weight_gram, assay_pct, assay_pure_weight_gram, assay_value, purity_variance, weight_variance, value_variance')
        .eq('lot_id', lotId).order('seq'),
      // The valuation view has no gold type on it (it predates the column
      // being used); read it off the line rather than redefining the view.
      supabase.from('refining_lot_line').select('id, gold_type_code').eq('lot_id', lotId),
      supabase.from('v_refining_lot_source_summary')
        .select('grade_band, gold_type_code, purchase_count, gross_weight_gram, pure_weight_gram, avg_gold_pct, total_cost')
        .eq('lot_id', lotId),
      lot.status === 'DRAFT'
        ? supabase.from('v_refining_available_purchase')
            .select('id, txn_date, doc_no, partner_code, gold_type_code, scrap_detail, gold_pct, grade_band, qty_gram, amount')
            .order('txn_date')
        : Promise.resolve({ data: [], error: null }),
      supabase.from('v_refining_lot_source_purchase')
        .select('id, txn_date, doc_no, partner_code, gold_type_code, scrap_detail, gold_pct, grade_band, qty_gram, amount')
        .eq('lot_id', lotId).order('txn_date'),
      supabase.from('v_refining_owner_share')
        .select('owner_code, assay_weight_gram, share_pct, received_gram').eq('lot_id', lotId),
      supabase.from('refining_receipt')
        .select('id, owner_code, receive_date, settle_kind, gold_type_code, qty_gram, amount_usd')
        .eq('lot_id', lotId).order('receive_date'),
      supabase.from('gold_type').select('code, name_vi, name_en').eq('is_active', true).order('sort_order'),
    ])

  const typeOf = new Map<string, string | null>(
    ((lineTypes.data ?? []) as { id: string; gold_type_code: string | null }[])
      .map((x) => [x.id, x.gold_type_code]))

  const bags: Bag[] = ((lineValues.data ?? []) as Record<string, unknown>[]).map((l) => ({
    id: l.id as string,
    lotId,
    seq: Number(l.seq),
    ownerCode: l.owner_code as string,
    metal: l.metal as Bag['metal'],
    goldTypeCode: typeOf.get(l.id as string) ?? null,
    sourceDesc: (l.source_desc as string) ?? null,
    grossWeightGram: num(l.gross_weight_gram),
    goldPct: num(l.gold_pct),
    pureWeightGram: num(l.pure_weight_gram),
    spotPerOzSent: num(l.spot_per_oz_sent),
    lossPct: num(l.loss_pct),
    estimatedValue: num(l.estimated_value),
    spotPerOzAssay: num(l.spot_per_oz_assay),
    assayWeightGram: num(l.assay_weight_gram),
    assayPct: num(l.assay_pct),
    assayPureWeightGram: num(l.assay_pure_weight_gram),
    assayValue: num(l.assay_value),
    purityVariance: num(l.purity_variance),
    weightVariance: num(l.weight_variance),
    valueVariance: num(l.value_variance),
  }))

  const toPurchase = (p: Record<string, unknown>): Purchase => ({
    id: p.id as string,
    txnDate: p.txn_date as string,
    docNo: (p.doc_no as string) ?? null,
    partnerCode: (p.partner_code as string) ?? null,
    goldTypeCode: p.gold_type_code as string,
    scrapDetail: (p.scrap_detail as string) ?? null,
    goldPct: num(p.gold_pct),
    gradeBand: (p.grade_band as string) ?? null,
    qtyGram: Number(p.qty_gram ?? 0),
    amount: Number(p.amount ?? 0),
  })

  const available: Purchase[] = ((availableRes.data ?? []) as Record<string, unknown>[]).map(toPurchase)
  const picked: Purchase[] = ((pickedRes.data ?? []) as Record<string, unknown>[]).map(toPurchase)

  const bandTotals: BandTotal[] = ((bands.data ?? []) as Record<string, unknown>[]).map((b) => ({
    gradeBand: (b.grade_band as string) ?? null,
    goldTypeCode: b.gold_type_code as string,
    purchaseCount: Number(b.purchase_count ?? 0),
    grossWeightGram: Number(b.gross_weight_gram ?? 0),
    pureWeightGram: num(b.pure_weight_gram),
    avgGoldPct: num(b.avg_gold_pct),
    totalCost: Number(b.total_cost ?? 0),
  }))

  const shares: OwnerShare[] = ((shareRes.data ?? []) as Record<string, unknown>[]).map((s) => ({
    ownerCode: s.owner_code as string,
    assayWeightGram: Number(s.assay_weight_gram ?? 0),
    sharePct: Number(s.share_pct ?? 0),
    receivedGram: Number(s.received_gram ?? 0),
  }))

  const receipts: Receipt[] = ((receiptRes.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: x.id as string,
    ownerCode: x.owner_code as string,
    receiveDate: x.receive_date as string,
    settleKind: x.settle_kind as Receipt['settleKind'],
    goldTypeCode: x.gold_type_code as string,
    qtyGram: num(x.qty_gram),
    amountUsd: num(x.amount_usd),
  }))

  const goldTypes: GoldOption[] = ((types.data ?? []) as { code: string; name_vi: string; name_en: string }[])
    .map((g) => ({ code: g.code, nameVi: g.name_vi, nameEn: g.name_en }))

  return (
    <LotDetail
      lot={lot}
      bags={bags}
      bands={bandTotals}
      available={available}
      picked={picked}
      shares={shares}
      receipts={receipts}
      goldTypes={goldTypes}
      canApprove={can(role, 'refining.approve')}
      loadFailed={Boolean(lineValues.error || lineTypes.error || bands.error
        || availableRes.error || pickedRes.error || shareRes.error || receiptRes.error || types.error)}
    />
  )
}
