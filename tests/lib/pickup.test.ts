import { describe, it, expect } from 'vitest'
import { canPickUp, leftToPay } from '@/components/gold/pickup'
import type { DepositInfo } from '@/components/gold/types'

const info = (over: Partial<DepositInfo> = {}): DepositInfo => ({
  role: 'deposit', orderValue: 5300, paid: 1000, settledBy: null, pickupDate: null,
  pickupDoc: null, depositDate: null, depositDoc: null, ...over,
})

describe('picking up a deposit', () => {
  it('is offered on a deposit nobody has collected or cancelled', () => {
    expect(canPickUp({ deposit: info(), conversion: null })).toBe(true)
  })

  it('is not offered once settled, on a pickup, or on anything else', () => {
    expect(canPickUp({ deposit: info({ settledBy: 'PICKUP' }), conversion: null })).toBe(false)
    expect(canPickUp({ deposit: info({ settledBy: 'CANCEL' }), conversion: null })).toBe(false)
    expect(canPickUp({ deposit: info({ role: 'pickup' }), conversion: null })).toBe(false)
    expect(canPickUp({ deposit: null, conversion: null })).toBe(false)
  })

  it('leaves the order less what was put down to pay, never below nothing', () => {
    expect(leftToPay(info())).toBe(4300)
    expect(leftToPay(info({ paid: 6000 }))).toBe(0)
    expect(leftToPay(info({ orderValue: 0.3, paid: 0.1 }))).toBe(0.2)
  })

  it('cannot say what is left when nobody recorded the order’s value', () => {
    expect(leftToPay(info({ orderValue: null }))).toBeNull()
  })
})
