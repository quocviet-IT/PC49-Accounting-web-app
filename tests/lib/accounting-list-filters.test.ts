import { describe, expect, it } from 'vitest'
import {
  filterCashMovements,
  filterReconciliations,
} from '@/components/cash/CashView'
import { filterInventoryRows } from '@/components/gold/InventoryView'

describe('cash workspace filters', () => {
  const movements = [
    { id: '1', date: '2026-09-01', account: 'BANK_USD', direction: 'IN' as const,
      amount: 120, description: 'Thu khách Hà Nội', note: null, source: 'BANK' },
    { id: '2', date: '2026-09-02', account: 'CASH_VND', direction: 'OUT' as const,
      amount: 45, description: 'Phí vận chuyển', note: 'Đã duyệt', source: 'MANUAL' },
  ]

  it('finds a movement without requiring Vietnamese accents', () => {
    expect(filterCashMovements(movements, 'ha noi', null, null).map((row) => row.id))
      .toEqual(['1'])
  })

  it('combines account and direction filters', () => {
    expect(filterCashMovements(movements, '', 'CASH_VND', 'OUT').map((row) => row.id))
      .toEqual(['2'])
  })

  it('separates accounts that still need reconciliation', () => {
    const rows = [
      { account: 'BANK_USD', accountName: 'Bank USD', ours: 100, reconciliation: null },
      { account: 'CASH_VND', accountName: 'Cash VND', ours: 90,
        reconciliation: { account: 'CASH_VND', date: '2026-09-30', ours: 90,
          theirs: 90, difference: 0, status: 'MATCHED', reason: null } },
    ]
    expect(filterReconciliations(rows, '', 'pending').map((row) => row.account))
      .toEqual(['BANK_USD'])
    expect(filterReconciliations(rows, '', 'MATCHED').map((row) => row.account))
      .toEqual(['CASH_VND'])
  })
})

describe('inventory workspace filters', () => {
  it('matches code or localized name without accents', () => {
    const rows = [
      { code: 'AU18', nameVi: 'Vàng 18K', nameEn: '18K gold', uom: 'gram',
        book: 1, physical: 2, total: 3 },
      { code: 'SCRAP', nameVi: 'Phế liệu', nameEn: 'Scrap', uom: 'gram',
        book: 2, physical: 0, total: 2 },
    ]
    expect(filterInventoryRows(rows, 'vang').map((row) => row.code)).toEqual(['AU18'])
    expect(filterInventoryRows(rows, 'scrap').map((row) => row.code)).toEqual(['SCRAP'])
  })
})
