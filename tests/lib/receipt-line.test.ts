import { describe, it, expect } from 'vitest'
import {
  fineGrams, lineFromSaved, linePayload, paymentGap, pricedByFine, receiptTotal, relate,
  signFollowsType, signedQty, type Figures,
} from '@/components/gold/receiptLine'
import { amountOf, type ReceiptLine } from '@/components/gold/types'
import { SIX_ITEMS } from '../support/receipt'

const figures = (over: Partial<Figures>): Figures => ({
  qty: null, goldPct: null, finePrice: null, unitPrice: null, total: null, ...over,
})

describe('the sign of a quantity', () => {
  it('signs a deposit the way it signs a sale', () => {
    expect(signedQty('DEPOSIT', 1)).toBe(-1)
    expect(signFollowsType('DEPOSIT')).toBe(true)
  })

  it('comes from the type where the table already fixes it', () => {
    expect(signedQty('PO', 5)).toBe(5)
    expect(signedQty('PO_VENDOR', -5)).toBe(5)
    expect(signedQty('SALE', 5)).toBe(-5)
    expect(signedQty('PICKUP', -5)).toBe(-5)
  })

  it('is kept as typed where it carries meaning', () => {
    expect(signedQty('ON_THE_WAY', -5)).toBe(-5)
    expect(signedQty('MEMO', 5)).toBe(5)
  })
})

describe('fine grams', () => {
  it('are the weight times the purity, for gold weighed in grams', () => {
    expect(fineGrams('GRAM', 9.4, 0.987)).toBeCloseTo(9.2778, 10)
    expect(fineGrams('GRAM', -9.4, 0.987)).toBeCloseTo(9.2778, 10)
    expect(pricedByFine('GRAM', 0.987)).toBe(true)
  })

  it('are not there for gold counted in units, or with no purity', () => {
    expect(fineGrams('OZ', 1, 0.9999)).toBeNull()
    expect(fineGrams('GRAM', 4.5, null)).toBeNull()
    expect(pricedByFine('GRAM', null)).toBe(false)
    expect(pricedByFine('LUONG', 0.9999)).toBe(false)
  })
})

describe('one figure typed, the others following', () => {
  it('works both prices out from the amount on the paper', () => {
    const r = relate('GRAM', figures({ qty: 9.4, goldPct: 0.987, total: 950 }), 'total')
    expect(r.unitPrice).toBe(101.06382979)
    expect(r.finePrice).toBe(102.39)
    expect(r.total).toBe(950)
  })

  it('works the amount out from a price per fine gram, and keeps the price typed', () => {
    const r = relate('GRAM', figures({ qty: 0.6, goldPct: 0.597, finePrice: 100.5 }), 'finePrice')
    expect(r.total).toBe(36)
    expect(r.unitPrice).toBe(60)
    expect(r.finePrice).toBe(100.5)
  })

  it('prices gold counted in units by the unit', () => {
    const r = relate('OZ', figures({ qty: 2, unitPrice: 3970 }), 'unitPrice')
    expect(r.total).toBe(7940)
    expect(r.finePrice).toBeNull()
  })

  it('prices scrap with no purity by the gram, as before', () => {
    const r = relate('GRAM', figures({ qty: 4.5, total: 250 }), 'total')
    expect(r.unitPrice).toBe(55.55555556)
    expect(r.finePrice).toBeNull()
  })

  it('keeps the amount when the weight or the purity changes after it', () => {
    const weighed = relate('GRAM', figures({ qty: 12.5, unitPrice: 25, total: 250 }), 'qty')
    expect(weighed).toMatchObject({ total: 250, unitPrice: 20 })
    const assayed = relate('GRAM',
      figures({ qty: 9.4, goldPct: 0.987, unitPrice: 101.06382979, total: 950 }), 'goldPct')
    expect(assayed).toMatchObject({ total: 950, finePrice: 102.39 })
  })

  it('clears the prices when the amount is cleared', () => {
    const r = relate('GRAM',
      figures({ qty: 9.4, goldPct: 0.987, finePrice: 102.39, unitPrice: 101, total: null }), 'total')
    expect(r).toMatchObject({ total: null, unitPrice: null, finePrice: null })
  })

  it('gives every item on the paper a price the database will agree with to the cent', () => {
    // write_gold_transaction recomputes the amount from quantity and price and
    // refuses a difference over half a cent (0054).
    for (const item of SIX_ITEMS) {
      const r = relate('GRAM', figures({ qty: item.qty, goldPct: item.goldPct, total: item.total }), 'total')
      expect(amountOf(signedQty('PO', item.qty), r.unitPrice)).toBe(-item.total)
    }
  })
})

describe('the foot of the receipt', () => {
  it('adds the items up to the paper total', () => {
    expect(receiptTotal(SIX_ITEMS.map((i) => ({ total: i.total })))).toBe(8361)
    expect(receiptTotal([{ total: 10 }, undefined, { total: null }])).toBe(10)
  })

  it('says how far the payments are from it, either way', () => {
    expect(paymentGap(8361, [{ amount: 5000 }, { amount: 3361 }])).toBe(0)
    expect(paymentGap(8361, [{ amount: 8000 }, { amount: null }, undefined])).toBe(-361)
    expect(paymentGap(8361, [{ amount: 9000 }])).toBe(639)
  })
})

describe('an item on its way to the database, and back', () => {
  it('carries the sign of the receipt and drops what does not apply', () => {
    expect(linePayload('SALE', 'LUONG', {
      itemDesc: '  ', goldTypeCode: 'RP', scrapDetail: '19-24k/grs', qty: 1, goldPct: null,
      finePrice: null, unitPrice: 5000, total: 5000,
    })).toEqual({
      itemDesc: null, goldTypeCode: 'RP', uom: 'LUONG', qty: -1, unitPrice: 5000,
      amount: 5000, scrapDetail: null, goldPct: null,
    })
    expect(linePayload('PO', 'GRAM', {
      itemDesc: ' Thỏi RCM ', goldTypeCode: 'GRAIN', scrapDetail: null, qty: 15.6, goldPct: 0.998,
      finePrice: 122.04, unitPrice: 121.79487179, total: 1900,
    })).toMatchObject({ itemDesc: 'Thỏi RCM', qty: 15.6, amount: -1900, goldPct: 0.998 })
  })

  it('comes back to the form unsigned, with its price per fine gram', () => {
    const saved: ReceiptLine = {
      id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG', scrap_detail: '19-24k/grs',
      gold_pct: 0.987, uom: 'GRAM', qty: 9.4, unit_price: 101.06382979, amount: -950, blockedCode: null,
    }
    expect(lineFromSaved('PO', saved)).toEqual({
      itemDesc: 'Nhẫn 24K (vụn)', goldTypeCode: 'SG', scrapDetail: '19-24k/grs', qty: 9.4,
      goldPct: 0.987, unitPrice: 101.06382979, total: 950, finePrice: 102.39,
    })
    expect(lineFromSaved('SALE', {
      ...saved, gold_type_code: 'RP', uom: 'LUONG', qty: -1, gold_pct: null, amount: 5000, unit_price: 5000,
    })).toMatchObject({ qty: 1, total: 5000, finePrice: null })
    expect(lineFromSaved('ON_THE_WAY', { ...saved, qty: -3, gold_pct: null, amount: 0, unit_price: null }))
      .toMatchObject({ qty: -3, total: null })
  })
})
