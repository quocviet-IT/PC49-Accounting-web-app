import type { DepositInfo, ReceiptRow } from './types'

/**
 * A deposit's collection (spec 2026-09-17, 0087).
 *
 * Pure: what the ledger row and the pickup form both need to agree on.
 */

/** Whether a row offers "Lấy hàng": a deposit nobody has collected or cancelled. */
export function canPickUp(row: Pick<ReceiptRow, 'deposit' | 'conversion'>): boolean {
  return !row.conversion && row.deposit?.role === 'deposit' && !row.deposit.settledBy
}

/** What is left to pay when the gold is collected; null when nobody recorded the order's value. */
export function leftToPay(info: Pick<DepositInfo, 'orderValue' | 'paid'>): number | null {
  if (info.orderValue === null) return null
  return Math.max(Math.round((info.orderValue - info.paid) * 100) / 100, 0)
}
