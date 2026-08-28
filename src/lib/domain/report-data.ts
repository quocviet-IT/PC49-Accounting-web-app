import type { ReportId } from '@/lib/domain/reports'
import type { Cell, Sheet } from '@/lib/export/csv'
import { t, type Locale } from '@/lib/i18n'

/**
 * A report as rows, for the file.
 *
 * One place decides what a report contains, so the screen and the download
 * cannot disagree. They did: the download always wrote the same three blocks
 * whatever report was open, which is worse than no download — a file that says
 * it is a trial balance and holds a profit and loss is a file somebody acts on.
 *
 * The screen builds its own shapes because it draws indents, running balances
 * and colour; this builds the flat version. Both read the same functions, which
 * is the part that has to be shared.
 */
/**
 * What this needs from the Supabase client, and no more.
 *
 * The real client is generic over the schema it is bound to, and this module is
 * bound to none — it is handed one and asked for rows.
 */
type Reader = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }>
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => {
        limit: (n: number) => PromiseLike<{ data: unknown }>
      }
    }
  }
}

export type ReportWindow = {
  period: string
  date: string
  from: string
  to: string
  account?: string
}

export async function reportSheets(
  supabase: Reader,
  report: ReportId,
  window: ReportWindow,
  locale: Locale,
): Promise<Sheet[]> {
  const label = (key: Parameters<typeof t>[1]) => t(locale, key)
  const num = (v: unknown) => Number(v ?? 0)
  const rows = (data: unknown): Record<string, unknown>[] =>
    Array.isArray(data) ? (data as Record<string, unknown>[]) : []

  if (report === 'pnl') {
    const { data } = await supabase.rpc('pl_report', { p_period: window.period })
    return [{
      title: `${label('rep.pl')} — ${window.period}`,
      header: [label('rep.line'), label('rep.amount')],
      rows: rows(data).map((r): Cell[] => [
        // The indent carries the report's structure; spaces keep it in a file
        // that has no notion of one.
        `${'    '.repeat(num(r.indent))}${locale === 'vi' ? r.name_vi : r.name_en}`,
        num(r.amount),
      ]),
    } as Sheet]
  }

  if (report === 'trial') {
    const { data } = await supabase.rpc('trial_balance', { p_period: window.period })
    const list = rows(data)
    return [{
      title: `${label('rep.trial')} — ${window.period}`,
      header: [label('rep.account'), label('rep.line'), label('rep.opening'),
               label('journal.debit'), label('journal.credit'), label('rep.closing')],
      rows: [
        ...list.map((r): Cell[] => [
          r.account_code as string,
          (locale === 'vi' ? r.name_vi : r.name_en) as string,
          num(r.opening), num(r.debit), num(r.credit), num(r.closing),
        ]),
        // The proof travels with the figures. A trial balance in a spreadsheet
        // without its totals is a table somebody has to re-add.
        [label('common.total'), '', null,
         list.reduce((s, r) => s + num(r.debit), 0),
         list.reduce((s, r) => s + num(r.credit), 0), null],
      ],
    } as Sheet]
  }

  if (report === 'ledger') {
    const { data } = await supabase.rpc('general_ledger', {
      p_account: window.account ?? '1111', p_from: window.from, p_to: window.to,
    })
    return [{
      title: `${label('rep.ledger')} — ${window.account} — ${window.from} … ${window.to}`,
      header: [label('journal.date'), label('rep.contra'), label('journal.memo'),
               label('journal.debit'), label('journal.credit'), label('rep.runningBalance')],
      rows: rows(data).map((r): Cell[] => [
        r.entry_date as string,
        (r.contra_account as string) ?? '',
        (r.memo as string) ?? '',
        num(r.debit), num(r.credit), num(r.balance),
      ]),
    } as Sheet]
  }

  if (report === 'apar') {
    const { data } = await supabase.rpc('apar_report', { p_period: window.period })
    return [{
      title: `${label('rep.apar')} — ${window.period}`,
      header: [label('rep.partner'), label('rep.account'), label('rep.opening'),
               label('journal.debit'), label('journal.credit'), label('rep.closing')],
      rows: rows(data).map((r): Cell[] => [
        r.partner_code as string, r.account_code as string,
        num(r.opening_value), num(r.debit_value), num(r.credit_value), num(r.closing_value),
      ]),
    } as Sheet]
  }

  if (report === 'stock') {
    const { data } = await supabase.rpc('stock_movement_report', {
      p_period: window.period, p_owner: 'PC49',
    })
    return [{
      title: `${label('rep.stock')} — ${window.period}`,
      header: [label('inv.goldType'), label('inv.opening'), label('inv.receipt'),
               label('inv.issue'), label('inv.closing'), label('inv.adjustment'),
               label('rep.closingValue')],
      rows: rows(data).map((r): Cell[] => [
        r.gold_type_code as string,
        num(r.opening_gram), num(r.receipt_gram), num(r.issue_gram),
        num(r.closing_gram), num(r.adjustment), num(r.closing_value),
      ]),
    } as Sheet]
  }

  if (report === 'deposits') {
    const { data } = await supabase.from('v_deposit_status')
      .select('txn_date, partner_code, gold_type_code, qty_gram, deposit_amount, settled_by, settled_date')
      .order('txn_date', { ascending: false }).limit(1000)
    return [{
      title: label('rep.deposits'),
      header: [label('journal.date'), label('rep.partner'), label('inv.goldType'),
               label('inv.gram'), label('rep.amount'), label('rep.settled')],
      rows: rows(data).map((r): Cell[] => [
        r.txn_date as string,
        (r.partner_code as string) ?? '',
        r.gold_type_code as string,
        Math.abs(num(r.qty_gram)), num(r.deposit_amount),
        (r.settled_by as string) ?? label('rep.outstanding'),
      ]),
    } as Sheet]
  }

  if (report === 'vendor') {
    const { data } = await supabase.from('v_vendor_payable')
      .select('partner_code, gold_type_code, qty, purchased_value, outstanding')
      .order('outstanding', { ascending: false }).limit(1000)
    return [{
      title: label('rep.vendor'),
      header: [label('rep.partner'), label('inv.goldType'), label('txn.col.qty'),
               label('rep.purchased'), label('cash.outstanding')],
      rows: rows(data).map((r): Cell[] => [
        (r.partner_code as string) ?? '', r.gold_type_code as string,
        num(r.qty), num(r.purchased_value), num(r.outstanding),
      ]),
    } as Sheet]
  }

  // assets
  const { data } = await supabase.rpc('total_asset_report', { p_as_of: window.date })
  const a = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  return [{
    title: `${label('rep.assets')} — ${window.date}`,
    header: [label('rep.line'), label('rep.amount')],
    rows: a ? [
      [label('rep.inventoryValue'), num(a.inventory_value)],
      [label('rep.receivable'), num(a.receivable)],
      [label('rep.payable'), num(a.payable)],
      [label('rep.cash'), num(a.cash)],
      [label('rep.bank'), num(a.bank)],
      [label('rep.cashFlowTotal'), num(a.cash_flow_total)],
    ] : [],
  } as Sheet]
}
