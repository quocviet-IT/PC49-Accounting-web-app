import { ImportView, type Batch, type RejectedRow, type ReconLine } from '@/components/import/ImportView'
import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'

export default async function ImportPage({
  searchParams,
}: { searchParams: Promise<{ asOf?: string; batch?: string }> }) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'dataImport.run')) {
    return <Forbidden locale={user?.locale} />
  }

  const params = await searchParams
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.asOf ?? '')
    ? (params.asOf as string)
    : new Date().toISOString().slice(0, 10)

  const supabase = await createServerSupabase()
  const [batchResult, reconResult] = await Promise.all([
    supabase.from('v_import_batch_summary').select('*').order('started_at', { ascending: false }),
    supabase.rpc('import_reconciliation', { p_as_of: asOf }),
  ])

  const batches: Batch[] = (batchResult.data ?? []).map((r: Record<string, unknown>) => ({
    id: r.batch_id as string,
    source: r.source as string,
    fileName: (r.file_name as string) ?? null,
    rowCount: Number(r.row_count ?? 0),
    validCount: Number(r.valid_count ?? 0),
    rejectedCount: Number(r.rejected_count ?? 0),
    committedCount: Number(r.committed_count ?? 0),
    committedAt: (r.committed_at as string) ?? null,
  }))

  // The batch being looked at: whichever was asked for, otherwise the newest
  // one that still has something to answer for.
  const selected = batches.find((b) => b.id === params.batch)
    ?? batches.find((b) => b.rejectedCount > 0 && !b.committedAt)
    ?? batches[0]
    ?? null

  let rejected: RejectedRow[] = []
  let rejectedFailed = false
  if (selected) {
    const { data, error } = await supabase
      .from('import_row')
      .select('row_no, reason, reason_code, reason_value, payload')
      .eq('batch_id', selected.id)
      .eq('status', 'REJECTED')
      .order('row_no')
    // This error used to be discarded. An empty list here is the statement
    // that every row in the batch went in, which is exactly what somebody
    // opens this screen to check.
    rejectedFailed = Boolean(error)
    rejected = (data ?? []).map((r: Record<string, unknown>) => ({
      rowNo: Number(r.row_no ?? 0),
      reason: (r.reason as string) ?? '',
      reasonCode: (r.reason_code as string) ?? null,
      reasonValue: (r.reason_value as string) ?? null,
      payload: (r.payload ?? {}) as Record<string, unknown>,
    }))
  }

  const recon: ReconLine[] = (reconResult.data ?? []).map((r: Record<string, unknown>) => ({
    metric: r.metric as string,
    metricKey: r.metric_key as string,
    expected: Number(r.expected ?? 0),
    actual: Number(r.actual ?? 0),
    difference: Number(r.difference ?? 0),
    agrees: Boolean(r.agrees),
  }))

  return (
    <ImportView
        asOf={asOf}
        batches={batches}
        selected={selected}
        rejected={rejected}
        recon={recon}
        loadFailed={{
          batches: Boolean(batchResult.error),
          rejected: rejectedFailed,
          recon: Boolean(reconResult.error),
        }}
      />
  )
}
