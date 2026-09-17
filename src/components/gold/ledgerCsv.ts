/**
 * The gold ledger as a block of a CSV file.
 *
 * Pure: receipts in, a Sheet out; the route sends it. One line per item, as the
 * books hold them, so the amount column adds up to what the receipts came to.
 * The receipt's number, day and customer are repeated on every line so a
 * filtered or sorted sheet still says whose item it is; what was paid, later
 * payments included, and what is still owed are on the first line only,
 * because repeated they would read as paid again. Figures stay numbers, and
 * something that is not there is an empty cell.
 */
import { t, type Locale, type MessageKey } from '@/lib/i18n'
import type { Sheet } from '@/lib/export/csv'
import { toGrams } from '@/lib/domain/units'
import { fineGrams } from './receiptLine'
import { SETTLEABLE_TYPES, paidSoFar } from './settlement'
import type { ReceiptRow } from './types'

const HEADINGS: MessageKey[] = [
  'txn.date', 'txn.col.doc', 'receipt.col.line', 'receipt.itemDesc', 'txn.col.type',
  'txn.col.partner', 'txn.col.phone', 'txn.col.sales', 'txn.col.gold', 'txn.col.scrap',
  'txn.col.qty', 'txn.col.uom', 'txn.col.grams', 'receipt.fine', 'txn.col.price',
  'txn.col.amount', 'txn.col.pay', 'receipt.col.paid', 'receipt.col.owed', 'txn.col.remarks',
]

export function ledgerSheet(
  receipts: ReceiptRow[],
  locale: Locale,
  goldName: (code: string) => string,
): Sheet {
  return {
    header: HEADINGS.map((key) => t(locale, key)),
    rows: receipts.flatMap((r) => {
      // Everybody on the receipt with their share; the lead name alone only
      // when it was never divided.
      const sales = r.soldBy.length
        ? r.soldBy.map((p) => `${p.code} ${p.sharePct}%`).join(' · ')
        : r.sales_person_code
      const paid = [
        ...r.payments.map((p) => `${p.amount} ${p.method}`),
        ...(r.settlements ?? []).map((s) => `${s.amount} ${s.method} ${s.payDate}`),
      ].join(' · ')
      // Only a purchase or a sale is paid for: a memo or a conversion has no
      // figure to put in these two columns.
      const settles = !r.conversion && SETTLEABLE_TYPES.has(r.txn_type)
      return r.lines.map((l, i) => {
        const scrap = [l.scrap_detail, l.gold_pct].filter((x) => x !== null && x !== '').join(' · ')
        const fine = fineGrams(l.uom, l.qty, l.gold_pct)
        return [
          r.txn_date, r.doc_no, l.lineNo,
          // A conversion's leg has no description; which side it is on is what
          // somebody filtering the sheet needs.
          l.itemDesc ?? (l.side ? t(locale, l.side === 'out' ? 'conversion.side.out' : 'conversion.side.in') : null),
          r.txn_type,
          r.partner_code, r.partner_phone, sales || null, goldName(l.gold_type_code), scrap || null,
          l.qty, l.uom, toGrams(l.qty, l.uom), fine === null ? null : Math.round(fine * 10000) / 10000,
          l.unit_price, l.amount, i === 0 ? (paid || null) : null,
          i === 0 && settles ? paidSoFar(r) : null,
          i === 0 && settles ? (r.owed ?? 0) : null,
          r.remarks,
        ]
      })
    }),
  }
}
