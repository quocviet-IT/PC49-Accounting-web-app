import { describe, it, expect } from 'vitest'
import { ledgerSheet } from '@/components/gold/ledgerCsv'
import { toCsv } from '@/lib/export/csv'
import type { LedgerRow } from '@/components/gold/types'

const sale: LedgerRow = {
  id: '1', txn_date: '2026-01-20', doc_no: 'PC49-2601-028', txn_type: 'SALE',
  partner_code: 'Thục Trinh', partner_phone: '090 123 4567', sales_person_code: 'T.Quỳnh',
  gold_type_code: 'RP', scrap_detail: null, gold_pct: null, uom: 'LUONG', qty: -1,
  unit_price: 5425, amount: 5425, remarks: 'Giao, "gấp"',
  payments: [{ seq: 1, amount: 1600, method: 'ZELLE' }, { seq: 2, amount: 3825, method: 'CASH' }],
  soldBy: [{ code: 'T.Quỳnh', sharePct: 80 }, { code: 'L.Thanh', sharePct: 20 }],
  revision: 1, blockedReason: null,
}

const gold = (code: string) => (code === 'RP' ? 'Rồng Phụng' : code)

describe('the gold ledger as a file', () => {
  it('writes one line per transaction under the headings the screen uses', () => {
    const sheet = ledgerSheet([sale], 'vi', gold)
    expect(sheet.header).toEqual([
      'Ngày', 'Số CT', 'Loại', 'Khách / NCC', 'SĐT khách', 'Sales', 'Loại vàng', 'Tuổi vàng',
      'Số lượng', 'ĐVT', 'Gram', 'Đơn giá', 'Thành tiền', 'Thanh toán', 'Ghi chú',
    ])
    expect(sheet.rows).toEqual([[
      '2026-01-20', 'PC49-2601-028', 'SALE', 'Thục Trinh', '090 123 4567',
      'T.Quỳnh 80% · L.Thanh 20%', 'Rồng Phụng', null, -1, 'LUONG', -37.5,
      5425, 5425, '1600 ZELLE · 3825 CASH', 'Giao, "gấp"',
    ]])
  })

  it('leaves a cell empty rather than writing a word for nothing', () => {
    const bare: LedgerRow = {
      ...sale, partner_code: null, partner_phone: null, sales_person_code: null, soldBy: [],
      payments: [], unit_price: null, remarks: null, scrap_detail: '19-24k/grs', gold_pct: 0.75,
      gold_type_code: 'SG', uom: 'GRAM', qty: 4.5, amount: -250, txn_type: 'PO',
    }
    const [line] = ledgerSheet([bare], 'vi', gold).rows
    expect(line[3]).toBeNull()
    expect(line[5]).toBeNull()
    expect(line[7]).toBe('19-24k/grs · 0.75')
    expect(line[11]).toBeNull()
    expect(line[13]).toBeNull()
  })

  it('survives the CSV writer with its commas and quotes intact', () => {
    const csv = toCsv([ledgerSheet([sale], 'vi', gold)])
    expect(csv.split('\r\n')[1]).toContain('"Giao, ""gấp"""')
  })

  it('heads the columns in English for an English reader', () => {
    expect(ledgerSheet([], 'en', gold).header.slice(0, 2)).toEqual(['Date', 'Doc no.'])
  })
})
