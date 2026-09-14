import { describe, expect, it } from 'vitest'
import {
  filterGoldTransactions,
  type GoldTransactionFilters,
} from '@/components/gold/transactionFilters'
import type { SavedRow } from '@/components/gold/types'

const baseRow: SavedRow = {
  id: '1',
  doc_no: 'PO-001',
  txn_type: 'PO',
  partner_code: 'KHÁNH',
  sales_person_code: 'AN',
  gold_type_code: '18K',
  scrap_detail: null,
  gold_pct: null,
  uom: 'GRAM',
  qty: 10,
  unit_price: 100,
  amount: -1000,
  remarks: 'Giao tại quầy',
  payments: [{ seq: 1, amount: 1000, method: 'CASH' }],
  soldBy: [{ code: 'AN', sharePct: 100 }],
  revision: 1,
  blockedReason: null,
}

const all: GoldTransactionFilters = {
  query: '', txnType: null, goldTypeCode: null, staff: null,
  paymentMethod: null, status: null,
}

describe('gold transaction filters', () => {
  it('searches document, partner, phone, and remarks without accents or case', () => {
    const rows = [
      baseRow,
      { ...baseRow, id: '2', doc_no: 'SALE-778', partner_code: 'MINH', remarks: 'Đã giao', payments: [] },
    ]
    const phones = new Map([['KHÁNH', '090 123 4567'], ['MINH', '091 000 0000']])

    for (const query of ['po-001', 'khanh', '0901234567', 'giao tai']) {
      expect(filterGoldTransactions(rows, { ...all, query }, phones).map((r) => r.id)).toEqual(['1'])
    }
  })

  it('combines type, gold, staff, payment, and correction status filters', () => {
    const rows = [
      baseRow,
      {
        ...baseRow,
        id: '2', txn_type: 'SALE', gold_type_code: '24K',
        sales_person_code: 'BINH', soldBy: [{ code: 'BINH', sharePct: 80 }, { code: 'CHI', sharePct: 20 }],
        payments: [{ seq: 1, amount: 1000, method: 'BANKWIRE' }],
        blockedReason: 'Closed period',
      },
    ]

    expect(filterGoldTransactions(rows, {
      ...all,
      txnType: 'SALE',
      goldTypeCode: '24K',
      staff: 'CHI',
      paymentMethod: 'BANKWIRE',
      status: 'locked',
    }, new Map()).map((r) => r.id)).toEqual(['2'])

    expect(filterGoldTransactions(rows, { ...all, status: 'correctable' }, new Map())
      .map((r) => r.id)).toEqual(['1'])
  })
})
