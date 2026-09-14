import type { SavedRow } from './types'

export type TransactionStatusFilter = 'correctable' | 'locked'

export type GoldTransactionFilters = {
  query: string
  txnType: string | null
  goldTypeCode: string | null
  staff: string | null
  paymentMethod: string | null
  status: TransactionStatusFilter | null
}

/**
 * Make counter searches forgiving of Vietnamese accents, punctuation in phone
 * numbers, and differences in case. This remains deliberately locale-neutral:
 * the same normalized value is used for both languages offered by the app.
 */
export function normalizeTransactionSearch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, (letter) => (letter === 'Đ' ? 'D' : 'd'))
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function filterGoldTransactions(
  rows: SavedRow[],
  filters: GoldTransactionFilters,
  partnerPhones: ReadonlyMap<string, string | null>,
): SavedRow[] {
  const query = normalizeTransactionSearch(filters.query)

  return rows.filter((row) => {
    if (filters.txnType && row.txn_type !== filters.txnType) return false
    if (filters.goldTypeCode && row.gold_type_code !== filters.goldTypeCode) return false
    if (filters.staff
      && row.sales_person_code !== filters.staff
      && !row.soldBy.some((person) => person.code === filters.staff)) return false
    if (filters.paymentMethod && !row.payments.some((payment) => payment.method === filters.paymentMethod)) {
      return false
    }
    if (filters.status === 'correctable' && row.blockedReason) return false
    if (filters.status === 'locked' && !row.blockedReason) return false
    if (!query) return true

    return [
      row.doc_no,
      row.partner_code,
      row.partner_code ? partnerPhones.get(row.partner_code) : null,
      row.remarks,
    ].some((value) => normalizeTransactionSearch(value).includes(query))
  })
}
