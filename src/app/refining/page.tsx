import { AppShell } from '@/components/AppShell'
import { RefiningView, type LotRow, type ShareRow } from '@/components/refining/RefiningView'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { t } from '@/lib/i18n'

export default async function RefiningPage() {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'refining.write') && !can(role, 'refining.approve')) {
    return <AppShell role={role}><p>{t(user?.locale ?? 'vi', 'auth.forbidden')}</p></AppShell>
  }

  const supabase = await createServerSupabase()
  const [summary, share] = await Promise.all([
    supabase.from('v_refining_lot_summary')
      .select('lot_id, lot_code, status, sent_date, assay_date, received_date, total_assay_gram, spot_variance_per_gram, spot_variance_value')
      .order('sent_date', { ascending: false }),
    supabase.from('v_refining_owner_share')
      .select('lot_id, owner_code, assay_weight_gram, share_pct, received_gram'),
  ])

  const lots: LotRow[] = (summary.data ?? []).map((r: Record<string, unknown>) => ({
    lotId: r.lot_id as string,
    lotCode: r.lot_code as string,
    status: r.status as string,
    sentDate: (r.sent_date as string) ?? null,
    assayDate: (r.assay_date as string) ?? null,
    receivedDate: (r.received_date as string) ?? null,
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

  return <AppShell role={role}><RefiningView lots={lots} shares={shares} /></AppShell>
}
