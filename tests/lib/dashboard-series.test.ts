import { describe, expect, it } from 'vitest'
import {
  aggregateDashboardTransactions,
  dashboardActivityEnd,
  dashboardDateRange,
} from '@/components/home/dashboard-series'

describe('dashboard activity end date', () => {
  it('accepts a real ISO calendar date', () => {
    expect(dashboardActivityEnd('2026-01-31', '2026-09-14')).toBe('2026-01-31')
  })

  it.each([undefined, '', '01-31-2026', '2026-02-30', '2026-13-01']) (
    'falls back to today for invalid input %s',
    (value) => {
      expect(dashboardActivityEnd(value, '2026-09-14')).toBe('2026-09-14')
    },
  )
})

describe('dashboard transaction date range', () => {
  it('uses thirty inclusive UTC calendar days across a month boundary', () => {
    expect(dashboardDateRange('2026-03-05')).toEqual({
      start: '2026-02-04',
      end: '2026-03-05',
    })
  })

  it('handles a leap day without local-time drift', () => {
    expect(dashboardDateRange('2024-03-01')).toEqual({
      start: '2024-02-01',
      end: '2024-03-01',
    })
  })
})

describe('dashboard transaction aggregation', () => {
  it('fills missing days and combines purchase kinds without mixing in deposits', () => {
    // Amounts as the books keep them (0012, gold_txn_purchase_sign): what is
    // paid for a purchase is negative, what a sale takes in is positive. Both
    // are drawn as money, so both come out positive here.
    const result = aggregateDashboardTransactions([
      { txnDate: '2026-02-04', txnType: 'PO', amount: -100 },
      { txnDate: '2026-02-04', txnType: 'PO_VENDOR', amount: -25 },
      { txnDate: '2026-02-04', txnType: 'SALE', amount: 70 },
      { txnDate: '2026-02-05', txnType: 'DEPOSIT', amount: 40 },
      { txnDate: '2026-03-05', txnType: 'SALE', amount: 90 },
    ], '2026-03-05')

    expect(result.daily).toHaveLength(30)
    expect(result.daily[0]).toEqual({ date: '2026-02-04', purchases: 125, sales: 70 })
    expect(result.daily[1]).toEqual({ date: '2026-02-05', purchases: 0, sales: 0 })
    expect(result.daily.at(-1)).toEqual({ date: '2026-03-05', purchases: 0, sales: 90 })
  })

  it('excludes rows outside the range and sorts type counts deterministically', () => {
    const result = aggregateDashboardTransactions([
      { txnDate: '2026-01-30', txnType: 'SALE', amount: 999 },
      { txnDate: '2026-02-01', txnType: 'SALE', amount: 20 },
      { txnDate: '2026-02-01', txnType: 'PO', amount: -10 },
      { txnDate: '2026-02-02', txnType: 'PO', amount: -15 },
      { txnDate: '2026-03-01', txnType: 'MEMO', amount: 999 },
    ], '2026-03-01')

    expect(result.byType).toEqual([
      { txnType: 'PO', count: 2 },
      { txnType: 'MEMO', count: 1 },
      { txnType: 'SALE', count: 1 },
    ])
    expect(result.transactionCount).toBe(4)
  })

  it('returns a real empty period as zero-filled series and no type slices', () => {
    const result = aggregateDashboardTransactions([], '2026-09-14')
    expect(result.daily).toHaveLength(30)
    expect(result.daily.every((day) => day.purchases === 0 && day.sales === 0)).toBe(true)
    expect(result.byType).toEqual([])
    expect(result.transactionCount).toBe(0)
  })
})
