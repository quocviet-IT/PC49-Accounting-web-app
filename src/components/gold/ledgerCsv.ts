/**
 * The gold ledger as a block of a CSV file.
 *
 * Pure: rows in, a Sheet out; the route sends it. Figures stay numbers so a
 * column can be summed in Excel, and something that is not there is an empty
 * cell rather than a dash somebody has to delete before they can add up.
 */
import { t, type Locale, type MessageKey } from '@/lib/i18n'
import type { Sheet } from '@/lib/export/csv'
import { toGrams } from '@/lib/domain/units'
import type { LedgerRow } from './types'

const HEADINGS: MessageKey[] = [
  'txn.date', 'txn.col.doc', 'txn.col.type', 'txn.col.partner', 'txn.col.phone',
  'txn.col.sales', 'txn.col.gold', 'txn.col.scrap', 'txn.col.qty', 'txn.col.uom',
  'txn.col.grams', 'txn.col.price', 'txn.col.amount', 'txn.col.pay', 'txn.col.remarks',
]

export function ledgerSheet(
  rows: LedgerRow[],
  locale: Locale,
  goldName: (code: string) => string,
): Sheet {
  return {
    header: HEADINGS.map((key) => t(locale, key)),
    rows: rows.map((r) => {
      const scrap = [r.scrap_detail, r.gold_pct].filter((x) => x !== null && x !== '').join(' · ')
      // Everybody on the order with their share; the lead name alone only when
      // the order was never divided.
      const sales = r.soldBy.length
        ? r.soldBy.map((p) => `${p.code} ${p.sharePct}%`).join(' · ')
        : r.sales_person_code
      const paid = r.payments.map((p) => `${p.amount} ${p.method}`).join(' · ')
      return [
        r.txn_date, r.doc_no, r.txn_type, r.partner_code, r.partner_phone,
        sales || null, goldName(r.gold_type_code), scrap || null,
        r.qty, r.uom, toGrams(r.qty, r.uom), r.unit_price, r.amount,
        paid || null, r.remarks,
      ]
    }),
  }
}
