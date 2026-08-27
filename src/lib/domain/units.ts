/**
 * Weight and price conversions.
 *
 * The two divisors used here are deliberately different and must stay that way:
 * weight conversion treats an ounce as 31.105 grams, while value conversion
 * divides by 31.1. The client's workbooks use both numbers, each for its own
 * purpose. Every divisor is passed in from `system_param` rather than written
 * as a literal, so the application can never drift from the database.
 */
export type Uom = 'GRAM' | 'OZ' | 'LUONG'

/** Mirrors pc49.uom_factor. Weight only — never use these to convert a price. */
export const GRAM_PER_UNIT: Record<Uom, number> = {
  GRAM: 1,
  OZ: 31.105,
  LUONG: 37.5,
}

/** Converts a quantity to grams, preserving sign: purchases are positive, sales negative. */
export function toGrams(qty: number, uom: Uom): number {
  return qty * GRAM_PER_UNIT[uom]
}

export function fromGrams(grams: number, uom: Uom): number {
  return grams / GRAM_PER_UNIT[uom]
}

function requirePositive(divisor: number): void {
  if (!(divisor > 0)) throw new Error('divisor must be greater than zero')
}

/**
 * Converts a unit price quoted per ounce into a price per luong.
 * `divisor` comes from system_param.OZ_TO_LUONG_PRICE_DIVISOR (0.83).
 */
export function ozPriceToLuong(pricePerOz: number, divisor: number): number {
  requirePositive(divisor)
  return pricePerOz / divisor
}

/**
 * Value of a quantity of gold held, in USD.
 * `gramPerOz` comes from system_param.VALUATION_GRAM_PER_OZ (31.1), which is
 * NOT the same as GRAM_PER_UNIT.OZ (31.105).
 */
export function inventoryValue(grams: number, spotPerOz: number, gramPerOz: number): number {
  requirePositive(gramPerOz)
  return (grams * spotPerOz) / gramPerOz
}
