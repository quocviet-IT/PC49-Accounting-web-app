import { AppShell } from '@/components/AppShell'
import { JournalView, type EntryRow } from '@/components/journal/JournalView'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { t } from '@/lib/i18n'

type LineRow = {
  entry_id: string; seq: number
  debit_account: string | null; credit_account: string | null
  amount_usd: number; gold_type_code: string | null; qty_gram: number | null
}

export default async function JournalPage({
  searchParams,
}: { searchParams: Promise<{ period?: string }> }) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'journal.post') && !can(role, 'report.read')) {
    return <AppShell role={role}><p>{t(user?.locale ?? 'vi', 'auth.forbidden')}</p></AppShell>
  }

  const params = await searchParams
  const period = /^\d{4}-\d{2}$/.test(params.period ?? '')
    ? (params.period as string)
    : new Date().toISOString().slice(0, 7)

  const supabase = await createServerSupabase()
  const { data: heads } = await supabase
    .from('journal_entry')
    .select('id, entry_date, memo, posted_at')
    .eq('period', period)
    .is('voided_at', null)
    .order('entry_date')
    .limit(300)

  const ids = (heads ?? []).map((h: { id: string }) => h.id)
  const { data: lines } = ids.length
    ? await supabase.from('journal_line')
        .select('entry_id, seq, debit_account, credit_account, amount_usd, gold_type_code, qty_gram')
        .in('entry_id', ids).order('seq')
    : { data: [] as LineRow[] }

  const byEntry = new Map<string, LineRow[]>()
  for (const l of (lines ?? []) as LineRow[]) {
    byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) ?? []), l])
  }

  const entries: EntryRow[] = (heads ?? []).map((h: {
    id: string; entry_date: string; memo: string | null; posted_at: string | null
  }) => ({
    id: h.id,
    entryDate: h.entry_date,
    memo: h.memo,
    posted: h.posted_at !== null,
    lines: (byEntry.get(h.id) ?? []).map((l) => ({
      seq: l.seq,
      debit: l.debit_account,
      credit: l.credit_account,
      amount: Number(l.amount_usd),
      goldType: l.gold_type_code,
      qtyGram: l.qty_gram === null ? null : Number(l.qty_gram),
    })),
  }))

  return <AppShell role={role}><JournalView period={period} entries={entries} /></AppShell>
}
