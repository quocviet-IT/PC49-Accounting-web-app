import type { OwnerShare, Receipt } from './types'

/**
 * How much metal an owner is still owed on a lot.
 *
 * Taking the money instead finishes an owner (0050): the database closes a lot
 * once every owner has a receipt, of either kind. The screen counted grams
 * only — and a cash settlement carries no grams — so a partner who had been
 * paid in full still read as owed their whole bag, and "Đóng lô" stayed greyed
 * out for good on a lot the database would have closed without complaint.
 */
export function owedGram(share: OwnerShare, receipts: Receipt[]): number {
  const paid = receipts.some((r) => r.ownerCode === share.ownerCode && r.settleKind === 'CASH')
  if (paid) return 0
  return Math.max(0, Math.round((share.assayWeightGram - share.receivedGram) * 10000) / 10000)
}

/**
 * Whether every owner has been settled with, one way or the other.
 *
 * A lot with no bags on it is not finished, it is empty, so it does not close
 * here either.
 */
export function everybodySettled(shares: OwnerShare[], receipts: Receipt[]): boolean {
  return shares.length > 0 && shares.every((s) => owedGram(s, receipts) === 0)
}
