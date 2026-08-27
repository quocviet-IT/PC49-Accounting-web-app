import { describe, it, expect } from 'vitest'
import { can } from '@/lib/auth/roles'

describe('can', () => {
  it('lets KT enter gold transactions', () => {
    expect(can('KT', 'goldTxn.write')).toBe(true)
  })

  it('does not let KT close a period', () => {
    expect(can('KT', 'period.close')).toBe(false)
  })

  it('lets GS_US approve a refining lot', () => {
    expect(can('GS_US', 'refining.approve')).toBe(true)
  })

  it('does not let GS_US enter gold transactions', () => {
    expect(can('GS_US', 'goldTxn.write')).toBe(false)
  })

  it('gives OC read access only', () => {
    expect(can('OC', 'report.read')).toBe(true)
    expect(can('OC', 'goldTxn.write')).toBe(false)
    expect(can('OC', 'journal.post')).toBe(false)
  })

  it('gives ADMIN everything', () => {
    expect(can('ADMIN', 'period.close')).toBe(true)
    expect(can('ADMIN', 'user.manage')).toBe(true)
  })

  it('grants nothing without a role', () => {
    expect(can(null, 'report.read')).toBe(false)
  })
})
