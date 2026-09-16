import type { Bag } from './types'

export type AssayEntry = { lineId: string; assayWeightGram: number; assayPct: number }

/** The bag fields this needs: which bag it is, and what was sent or already known. */
export type AssayBag = Pick<Bag,
  'id' | 'grossWeightGram' | 'goldPct' | 'assayWeightGram' | 'assayPct'>

/** What was typed into one row of the assay table, if anything was. */
export type TypedAssay = {
  assayWeightGram?: number | string | null
  assayPct?: number | string | null
}

/**
 * What the refinery reported, one entry per bag, as record_assay wants it.
 *
 * Which bag a row is comes from the bags, not from the form. The assay table
 * renders an input for the weight and one for the purity and nothing else, and
 * a form keeps only the fields it renders — so the line id left the browser as
 * `undefined`, the save was refused with "expected string, received undefined",
 * and the reason was written into an alert behind the open dialog where nobody
 * could read it. Every assay since the lot page was rebuilt (10-09) failed that
 * way.
 *
 * A row nobody touched settles at what was sent, which is what the dialog
 * offers on screen.
 */
export function assayLines(bags: AssayBag[], typed: TypedAssay[] = []): AssayEntry[] {
  return bags.map((bag, i) => {
    const row = typed[i] ?? {}
    const weight = row.assayWeightGram ?? bag.assayWeightGram ?? bag.grossWeightGram
    const pct = row.assayPct ?? bag.assayPct ?? bag.goldPct
    return { lineId: bag.id, assayWeightGram: Number(weight), assayPct: Number(pct) }
  })
}
