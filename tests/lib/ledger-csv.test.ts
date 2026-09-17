import { describe, it, expect } from 'vitest'
import { ledgerSheet } from '@/components/gold/ledgerCsv'
import { toCsv } from '@/lib/export/csv'
import type { ReceiptRow } from '@/components/gold/types'

const receipt: ReceiptRow = {
  key: 'r1', receiptId: 'r1', txn_date: '2026-09-16', doc_no: 'PC49-2609-010', txn_type: 'PO',
  partner_code: 'Nguyen Van A', partner_phone: '090 123 4567', sales_person_code: 'T.Quỳnh',
  remarks: 'Giao, "gấp"', revision: 1, blockedCode: null, amount: -2850,
  lines: [
    { id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG', scrap_detail: '19-24k/grs',
      gold_pct: 0.987, uom: 'GRAM', qty: 9.4, unit_price: 101.06382979, amount: -950, blockedCode: null },
    { id: 'b', lineNo: 2, itemDesc: 'Thỏi RCM', gold_type_code: 'GRAIN', scrap_detail: null,
      gold_pct: 0.998, uom: 'GRAM', qty: 15.6, unit_price: 121.79487179, amount: -1900, blockedCode: null },
  ],
  payments: [{ seq: 1, amount: 950, method: 'CASH' }, { seq: 2, amount: 1900, method: 'BANKWIRE' }],
  soldBy: [{ code: 'T.Quỳnh', sharePct: 80 }, { code: 'L.Thanh', sharePct: 20 }],
}

const NAMES: Record<string, string> = { SG: 'Vàng vụn', GRAIN: 'Vàng Grain', RP: 'Rồng Phụng' }
const gold = (code: string) => NAMES[code] ?? code

describe('the gold ledger as a file', () => {
  it('writes one line per item, the receipt repeated on each', () => {
    const sheet = ledgerSheet([receipt], 'vi', gold)
    expect(sheet.header).toEqual([
      'Ngày', 'Số CT', 'Món', 'Mô tả món', 'Loại', 'Khách / NCC', 'SĐT khách', 'Sales',
      'Loại vàng', 'Tuổi vàng', 'Số lượng', 'ĐVT', 'Gram', 'Gram tinh', 'Đơn giá',
      'Thành tiền', 'Thanh toán', 'Ghi chú',
    ])
    expect(sheet.rows).toEqual([
      ['2026-09-16', 'PC49-2609-010', 1, 'Nhẫn 24K (vụn)', 'PO', 'Nguyen Van A', '090 123 4567',
        'T.Quỳnh 80% · L.Thanh 20%', 'Vàng vụn', '19-24k/grs · 0.987', 9.4, 'GRAM', 9.4, 9.2778,
        101.06382979, -950, '950 CASH · 1900 BANKWIRE', 'Giao, "gấp"'],
      ['2026-09-16', 'PC49-2609-010', 2, 'Thỏi RCM', 'PO', 'Nguyen Van A', '090 123 4567',
        'T.Quỳnh 80% · L.Thanh 20%', 'Vàng Grain', '0.998', 15.6, 'GRAM', 15.6, 15.5688,
        121.79487179, -1900, null, 'Giao, "gấp"'],
    ])
  })

  it('adds up, down the amount column, to what the receipts came to', () => {
    const rows = ledgerSheet([receipt], 'vi', gold).rows
    expect(rows.reduce((sum, r) => sum + Number(r[15]), 0)).toBe(-2850)
  })

  it('leaves a cell empty rather than writing a word for nothing', () => {
    const bare: ReceiptRow = {
      ...receipt, partner_code: null, partner_phone: null, sales_person_code: null, soldBy: [],
      payments: [], remarks: null,
      lines: [{ ...receipt.lines[0], itemDesc: null, unit_price: null, gold_pct: null, scrap_detail: null,
                gold_type_code: 'RP', uom: 'LUONG', qty: -1, amount: 5425 }],
    }
    const [line] = ledgerSheet([bare], 'vi', gold).rows
    expect(line[3]).toBeNull()
    expect(line[5]).toBeNull()
    expect(line[7]).toBeNull()
    expect(line[9]).toBeNull()
    expect(line[12]).toBe(-37.5)
    expect(line[13]).toBeNull()
    expect(line[14]).toBeNull()
    expect(line[16]).toBeNull()
  })

  it('survives the CSV writer with its commas and quotes intact', () => {
    const csv = toCsv([ledgerSheet([receipt], 'vi', gold)])
    expect(csv.split('\r\n')[1]).toContain('"Giao, ""gấp"""')
  })

  it('heads the columns in English for an English reader', () => {
    expect(ledgerSheet([], 'en', gold).header.slice(0, 2)).toEqual(['Date', 'Doc no.'])
  })
})
