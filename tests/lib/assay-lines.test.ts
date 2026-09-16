/*
 * What the assay dialog sends when the refinery's answer is saved.
 *
 * The bug this exists for: the dialog sent `lineId: undefined` for every bag,
 * because a form keeps only the fields it renders and that table renders two
 * numbers per row. The database refused the lot, and the reason was shown in
 * an alert behind the open dialog.
 */
import { describe, it, expect } from 'vitest'
import { assayLines, type AssayBag } from '@/components/refining/assayLines'

const sent: AssayBag[] = [
  { id: 'bag-1', grossWeightGram: 20, goldPct: 0.583, assayWeightGram: null, assayPct: null },
  { id: 'bag-2', grossWeightGram: 40, goldPct: 0.75, assayWeightGram: null, assayPct: null },
]

describe('the assay the dialog sends', () => {
  it('says which bag each row is, whatever the form kept', () => {
    const lines = assayLines(sent, [
      { assayWeightGram: 19.4, assayPct: 0.74 },
      { assayWeightGram: 39.2, assayPct: 0.71 },
    ])
    expect(lines).toEqual([
      { lineId: 'bag-1', assayWeightGram: 19.4, assayPct: 0.74 },
      { lineId: 'bag-2', assayWeightGram: 39.2, assayPct: 0.71 },
    ])
  })

  it('settles an untouched row at what was sent, as the dialog offers it', () => {
    expect(assayLines(sent)).toEqual([
      { lineId: 'bag-1', assayWeightGram: 20, assayPct: 0.583 },
      { lineId: 'bag-2', assayWeightGram: 40, assayPct: 0.75 },
    ])
  })

  it('prefers an assay already recorded to what was sent', () => {
    const again: AssayBag[] = [
      { id: 'bag-1', grossWeightGram: 20, goldPct: 0.583, assayWeightGram: 19.4, assayPct: 0.74 },
    ]
    expect(assayLines(again)).toEqual([
      { lineId: 'bag-1', assayWeightGram: 19.4, assayPct: 0.74 },
    ])
  })

  it('takes the numbers as the browser hands them over', () => {
    // An antd number field hands back a string when somebody types into it.
    expect(assayLines(sent, [{ assayWeightGram: '19.4', assayPct: '0.74' }])[0])
      .toEqual({ lineId: 'bag-1', assayWeightGram: 19.4, assayPct: 0.74 })
  })
})
