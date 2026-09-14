import { describe, expect, it } from 'vitest'
import { matchesSearch, pageSlice } from '../../src/lib/ui/list'

describe('listing controls', () => {
  it('finds Vietnamese text without accents and across independent terms', () => {
    expect(matchesSearch('chi dang 081', ['Chị Đặng', 'PC49-2601-081'])).toBe(true)
    expect(matchesSearch('chi dang 082', ['Chị Đặng', 'PC49-2601-081'])).toBe(false)
    expect(matchesSearch('   ', [null])).toBe(true)
  })
  it('clamps the page when filters shrink results, preserving complete groups', () => {
    const entries = Array.from({ length: 43 }, (_, id) => ({ id, lines: [1, 2] }))
    expect(pageSlice(entries, 3, 20).rows.map((r) => r.id)).toEqual([40, 41, 42])
    expect(pageSlice(entries.slice(0, 5), 3, 20)).toEqual({ page: 1, rows: entries.slice(0, 5) })
    expect(pageSlice([], 4, 20)).toEqual({ page: 1, rows: [] })
  })
})
