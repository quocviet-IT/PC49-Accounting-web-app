import { describe, it, expect } from 'vitest'
import { t, type MessageKey } from '@/lib/i18n'
import { goldSummary, toReceiptRow } from '@/components/gold/ledgerRow'
import type { ReceiptLine } from '@/components/gold/types'

const say = (key: MessageKey) => t('vi', key)
const NAMES: Record<string, string> = { SG: 'Vàng vụn', GRAIN: 'Vàng Grain', RP: 'Rồng Phụng' }
const gold = (code: string) => NAMES[code] ?? code

const line = (over: Partial<ReceiptLine>): ReceiptLine => ({
  id: 'a', lineNo: 1, itemDesc: null, gold_type_code: 'SG', scrap_detail: null, gold_pct: null,
  uom: 'GRAM', qty: 1, unit_price: 1, amount: -1, blockedCode: null, ...over,
})

describe('a row of the receipt ledger', () => {
  it('reads figures that arrive as text as numbers, and names what is missing null', () => {
    const row = toReceiptRow({
      receipt_key: 'k1', receipt_id: null, txn_date: '2026-09-16', doc_no: 'PC49-2609-010',
      txn_type: 'PO', partner_code: 'Nguyen Van A', partner_phone: null, sales_person_code: 'L.Thanh',
      remarks: null, revision: '3', blocked_code: null, amount: '-2850.00', line_count: 2,
      lines: [
        { id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', goldTypeCode: 'SG', scrapDetail: '19-24k/grs',
          goldPct: '0.9870', uom: 'GRAM', qty: '9.4000', unitPrice: '101.06382979', amount: '-950.00',
          blockedCode: null },
        { id: 'b', lineNo: 2, itemDesc: null, goldTypeCode: 'GRAIN', scrapDetail: null, goldPct: null,
          uom: 'GRAM', qty: 15.6, unitPrice: 121.79487179, amount: -1900, blockedCode: 'REFINING_SOURCE' },
      ],
      payments: [{ seq: 1, amount: '950.00', method: 'CASH' }],
      sold_by: [{ code: 'L.Thanh', sharePct: '100' }],
    })
    expect(row).toMatchObject({ key: 'k1', receiptId: null, revision: 3, amount: -2850, blockedCode: null })
    expect(row.lines[0]).toEqual({
      id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG', scrap_detail: '19-24k/grs',
      gold_pct: 0.987, uom: 'GRAM', qty: 9.4, unit_price: 101.06382979, amount: -950, blockedCode: null,
      side: null,
    })
    expect(row.conversion).toBeNull()
    expect(row.lines[1]).toMatchObject({ itemDesc: null, gold_pct: null, blockedCode: 'REFINING_SOURCE' })
    expect(row.payments).toEqual([{ seq: 1, amount: 950, method: 'CASH' }])
    expect(row.soldBy).toEqual([{ code: 'L.Thanh', sharePct: 100 }])
  })
})

describe('what was paid later, and what is owed', () => {
  it('reads the later payments and what is owed as numbers', () => {
    const row = toReceiptRow({
      receipt_key: 'k2', receipt_id: 'k2', txn_date: '2026-09-16', doc_no: 'PC49-2609-011',
      txn_type: 'PO', revision: 1, amount: '-8361.00', lines: [], sold_by: [],
      payments: [{ seq: 1, amount: '5000.00', method: 'CASH' }],
      settlements: [{ id: 's1', payDate: '2026-09-20', amount: '2000.00', method: 'ZELLE', note: null }],
      owed: '1361.00',
    })
    expect(row.settlements).toEqual([
      { id: 's1', payDate: '2026-09-20', amount: 2000, method: 'ZELLE', note: null },
    ])
    expect(row.owed).toBe(1361)
  })

  it('reads a row without them as owing nothing', () => {
    const row = toReceiptRow({
      receipt_key: 'k3', txn_date: '2026-09-16', txn_type: 'PO', lines: [], payments: [], sold_by: [],
    })
    expect(row.settlements).toEqual([])
    expect(row.owed).toBe(0)
  })
})

describe('a deposit and its pickup on the ledger', () => {
  it('reads what the order comes to, what was put down, and when it was collected', () => {
    const row = toReceiptRow({
      receipt_key: 'd1', txn_date: '2026-09-08', txn_type: 'DEPOSIT', lines: [], payments: [], sold_by: [],
      deposit: { role: 'deposit', orderValue: '5300.00', paid: '1000.00', settledBy: 'PICKUP',
                 pickupDate: '2026-09-15', pickupDoc: 'PC49-2609-020' },
    })
    expect(row.deposit).toEqual({
      role: 'deposit', orderValue: 5300, paid: 1000, settledBy: 'PICKUP', pickupDate: '2026-09-15',
      pickupDoc: 'PC49-2609-020', depositDate: null, depositDoc: null,
    })
    expect(toReceiptRow({ receipt_key: 'x', txn_date: '2026-09-08', txn_type: 'SALE', lines: [],
      payments: [], sold_by: [] }).deposit).toBeNull()
  })
})

describe('what a receipt is called in the gold column', () => {
  it('is the gold type for one item', () => {
    expect(goldSummary({ lines: [line({})] }, gold, say)).toBe('Vàng vụn')
  })

  it('counts the items when they are all the same gold', () => {
    expect(goldSummary({ lines: [line({}), line({ id: 'b' })] }, gold, say)).toBe('Vàng vụn · 2 món')
  })

  it('says several kinds when they differ', () => {
    expect(goldSummary({ lines: [line({}), line({ id: 'b', gold_type_code: 'GRAIN' })] }, gold, say))
      .toBe('Nhiều loại (2 món)')
  })
})

describe('a conversion row of the ledger', () => {
  const raw = {
    receipt_key: 'c1', receipt_id: null, txn_date: '2026-06-07', doc_no: 'PC49-2606-040',
    txn_type: 'TRANSFER_OUT', partner_code: null, partner_phone: null, sales_person_code: null,
    remarks: 'Transfer 637.5gr vang Grain ra 17L VRP', revision: 2, blocked_code: null, amount: '0',
    line_count: 2, payments: [], sold_by: [],
    conversion_id: 'c1', conversion_kind: 'TRANSFER', variance_note: null, variance_reason: null,
    lines: [
      { id: 'o', lineNo: 1, side: 'out', itemDesc: null, goldTypeCode: 'GRAIN', scrapDetail: null,
        goldPct: null, uom: 'GRAM', qty: '-637.5000', unitPrice: null, amount: '0.00', blockedCode: 'CONVERSION_LEG' },
      { id: 'i', lineNo: 1, side: 'in', itemDesc: null, goldTypeCode: 'RP', scrapDetail: null,
        goldPct: null, uom: 'LUONG', qty: '17.0000', unitPrice: null, amount: '0.00', blockedCode: 'CONVERSION_LEG' },
    ],
  }

  it('says it is a conversion, and which side each leg is on', () => {
    const row = toReceiptRow(raw)
    expect(row.conversion).toEqual({ id: 'c1', kind: 'TRANSFER', varianceNote: null, varianceReason: null })
    expect(row.lines.map((l) => [l.side, l.qty])).toEqual([['out', -637.5], ['in', 17]])
  })

  it('is named for the gold that went out and came in', () => {
    expect(goldSummary(toReceiptRow(raw), gold, say)).toBe('Vàng Grain → Rồng Phụng')
    const nini = toReceiptRow({
      ...raw,
      lines: [
        { ...raw.lines[0], goldTypeCode: 'RP' },
        { ...raw.lines[1], id: 'a', goldTypeCode: 'CS' },
        { ...raw.lines[1], id: 'b', goldTypeCode: 'OTH' },
        { ...raw.lines[1], id: 'c', goldTypeCode: 'GRAIN' },
      ],
    })
    expect(goldSummary(nini, gold, say)).toBe('Nhiều loại (1 ra → 3 vào)')
  })
})
