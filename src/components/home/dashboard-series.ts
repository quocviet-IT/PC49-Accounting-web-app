export type DashboardTransactionRow = {
  txnDate: string
  txnType: string
  amount: number
}

export type DailyTransactionValue = {
  date: string
  purchases: number
  sales: number
}

export type TransactionTypeCount = {
  txnType: string
  count: number
}

export type DashboardTransactionSummary = {
  daily: DailyTransactionValue[]
  byType: TransactionTypeCount[]
  transactionCount: number
}

const DAY_MS = 86_400_000
const WINDOW_DAYS = 30

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseIsoDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected an ISO calendar date, received ${value}`)
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf()) || isoDay(date) !== value) {
    throw new Error(`Invalid ISO calendar date: ${value}`)
  }
  return date
}

export function dashboardActivityEnd(value: string | undefined, today: string): string {
  if (!value) return today
  try {
    parseIsoDay(value)
    return value
  } catch {
    return today
  }
}

export function dashboardDateRange(asOf: string): { start: string; end: string } {
  const end = parseIsoDay(asOf)
  return {
    start: isoDay(new Date(end.valueOf() - (WINDOW_DAYS - 1) * DAY_MS)),
    end: asOf,
  }
}

export function aggregateDashboardTransactions(
  rows: DashboardTransactionRow[],
  asOf: string,
): DashboardTransactionSummary {
  const range = dashboardDateRange(asOf)
  const start = parseIsoDay(range.start)
  const daily = Array.from({ length: WINDOW_DAYS }, (_, index) => ({
    date: isoDay(new Date(start.valueOf() + index * DAY_MS)),
    purchases: 0,
    sales: 0,
  }))
  const dayByDate = new Map(daily.map((day) => [day.date, day]))
  const countByType = new Map<string, number>()
  let transactionCount = 0

  for (const row of rows) {
    const day = dayByDate.get(row.txnDate)
    if (!day) continue

    transactionCount += 1
    countByType.set(row.txnType, (countByType.get(row.txnType) ?? 0) + 1)

    const amount = Number(row.amount)
    if (!Number.isFinite(amount)) continue
    // The books keep what a purchase paid as a negative amount and what a sale
    // took in as a positive one (0012: gold_txn_purchase_sign, _sale_sign). The
    // chart draws money changing hands, so a purchase counts by what was paid.
    if (row.txnType === 'PO' || row.txnType === 'PO_VENDOR') day.purchases -= amount
    if (row.txnType === 'SALE') day.sales += amount
  }

  const byType = [...countByType].map(([txnType, count]) => ({ txnType, count }))
    .sort((a, b) => b.count - a.count || a.txnType.localeCompare(b.txnType))

  return { daily, byType, transactionCount }
}
