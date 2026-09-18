import { leftToPay } from './pickup'
import type { ReceiptRow } from './types'

/**
 * Paying the rest of a receipt later (spec 2026-09-17, 0083).
 *
 * Pure: what the ledger row and the payment form both need to agree on.
 */

/** The kinds of receipt something can be owed on (pc49.settlement_side). */
export const SETTLEABLE_TYPES = new Set(['PO', 'PO_VENDOR', 'SALE', 'PICKUP'])

/** Whether anything is still owed. Less than half a cent is paid. */
export const owes = (row: Pick<ReceiptRow, 'owed'>) => (row.owed ?? 0) >= 0.005

/**
 * Whether a row offers "Thanh toán tiếp": a purchase or a sale that still owes,
 * or one paid up by later payments, one of which may yet need cancelling.
 *
 * On a deposit it is "Thêm tiền cọc" (0089): offered while nobody has collected
 * the gold and something is left of the order, or nobody recorded its value.
 */
export function canSettle(
  row: Pick<ReceiptRow, 'txn_type' | 'conversion' | 'owed' | 'settlements' | 'deposit'>,
): boolean {
  if (row.conversion) return false
  const later = (row.settlements ?? []).length > 0
  if (row.txn_type === 'DEPOSIT') {
    const info = row.deposit
    if (later) return true
    if (info?.role !== 'deposit' || info.settledBy) return false
    const left = leftToPay(info)
    return left === null || left >= 0.005
  }
  if (!SETTLEABLE_TYPES.has(row.txn_type)) return false
  return owes(row) || later
}

/** Everything paid on a receipt so far, at the counter and since, to the cent. */
export function paidSoFar(row: Pick<ReceiptRow, 'payments' | 'settlements'>): number {
  const cents = [...row.payments, ...(row.settlements ?? [])]
    .reduce((sum, p) => sum + Math.round(p.amount * 100), 0)
  return cents / 100
}
