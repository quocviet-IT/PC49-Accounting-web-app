import { LotList } from '@/components/refining/LotList'
import type { LotRow } from '@/components/refining/types'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * Every lot, newest first, with what it was estimated at and what it settled
 * for. One row per shipment — the detail lives on its own page.
 */
export default async function RefiningPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'refining.write') && !can(role, 'refining.approve')) {
    return <Forbidden locale={user?.locale} />
  }

  const supabase = await createServerSupabase()
  const [lots, lines] = await Promise.all([
    supabase.from('refining_lot')
      .select('id, lot_code, status, refinery_name, note, sent_date, assay_date, received_date, spot_gold_per_oz_sent, spot_pt_per_oz_sent, spot_gold_per_oz_assay, spot_pt_per_oz_assay, fee_pct_gold, fee_pct_pt, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('v_refining_lot_line_value')
      .select('lot_id, gross_weight_gram, assay_weight_gram, estimated_value, assay_value'),
  ])

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const byLot = new Map<string, { bags: number; gross: number; assay: number; est: number; settled: number }>()
  for (const l of (lines.data ?? []) as Record<string, unknown>[]) {
    const id = l.lot_id as string
    const acc = byLot.get(id) ?? { bags: 0, gross: 0, assay: 0, est: 0, settled: 0 }
    acc.bags += 1
    acc.gross += Number(l.gross_weight_gram ?? 0)
    acc.assay += Number(l.assay_weight_gram ?? 0)
    acc.est += Number(l.estimated_value ?? 0)
    acc.settled += Number(l.assay_value ?? 0)
    byLot.set(id, acc)
  }

  const rows: LotRow[] = ((lots.data ?? []) as Record<string, unknown>[]).map((r) => {
    const t = byLot.get(r.id as string) ?? { bags: 0, gross: 0, assay: 0, est: 0, settled: 0 }
    return {
      id: r.id as string,
      lotCode: r.lot_code as string,
      status: r.status as LotRow['status'],
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
      bagCount: t.bags,
      totalGrossGram: t.gross,
      totalAssayGram: t.assay,
      estimatedValue: t.est,
      assayValue: t.settled,
    }
  })

  return (
    <LotList
      lots={rows}
      // The lot list, or the bags that give it its figures, did not arrive.
      // Offering to open a new lot on the strength of a read that failed is
      // how a lot already at the refinery gets opened a second time.
      loadFailed={Boolean(lots.error || lines.error)}
    />
  )
}
