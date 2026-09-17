import { describe, it, expect } from 'vitest'
import { t, type MessageKey } from '@/lib/i18n'
import {
  balanceOf, conversionLinePayload, lineGrams, sideGoldTypes, sidesFromSaved,
} from '@/components/gold/conversionLine'
import { describeRefusal } from '@/components/gold/receiptErrors'
import type { ReceiptLine } from '@/components/gold/types'

const say = (key: MessageKey) => t('vi', key)

const leg = (over: Partial<ReceiptLine>): ReceiptLine => ({
  id: 'a', lineNo: 1, itemDesc: null, gold_type_code: 'GRAIN', scrap_detail: null, gold_pct: null,
  uom: 'GRAM', qty: -1, unit_price: null, amount: 0, blockedCode: 'CONVERSION_LEG', side: 'out', ...over,
})

describe('the weight of a line', () => {
  it('is its quantity in grams, whatever it is counted in', () => {
    expect(lineGrams('LUONG', 17)).toBe(637.5)
    expect(lineGrams('OZ', 2)).toBeCloseTo(62.21, 10)
    expect(lineGrams('GRAM', -56.7)).toBe(56.7)
  })

  it('is nothing until the gold type and quantity are there', () => {
    expect(lineGrams('', 5)).toBe(0)
    expect(lineGrams('GRAM', null)).toBe(0)
  })
})

describe('whether the two sides meet', () => {
  it('finds Grain into Rong Phung exact', () => {
    expect(balanceOf([637.5], [637.5], 0.5)).toEqual({ out: 637.5, in: 637.5, diff: 0, pct: 0, within: true })
  })

  it('finds the Nini exchange a hundredth of a percent apart, inside the tolerance', () => {
    const b = balanceOf([150], [lineGrams('OZ', 2), lineGrams('OZ', 1), 56.7], 0.5)
    expect(b.in).toBeCloseTo(150.015, 10)
    expect(b.pct).toBeCloseTo(0.01, 10)
    expect(b.within).toBe(true)
  })

  it('finds a short melt outside it', () => {
    const b = balanceOf([150], [143.315], 0.5)
    expect(b.pct).toBeCloseTo(4.4567, 3)
    expect(b.within).toBe(false)
  })

  it('cannot weigh anything with nothing out', () => {
    expect(balanceOf([], [10], 0.5)).toMatchObject({ pct: null, within: false })
  })
})

describe('which gold each side may use', () => {
  const rules = [
    { gold_type_code: 'GRAIN', txn_type: 'TRANSFER_OUT' },
    { gold_type_code: 'RP', txn_type: 'TRANSFER_OUT' },
    { gold_type_code: 'RP', txn_type: 'TRANSFER_IN' },
    { gold_type_code: 'CS', txn_type: 'TRANSFER_IN' },
    { gold_type_code: 'RP', txn_type: 'TRANSFER_IN' },
  ]

  it('follows the flow rules for a transfer', () => {
    expect(sideGoldTypes(rules, 'TRANSFER', 'out')).toEqual(['GRAIN', 'RP'])
    expect(sideGoldTypes(rules, 'TRANSFER', 'in')).toEqual(['RP', 'CS'])
  })

  it('is Grain out and Rong Phung in for Ra RP', () => {
    expect(sideGoldTypes(rules, 'RA_RP', 'out')).toEqual(['GRAIN'])
    expect(sideGoldTypes(rules, 'RA_RP', 'in')).toEqual(['RP'])
  })
})

describe('a conversion on its way to the database, and back', () => {
  it('sends quantities without a sign', () => {
    expect(conversionLinePayload('LUONG', { goldTypeCode: 'RP', qty: -4 }))
      .toEqual({ goldTypeCode: 'RP', uom: 'LUONG', qty: 4 })
  })

  it('puts saved legs back on their sides, unsigned', () => {
    expect(sidesFromSaved({ lines: [
      leg({ gold_type_code: 'RP', uom: 'LUONG', qty: -4, side: 'out' }),
      leg({ id: 'b', gold_type_code: 'CS', uom: 'OZ', qty: 2, side: 'in' }),
      leg({ id: 'c', gold_type_code: 'GRAIN', qty: 56.7, side: 'in', lineNo: 2 }),
    ] })).toEqual({
      out: [{ goldTypeCode: 'RP', qty: 4 }],
      in: [{ goldTypeCode: 'CS', qty: 2 }, { goldTypeCode: 'GRAIN', qty: 56.7 }],
    })
  })
})

describe('a conversion refused, in the reader’s language', () => {
  it('says how far apart the weights are and what to do', () => {
    expect(describeRefusal('CONVERSION_UNBALANCED: out 150.0000 in 143.3000 pct 4.4667 tolerance 0.500000', say))
      .toBe('RA 150.00 g, VÀO 143.30 g: lệch 4.47%, vượt mức cho phép 0.5%. Ghi lý do lệch để lưu.')
  })

  it('names the line', () => {
    expect(describeRefusal('CONVERSION_QTY: in 3 has no quantity', say)).toBe('Dòng Vào 3 chưa có số lượng.')
    expect(describeRefusal('LINE_BLOCKED: out 2 CASH_LINK cannot be changed here', say))
      .toBe('Dòng Ra 2: Dòng này gắn với một khoản thu chi tiền')
  })

  it('translates the rest', () => {
    expect(describeRefusal('CONVERSION_SIDES: each side holds …', say)).toBe(say('conversion.err.sides'))
    expect(describeRefusal('CONVERSION_RA_RP: Ra RP turns …', say)).toBe(say('conversion.err.raRp'))
    expect(describeRefusal('CONVERSION_REFINING: this conversion …', say)).toBe(say('txn.blocked.REFINING_LEG'))
    expect(describeRefusal('CONVERSION_VOIDED: this conversion …', say)).toBe(say('txn.blocked.VOIDED'))
  })
})
