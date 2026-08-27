import { describe, it, expect } from 'vitest'
import { toGrams, fromGrams, ozPriceToLuong, inventoryValue } from '@/lib/domain/units'

describe('toGrams', () => {
  it('converts one luong to 37.5 grams', () => {
    expect(toGrams(1, 'LUONG')).toBe(37.5)
  })

  it('converts one ounce to 31.105 grams', () => {
    expect(toGrams(1, 'OZ')).toBe(31.105)
  })

  it('leaves grams alone', () => {
    expect(toGrams(706.4, 'GRAM')).toBe(706.4)
  })

  it('round-trips through fromGrams', () => {
    expect(fromGrams(toGrams(18, 'OZ'), 'OZ')).toBeCloseTo(18, 10)
  })

  it('keeps the sign, since purchases are positive and sales negative', () => {
    expect(toGrams(-1, 'LUONG')).toBe(-37.5)
  })
})

describe('ozPriceToLuong', () => {
  it('divides by the configured divisor', () => {
    expect(ozPriceToLuong(4980, 0.83)).toBeCloseTo(6000, 10)
  })

  it('refuses a divisor of zero rather than returning Infinity', () => {
    expect(() => ozPriceToLuong(4980, 0)).toThrowError('divisor must be greater than zero')
  })
})

describe('inventoryValue', () => {
  it('uses the valuation divisor, not the weight one', () => {
    // Lot S26.02 records 161.2540193 per gram at a spot of 5,015 per oz.
    expect(inventoryValue(1, 5015, 31.1)).toBeCloseTo(161.2540193, 6)
    expect(inventoryValue(1, 5015, 31.105)).not.toBeCloseTo(161.2540193, 6)
  })

  it('scales with weight', () => {
    // PC49's share of lot S26.02: 1,459.61 g at a spot of 5,015 per oz.
    expect(inventoryValue(1459.61, 5015, 31.1)).toBeCloseTo(235367.98, 2)
  })

  it('refuses a divisor of zero', () => {
    expect(() => inventoryValue(1, 5015, 0)).toThrowError('divisor must be greater than zero')
  })
})
