import { fromGrams, type Uom } from '@/lib/domain/units'

/**
 * A weight in the unit its gold is counted in, with the grams beside it
 * (18-09-2026: "đang tính chung là gr, cần có thêm đvt gốc ...L/...gr").
 *
 * Every gold type has one unit (0038), so grams go back into it exactly: a
 * luong is 37.5 g and an ounce 31.105 g by weight.
 */
export const UOM_SHORT: Record<Uom, string> = { GRAM: 'g', OZ: 'Oz', LUONG: 'L' }

const two = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "2.00 L (75.00 g)", or "16.90 g" for gold counted in grams. */
export function weightText(grams: number, uom: Uom, native = fromGrams(grams, uom)): string {
  const g = `${two.format(grams)} g`
  return uom === 'GRAM' ? g : `${two.format(native)} ${UOM_SHORT[uom]} (${g})`
}

/** The count in its own unit alone: "2.00 L", "16.90 g". */
export function nativeText(grams: number, uom: Uom): string {
  return `${two.format(fromGrams(grams, uom))} ${UOM_SHORT[uom]}`
}
