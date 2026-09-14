import { describe, it, expect } from 'vitest'
import {
  GOLD_TYPE, UOM, TXN_TYPE, METHOD, GRAM_PER,
  excelDate, money, salesNames, paymentSpec, isNoteNotCustomer,
} from '../../scripts/lib/sheet-map.mjs'

describe('the workbooks, read the way the system names things', () => {
  it('names the nine gold types the way the system does', () => {
    expect(GOLD_TYPE['Rong Phung']).toBe('RP')
    expect(GOLD_TYPE['Scrap gold']).toBe('SG')
    expect(GOLD_TYPE['Credit Suisse']).toBe('CS')
    expect(GOLD_TYPE['Maple Leaf']).toBe('ML')
    expect(GOLD_TYPE['American Eagle']).toBe('AE')
    expect(GOLD_TYPE['Other']).toBe('OTH')
    expect(Object.keys(GOLD_TYPE)).toHaveLength(9)
  })

  it('reads a unit and a transaction type', () => {
    expect(UOM['Lượng']).toBe('LUONG')
    expect(UOM['Oz']).toBe('OZ')
    expect(UOM['Gram']).toBe('GRAM')
    expect(TXN_TYPE['PO(Vendor)']).toBe('PO_VENDOR')
    expect(TXN_TYPE['Sale']).toBe('SALE')
    expect(TXN_TYPE['Ra RP']).toBe('RA_RP')
    expect(METHOD['Bank wire']).toBe('BANKWIRE')
  })

  it('weighs an ounce the way the system stores it, not the way it values it', () => {
    // uom_factor and src/lib/domain/units.ts both hold 31.105 g to the ounce;
    // 31.1 is the valuation divisor. Weighing a conversion day with the
    // valuation figure is out by 0.005 g for every ounce in it.
    expect(GRAM_PER.OZ).toBe(31.105)
    expect(GRAM_PER.LUONG).toBe(37.5)
    expect(GRAM_PER.GRAM).toBe(1)
  })

  it('turns a spreadsheet day number into a date', () => {
    // The workbooks hold dates as day numbers. 46020 is the day the first row
    // of January 2026 is dated - 29 December 2025, a purchase carried in.
    expect(excelDate(46020)).toBe('2025-12-29')
    expect(excelDate(46023)).toBe('2026-01-01')
    expect(excelDate('')).toBe(null)
    expect(excelDate('Begin')).toBe(null)
  })

  it('reads money whether the cell holds a number or the text of one', () => {
    expect(money(-140000)).toBe(-140000)
    expect(money('-$864,640')).toBe(-864640)
    expect(money('($55,357.18)')).toBe(-55357.18)
    expect(money('')).toBe(null)
    expect(money('-')).toBe(null)
    expect(money('#REF!')).toBe(null)
  })

  it('splits the sales cell into the names written in it', () => {
    expect(salesNames('L.Thanh')).toEqual(['L.Thanh'])
    expect(salesNames('N.Ý/T.Quỳnh')).toEqual(['N.Ý', 'T.Quỳnh'])
    expect(salesNames(' B.Khanh / T.Quỳnh ')).toEqual(['B.Khanh', 'T.Quỳnh'])
    expect(salesNames('')).toEqual([])
  })

  it('writes a payment spec the loader reads back', () => {
    expect(paymentSpec([
      { direction: 'AP', method: 'Cash', amount: -100000 },
      { direction: 'AP', method: 'Check', amount: -40000 },
      { direction: 'AP', method: 'Cash', amount: 0 },
      { direction: 'AP', method: '', amount: 500 },
    ])).toBe('AP:CASH:100000|AP:CHECK:40000')
    expect(paymentSpec([])).toBe('')
  })

  it('knows a customer cell that is really a note', () => {
    // Six hundred and fifty-six names sit in that column, and some are not
    // customers at all - they are what the accountant wrote about a transfer.
    expect(isNoteNotCustomer('Send to assay')).toBe(true)
    expect(isNoteNotCustomer('Gởi Shawn bán')).toBe(true)
    expect(isNoteNotCustomer('Transfer 1L vàng 9999 ra 37.5gr vàng Grain')).toBe(true)
    expect(isNoteNotCustomer('Kelvin Tran')).toBe(false)
    expect(isNoteNotCustomer('Chị Thủy Cù')).toBe(false)
  })
})
