import { describe, it, expect } from 'vitest'
import { UOM_SHORT, weightText } from '@/components/gold/weightText'

describe('a weight in its own unit, with grams beside it', () => {
  it('writes luong and ounces with the grams they come to', () => {
    expect(weightText(75, 'LUONG')).toBe('2.00 L (75.00 g)')
    expect(weightText(62.21, 'OZ')).toBe('2.00 Oz (62.21 g)')
  })

  it('takes the count in its unit when it is known, rather than working it back', () => {
    expect(weightText(37.5, 'LUONG', 1)).toBe('1.00 L (37.50 g)')
  })

  it('writes gold counted in grams once', () => {
    expect(weightText(16.9, 'GRAM')).toBe('16.90 g')
  })

  it('names the units as the shop writes them', () => {
    expect(UOM_SHORT).toEqual({ GRAM: 'g', OZ: 'Oz', LUONG: 'L' })
  })
})
