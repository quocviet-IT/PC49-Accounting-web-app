import { GRAM_PER_UNIT, type Uom } from '@/lib/domain/units'
import type { ReceiptRow } from './types'

/** More than this on one side is refused by the database too (0078). */
export const MAX_CONVERSION_LINES = 30

export type ConversionKind = 'TRANSFER' | 'RA_RP'
export type Side = 'out' | 'in'

/** Ra RP is Grain melted into Rong Phung, and nothing else (0004's flow rules). */
export const RA_RP_GOLD: Record<Side, string> = { out: 'GRAIN', in: 'RP' }

/** One line of a side as the form holds it. The quantity is unsigned; the side signs it. */
export type ConversionLineField = { goldTypeCode: string; qty: number | null }

/** A line's weight in grams: 37.5 to the luong, 31.105 to the ounce (uom_factor). */
export function lineGrams(uom: Uom | '', qty: number | null | undefined): number {
  if (!uom || qty === null || qty === undefined || Number.isNaN(Number(qty))) return 0
  return Math.abs(Number(qty)) * GRAM_PER_UNIT[uom]
}

export type Balance = {
  out: number
  in: number
  diff: number
  /** The difference as a percent of the grams out, or null with nothing out. */
  pct: number | null
  within: boolean
}

/**
 * Whether the two sides meet: 0014's rule, the difference over the grams out
 * as a percent, against CONVERSION_WEIGHT_TOLERANCE_PCT.
 */
export function balanceOf(outGrams: number[], inGrams: number[], tolerancePct: number): Balance {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
  const out = sum(outGrams)
  const into = sum(inGrams)
  const diff = Math.abs(into - out)
  const pct = out > 0 ? (diff / out) * 100 : null
  // A hair of slack: 150.015 - 150 is not exactly 0.015 in floating point.
  return { out, in: into, diff, pct, within: pct !== null && pct <= tolerancePct + 1e-9 }
}

/**
 * The gold a side may use: the flow rules for that direction on a transfer,
 * Ra RP's fixed pair otherwise. The database checks every leg anyway (0012);
 * this keeps the choice from offering what it would refuse.
 */
export function sideGoldTypes(
  rules: { gold_type_code: string; txn_type: string }[], kind: ConversionKind, side: Side,
): string[] {
  if (kind === 'RA_RP') return [RA_RP_GOLD[side]]
  const type = side === 'out' ? 'TRANSFER_OUT' : 'TRANSFER_IN'
  return [...new Set(rules.filter((r) => r.txn_type === type).map((r) => r.gold_type_code))]
}

/** A line as save_gold_conversion takes it (0078). */
export type ConversionLinePayload = { goldTypeCode: string; uom: Uom; qty: number }

export function conversionLinePayload(uom: Uom, line: ConversionLineField): ConversionLinePayload {
  return { goldTypeCode: line.goldTypeCode, uom, qty: Math.abs(Number(line.qty)) }
}

/** A saved conversion's legs, back on the form: unsigned, each on its side. */
export function sidesFromSaved(row: Pick<ReceiptRow, 'lines'>): Record<Side, ConversionLineField[]> {
  const pick = (side: Side) => row.lines
    .filter((l) => l.side === side)
    .map((l) => ({ goldTypeCode: l.gold_type_code, qty: Math.abs(l.qty) }))
  return { out: pick('out'), in: pick('in') }
}
