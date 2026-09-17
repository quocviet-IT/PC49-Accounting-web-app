import type { Uom } from '@/lib/domain/units'
import { amountOf, SCRAP_TYPES, type ReceiptLine } from './types'

/** More than this on one receipt is refused by the database too (0074). */
export const MAX_RECEIPT_LINES = 30

/** Deposits and pickups are tied to each other one transaction at a time. */
export const SINGLE_LINE_TYPES = new Set(['DEPOSIT', 'PICKUP'])

/**
 * The receipt types whose sign the table already fixes (0012): a purchase
 * brings gold in, a sale or a pickup takes it out. On these a quantity is
 * typed without a sign and the type supplies it; six items on one receipt were
 * six chances to forget a minus, and the database refused each. Every other
 * type keeps the sign it is typed with, because there the sign is the only
 * thing saying whether the gold is on its way in or out.
 */
const INWARD = new Set(['PO', 'PO_VENDOR'])
const OUTWARD = new Set(['SALE', 'PICKUP'])

export function signFollowsType(txnType: string): boolean {
  return INWARD.has(txnType) || OUTWARD.has(txnType)
}

export function signedQty(txnType: string, typed: number): number {
  if (INWARD.has(txnType)) return Math.abs(typed)
  if (OUTWARD.has(txnType)) return -Math.abs(typed)
  return typed
}

/** One item as the form holds it. The money is unsigned, as on the paper. */
export type LineField = {
  itemDesc: string
  goldTypeCode: string
  scrapDetail: string | null
  qty: number | null
  goldPct: number | null
  finePrice: number | null
  unitPrice: number | null
  total: number | null
}

export type Figures = Pick<LineField, 'qty' | 'goldPct' | 'finePrice' | 'unitPrice' | 'total'>
export type Typed = keyof Figures

const given = (n: number | null | undefined): n is number =>
  n !== null && n !== undefined && !Number.isNaN(n)
const cents = (n: number) => Math.round(n * 100) / 100
/**
 * Eight places, as the form has always kept a price: the database recomputes
 * the amount from quantity and price and refuses half a cent's difference
 * (0054), and 3200 over 34.98 g rounded to cents comes back as 3199.99.
 */
const eightPlaces = (n: number) => Math.round(n * 1e8) / 1e8

/**
 * Grams of fine gold in an item: its weight times its purity.
 *
 * Only for gold weighed in grams, and only when the purity is known. An item
 * with no purity is priced by its weight, as every item was before.
 */
export function fineGrams(
  uom: Uom | '', qty: number | null | undefined, goldPct: number | null | undefined,
): number | null {
  if (uom !== 'GRAM' || !given(qty) || qty === 0 || !given(goldPct) || goldPct <= 0) return null
  return Math.abs(qty) * goldPct
}

/** Whether the item is priced per fine gram, as the paper receipt prices it, or per unit. */
export function pricedByFine(uom: Uom | '', goldPct: number | null | undefined): boolean {
  return uom === 'GRAM' && given(goldPct) && goldPct > 0
}

/**
 * One figure of an item typed; the others follow.
 *
 * The receipt's own amount is the one to trust: 950 over 9.2778 fine grams is
 * 102.3949…, and that price rounded to cents comes back as 949.95. So an amount,
 * once typed, stays, and the prices are worked out from it. A weight or a
 * purity typed afterwards keeps the amount too.
 */
export function relate(uom: Uom | '', line: Figures, typed: Typed): Figures {
  const q = given(line.qty) ? Math.abs(line.qty) : 0
  const fine = fineGrams(uom, line.qty, line.goldPct)

  const fromTotal = (total: number | null): Figures => (given(total) && q
    ? { ...line, total, unitPrice: eightPlaces(total / q), finePrice: fine ? cents(total / fine) : null }
    : { ...line, total: given(total) ? total : null, unitPrice: null, finePrice: null })

  if (typed === 'total') return fromTotal(line.total)
  if (typed === 'finePrice') {
    return given(line.finePrice) && fine
      ? { ...fromTotal(cents(line.finePrice * fine)), finePrice: line.finePrice }
      : { ...line, total: null, unitPrice: null }
  }
  if (typed === 'unitPrice') {
    if (!given(line.unitPrice) || !q) return { ...line, total: null, finePrice: null }
    const total = cents(q * line.unitPrice)
    return { ...line, total, finePrice: fine ? cents(total / fine) : null }
  }
  // A weight or a purity: the money already there stays, and the prices follow.
  if (given(line.total)) return fromTotal(line.total)
  if (given(line.finePrice) && fine) return relate(uom, line, 'finePrice')
  if (given(line.unitPrice)) return relate(uom, line, 'unitPrice')
  return line
}

/** What the items come to, as at the foot of the paper receipt. */
export function receiptTotal(lines: ({ total: number | null } | undefined)[]): number {
  return cents(lines.reduce((sum, l) => sum + (given(l?.total) ? Number(l.total) : 0), 0))
}

/** Paid minus owed: above zero when more was paid than the receipt, below when less. */
export function paymentGap(total: number, payments: ({ amount: number | null } | undefined)[]): number {
  const paid = payments.reduce((sum, p) => sum + (given(p?.amount) ? Number(p.amount) : 0), 0)
  return cents(paid - total)
}

/** An item as save_gold_receipt takes it (0074). */
export type LinePayload = {
  itemDesc: string | null
  goldTypeCode: string
  uom: Uom
  qty: number
  unitPrice: number | null
  amount: number
  scrapDetail: string | null
  goldPct: number | null
}

export function linePayload(txnType: string, uom: Uom, line: LineField): LinePayload {
  const qty = signedQty(txnType, Number(line.qty))
  const unitPrice = given(line.unitPrice) ? line.unitPrice : null
  return {
    itemDesc: line.itemDesc?.trim() || null,
    goldTypeCode: line.goldTypeCode,
    uom,
    qty,
    unitPrice,
    amount: amountOf(qty, unitPrice),
    scrapDetail: SCRAP_TYPES.has(line.goldTypeCode) ? (line.scrapDetail ?? null) : null,
    goldPct: given(line.goldPct) ? line.goldPct : null,
  }
}

/** A saved item, back on the form to be corrected. */
export function lineFromSaved(txnType: string, line: ReceiptLine): LineField {
  const total = Math.abs(line.amount)
  const fine = fineGrams(line.uom, line.qty, line.gold_pct)
  return {
    itemDesc: line.itemDesc ?? '',
    goldTypeCode: line.gold_type_code,
    scrapDetail: line.scrap_detail,
    qty: signFollowsType(txnType) ? Math.abs(line.qty) : line.qty,
    goldPct: line.gold_pct,
    unitPrice: line.unit_price,
    total: line.unit_price === null && total === 0 ? null : total,
    finePrice: fine && total ? cents(total / fine) : null,
  }
}
