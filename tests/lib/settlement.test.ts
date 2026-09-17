import { describe, it, expect } from 'vitest'
import { canSettle, owes, paidSoFar } from '@/components/gold/settlement'
import type { ReceiptRow } from '@/components/gold/types'

type Settleable = Pick<ReceiptRow, 'txn_type' | 'conversion' | 'owed' | 'settlements'>
const row = (over: Partial<Settleable> = {}): Settleable =>
  ({ txn_type: 'PO', conversion: null, owed: 0, settlements: [], ...over })
const later = { id: 's', payDate: '2026-09-20', amount: 5, method: 'CASH', note: null }

describe('paying the rest of a receipt later', () => {
  it('is offered on a purchase or a sale that still owes', () => {
    expect(canSettle(row({ owed: 10 }))).toBe(true)
    expect(canSettle(row({ txn_type: 'SALE', owed: 0.01 }))).toBe(true)
  })

  it('stays offered once paid up, so a later payment can still be cancelled', () => {
    expect(canSettle(row({ settlements: [later] }))).toBe(true)
  })

  it('is not offered where nothing is owed or can be', () => {
    expect(canSettle(row())).toBe(false)
    expect(canSettle(row({ txn_type: 'DEPOSIT', owed: 10 }))).toBe(false)
    expect(canSettle(row({
      owed: 10, conversion: { id: 'c', kind: 'TRANSFER', varianceNote: null, varianceReason: null },
    }))).toBe(false)
  })

  it('counts less than half a cent as paid', () => {
    expect(owes({ owed: 0.004 })).toBe(false)
    expect(owes({})).toBe(false)
  })

  it('adds up what was paid at the counter and since, to the cent', () => {
    expect(paidSoFar({
      payments: [{ seq: 1, amount: 0.1, method: 'CASH' }, { seq: 2, amount: 0.2, method: 'ZELLE' }],
      settlements: [{ ...later, amount: 1000.05 }],
    })).toBe(1000.35)
  })
})
