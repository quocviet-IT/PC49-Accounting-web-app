import { Forbidden } from '@/components/Forbidden'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { can } from '@/lib/auth/roles'
import { createServerSupabase } from '@/lib/supabase/server'
import { findReport } from '@/lib/domain/reports'
import { ReportHub } from '@/components/reports/ReportHub'
import { ReportView, type ReportData } from '@/components/reports/ReportView'

/** The last day of a month, which is the date an as-at report is taken at. */
function endOf(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    report?: string; period?: string; date?: string
    from?: string; to?: string; account?: string
  }>
}) {
  const user = await getCurrentUser()
  const role = user?.role ?? null
  if (!can(role, 'report.read')) {
    return <Forbidden locale={user?.locale} />
  }

  const params = await searchParams
  const report = findReport(params.report)

  // No report named: the catalogue. Everything here is one click from the hub,
  // rather than one long page somebody scrolls past two thirds of.
  if (!report) return <ReportHub />

  const period = /^\d{4}-\d{2}$/.test(params.period ?? '')
    ? (params.period as string)
    : new Date().toISOString().slice(0, 7)
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '')
    ? (params.date as string)
    : endOf(period)
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '')
    ? (params.from as string)
    : `${period}-01`
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? '') ? (params.to as string) : endOf(period)

  const supabase = await createServerSupabase()
  const num = (v: unknown) => Number(v ?? 0)
  let data: ReportData = { kind: 'empty' }

  if (report.id === 'pnl') {
    const { data: rows } = await supabase.rpc('pl_report', { p_period: period })
    data = {
      kind: 'pnl',
      lines: (rows ?? []).map((r: Record<string, unknown>) => ({
        code: r.code as string,
        nameVi: r.name_vi as string,
        nameEn: r.name_en as string,
        lineKind: r.kind as 'ACCOUNTS' | 'SUBTOTAL' | 'DIFFERENCE',
        indent: num(r.indent),
        amount: num(r.amount),
      })),
    }
  }

  if (report.id === 'assets') {
    const { data: rows } = await supabase.rpc('total_asset_report', { p_as_of: date })
    const a = Array.isArray(rows) ? rows[0] : rows
    data = a ? {
      kind: 'assets',
      inventoryGram: num(a.inventory_gram),
      inventoryValue: num(a.inventory_value),
      receivable: num(a.receivable),
      payable: num(a.payable),
      cash: num(a.cash),
      bank: num(a.bank),
      total: num(a.cash_flow_total),
    } : { kind: 'empty' }
  }

  if (report.id === 'trial') {
    const { data: rows } = await supabase.rpc('trial_balance', { p_period: period })
    data = {
      kind: 'trial',
      rows: (rows ?? []).map((r: Record<string, unknown>) => ({
        code: r.account_code as string,
        nameVi: r.name_vi as string,
        nameEn: r.name_en as string,
        opening: num(r.opening),
        debit: num(r.debit),
        credit: num(r.credit),
        closing: num(r.closing),
      })),
    }
  }

  if (report.id === 'ledger') {
    const { data: accounts } = await supabase.from('account')
      .select('code, name_vi, name_en').eq('is_active', true).order('sort_order')
    const account = params.account ?? accounts?.[0]?.code ?? '1111'
    const { data: rows } = await supabase.rpc('general_ledger', {
      p_account: account, p_from: from, p_to: to,
    })
    data = {
      kind: 'ledger',
      account,
      accounts: (accounts ?? []).map((a: { code: string; name_vi: string; name_en: string }) => ({
        code: a.code, nameVi: a.name_vi, nameEn: a.name_en,
      })),
      rows: (rows ?? []).map((r: Record<string, unknown>) => ({
        date: r.entry_date as string,
        memo: (r.memo as string) ?? null,
        partner: (r.partner_code as string) ?? null,
        contra: (r.contra_account as string) ?? null,
        debit: num(r.debit),
        credit: num(r.credit),
        balance: num(r.balance),
      })),
    }
  }

  if (report.id === 'stock') {
    const { data: rows } = await supabase.rpc('stock_movement_report', {
      p_period: period, p_owner: 'PC49',
    })
    data = {
      kind: 'stock',
      rows: (rows ?? []).map((r: Record<string, unknown>) => ({
        code: r.gold_type_code as string,
        opening: num(r.opening_gram),
        receipt: num(r.receipt_gram),
        issue: num(r.issue_gram),
        closing: num(r.closing_gram),
        closingValue: num(r.closing_value),
        adjustment: num(r.adjustment),
      })),
    }
  }

  if (report.id === 'deposits') {
    const { data: rows } = await supabase.from('v_deposit_status')
      .select('txn_date, partner_code, gold_type_code, uom, qty, qty_gram, deposit_amount, order_amount, paid_amount, remaining_amount, settled_by, settled_date')
      .order('txn_date', { ascending: false }).limit(300)
    data = {
      kind: 'deposits',
      rows: (rows ?? []).map((r: Record<string, unknown>) => ({
        date: r.txn_date as string,
        partner: (r.partner_code as string) ?? null,
        gold: r.gold_type_code as string,
        qty: num(r.qty),
        gram: num(r.qty_gram),
        amount: num(r.deposit_amount),
        orderAmount: r.order_amount === null ? null : num(r.order_amount),
        paid: num(r.paid_amount),
        remaining: r.remaining_amount === null ? null : num(r.remaining_amount),
        settledBy: (r.settled_by as string) ?? null,
        settledDate: (r.settled_date as string) ?? null,
      })),
    }
  }

  if (report.id === 'apar') {
    const { data: rows } = await supabase.rpc('apar_report', { p_period: period })
    data = {
      kind: 'apar',
      rows: (rows ?? []).map((r: Record<string, unknown>) => ({
        partner: r.partner_code as string,
        account: r.account_code as string,
        opening: num(r.opening_value),
        debit: num(r.debit_value),
        credit: num(r.credit_value),
        closing: num(r.closing_value),
      })),
    }
  }

  if (report.id === 'vendor') {
    const { data: rows } = await supabase.from('v_vendor_payable')
      .select('partner_code, gold_type_code, qty, purchased_value, outstanding')
      .order('outstanding', { ascending: false }).limit(300)
    data = {
      kind: 'vendor',
      rows: (rows ?? []).map((r: Record<string, unknown>) => ({
        partner: (r.partner_code as string) ?? '(unknown)',
        gold: r.gold_type_code as string,
        qty: num(r.qty),
        purchased: num(r.purchased_value),
        outstanding: num(r.outstanding),
      })),
    }
  }

  return (
    <ReportView
      report={report}
      period={period}
      date={date}
      from={from}
      to={to}
      data={data}
    />
  )
}
