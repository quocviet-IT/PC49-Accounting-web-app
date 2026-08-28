import type { MessageKey } from '@/lib/i18n'

/**
 * The reports this system can answer, as plain data.
 *
 * A catalogue rather than a page of stacked tables: the accountant closing a
 * month, the supervisor checking a balance and the owner reading a profit are
 * looking for different things, and one long page makes each of them scroll
 * past the other two.
 *
 * Everything here is derivable from the books. A report that needed a figure
 * typed in would not belong in this list — it would be a screen.
 */

export type ReportGroupId = 'overview' | 'ledger' | 'gold' | 'counterparty'

export type ReportId =
  | 'pnl' | 'assets'
  | 'trial' | 'ledger'
  | 'stock' | 'deposits'
  | 'apar' | 'vendor'

/** Which period control a report needs, which decides what the screen offers. */
export type ReportRange = 'month' | 'day' | 'range'

export type ReportDefinition = {
  id: ReportId
  group: ReportGroupId
  titleKey: MessageKey
  descriptionKey: MessageKey
  range: ReportRange
}

export const REPORT_GROUPS: { id: ReportGroupId; labelKey: MessageKey }[] = [
  { id: 'overview', labelKey: 'rep.group.overview' },
  { id: 'ledger', labelKey: 'rep.group.ledger' },
  { id: 'gold', labelKey: 'rep.group.gold' },
  { id: 'counterparty', labelKey: 'rep.group.counterparty' },
]

export const REPORTS: ReportDefinition[] = [
  {
    id: 'pnl',
    group: 'overview',
    titleKey: 'rep.pl',
    descriptionKey: 'rep.pl.about',
    range: 'month',
  },
  {
    id: 'assets',
    group: 'overview',
    titleKey: 'rep.assets',
    descriptionKey: 'rep.assets.about',
    range: 'day',
  },
  {
    id: 'trial',
    group: 'ledger',
    titleKey: 'rep.trial',
    descriptionKey: 'rep.trial.about',
    range: 'month',
  },
  {
    id: 'ledger',
    group: 'ledger',
    titleKey: 'rep.ledger',
    descriptionKey: 'rep.ledger.about',
    range: 'range',
  },
  {
    id: 'stock',
    group: 'gold',
    titleKey: 'rep.stock',
    descriptionKey: 'rep.stock.about',
    range: 'month',
  },
  {
    id: 'deposits',
    group: 'gold',
    titleKey: 'rep.deposits',
    descriptionKey: 'rep.deposits.about',
    range: 'day',
  },
  {
    id: 'apar',
    group: 'counterparty',
    titleKey: 'rep.apar',
    descriptionKey: 'rep.apar.about',
    range: 'month',
  },
  {
    id: 'vendor',
    group: 'counterparty',
    titleKey: 'rep.vendor',
    descriptionKey: 'rep.vendor.about',
    range: 'day',
  },
]

/** The report a query string names, or nothing when it names none of them. */
export function findReport(id: string | undefined): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id)
}

export function reportsInGroup(group: ReportGroupId): ReportDefinition[] {
  return REPORTS.filter((r) => r.group === group)
}
