/*
 * Who is still owed on a refining lot, and when it may be closed.
 *
 * The bug this exists for: an owner who took the money still read as owed
 * their whole bag, because the screen counted grams and a cash settlement
 * carries none. "Đóng lô" was then greyed out for good, on a lot the database
 * would have closed.
 */
import { describe, it, expect } from 'vitest'
import { everybodySettled, owedGram } from '@/components/refining/settled'
import type { OwnerShare, Receipt } from '@/components/refining/types'

const house: OwnerShare = { ownerCode: 'PC49', assayWeightGram: 30, sharePct: 42.9, receivedGram: 30 }
const partner: OwnerShare = { ownerCode: 'MH', assayWeightGram: 40, sharePct: 57.1, receivedGram: 0 }

const receipt = (over: Partial<Receipt>): Receipt => ({
  id: 'r1', ownerCode: 'PC49', receiveDate: '2026-01-30', settleKind: 'METAL',
  goldTypeCode: 'GRAIN', qtyGram: 30, amountUsd: null, ...over,
})

const metalToHouse = receipt({})
const cashToPartner = receipt({
  id: 'r2', ownerCode: 'MH', settleKind: 'CASH', qtyGram: null, amountUsd: 6400,
})

describe('what an owner is still owed', () => {
  it('is nothing once they have taken the money', () => {
    expect(owedGram(partner, [cashToPartner])).toBe(0)
  })

  it('is the rest of the metal while they are waiting for it', () => {
    expect(owedGram(partner, [])).toBe(40)
    expect(owedGram({ ...partner, receivedGram: 25 }, [])).toBe(15)
  })

  it('is nothing once the metal is back', () => {
    expect(owedGram(house, [metalToHouse])).toBe(0)
  })

  it('does not go negative when more came back than went', () => {
    expect(owedGram({ ...house, receivedGram: 31 }, [])).toBe(0)
  })
})

describe('whether the lot may be closed', () => {
  it('waits for the partner who has taken neither metal nor money', () => {
    expect(everybodySettled([house, partner], [metalToHouse])).toBe(false)
  })

  it('closes once one took the gold and the other took the cash', () => {
    expect(everybodySettled([house, partner], [metalToHouse, cashToPartner])).toBe(true)
  })

  it('does not call a lot with no bags finished', () => {
    expect(everybodySettled([], [])).toBe(false)
  })
})
