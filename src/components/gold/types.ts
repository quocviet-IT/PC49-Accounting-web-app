import type { Uom } from '@/lib/domain/units'

export type GoldTypeOption = {
  code: string
  name_vi: string
  name_en: string
  native_uom: Uom
}

export type SavedRow = {
  id: string
  doc_no: string | null
  txn_type: string
  partner_code: string | null
  sales_person_code: string | null
  gold_type_code: string
  scrap_detail: string | null
  gold_pct: number | null
  uom: Uom
  qty: number
  unit_price: number | null
  amount: number
  remarks: string | null
  /** How it was settled, in the order it was entered. */
  payments: { seq: number; amount: number; method: string }[]
  /** Who is credited with it, largest share first. */
  soldBy: { code: string; sharePct: number }[]
  /** What the screen was showing, so a correction can tell if it has moved. */
  revision: number
  /** Why this row cannot be corrected here, or null if it can. */
  blockedReason: string | null
}

/**
 * The kinds of movement this screen writes.
 *
 * Transfers and conversions are not here on purpose: a TRANSFER_IN or
 * TRANSFER_OUT has to belong to a conversion or a refining lot (0056), so it
 * is written by the screen that owns that lot, not typed loose here.
 */
export const TXN_TYPES = [
  'PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'PICKUP', 'MEMO', 'ON_THE_WAY',
] as const

export const PAYMENT_METHODS = ['CASH', 'BANKWIRE', 'ZELLE', 'CHECK'] as const

/**
 * The two bags scrap is sent to the refinery in (B5: from June 2026, only
 * these two). Offered as a choice, never typed: the source accumulated six
 * spellings for what were two bags.
 */
export const SCRAP_BANDS = ['10-18k/grs', '19-24k/grs'] as const

/** Gold types that carry a scrap grade at all. */
export const SCRAP_TYPES = new Set(['SG', 'PT'])

/**
 * How an order divides between the people on it (B6). Fixed by count and
 * by position — the first name is the lead — so nobody types a percent and
 * nobody can type one that does not add up.
 */
export const SALES_SPLIT: Record<number, number[]> = { 1: [100], 2: [80, 20], 3: [60, 20, 20] }
export const MAX_SALES_ON_ORDER = 3

/** A ceiling on what one request may insert, not a rule about the counter. */
export const MAX_PAYMENTS = 20


/**
 * Amount follows the sign convention the whole system rests on: a purchase is
 * a positive quantity and a negative amount, a sale the other way round. The
 * accountant types the quantity with its sign, exactly as in the spreadsheet,
 * and never types the amount at all.
 *
 * A movement with no price — a memo, gold on its way from a vendor — has no
 * amount to derive, and says so with a zero rather than refusing to be saved.
 * The old grid required a price before it would commit anything, which meant a
 * memo could not be recorded on this screen at all.
 */
export function amountOf(qty: number, price: number | null): number {
  if (price === null) return 0
  return Math.round(-qty * price * 100) / 100
}
