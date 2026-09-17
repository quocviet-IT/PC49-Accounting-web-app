/*
 * The gold ledger screen, rendered the way the server sends it.
 *
 * What it must never do: offer a blank list to type into when the ledger did
 * not arrive, call an empty filter an empty ledger, or total only the page on
 * screen when the filter matched more.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import type { ReceiptRow } from '@/components/gold/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/gold-transactions',
  useSearchParams: () => new URLSearchParams(),
}))

const { LocaleProvider } = await import('@/lib/i18n/provider')
const { TxnScreen } = await import('@/components/gold/TxnScreen')
const { parseLedgerQuery } = await import('@/components/gold/ledgerQuery')

const text = (el: ReactElement) => renderToStaticMarkup(
  <LocaleProvider initialLocale="vi">{el}</LocaleProvider>)
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

const base = {
  query: parseLedgerQuery({}),
  today: '2026-09-15',
  goldTypes: [{ code: 'RP', name_vi: 'Rồng Phụng', name_en: 'Rong Phung', native_uom: 'LUONG' as const }],
  salesPeople: [],
  partners: [],
  rows: [] as ReceiptRow[],
  totals: { count: 0, purchases: 0, sales: 0, grams: {} },
}

const sale: ReceiptRow = {
  key: '1', receiptId: null, txn_date: '2026-01-08', doc_no: 'PC49-2601-028', txn_type: 'SALE',
  partner_code: 'Thuc Trinh', partner_phone: null, sales_person_code: 'T.Quỳnh', remarks: null,
  revision: 1, blockedCode: null, amount: 5425,
  lines: [{
    id: '1', lineNo: 1, itemDesc: null, gold_type_code: 'RP', scrap_detail: null, gold_pct: null,
    uom: 'LUONG', qty: -1, unit_price: 5425, amount: 5425, blockedCode: null,
  }],
  payments: [{ seq: 1, amount: 5425, method: 'CASH' }],
  soldBy: [{ code: 'T.Quỳnh', sharePct: 100 }],
}

describe('the gold ledger screen', () => {
  it('says the ledger could not be read, and offers nothing to type into', () => {
    const html = text(<TxnScreen {...base} loadFailed />)
    expect(html).toContain('Không tải được dữ liệu')
    expect(html).not.toContain('Thêm giao dịch')
  })

  it('tells an empty filter apart from an empty ledger', () => {
    expect(text(<TxnScreen {...base} query={parseLedgerQuery({ type: 'SALE' })} />))
      .toContain('Không có giao dịch khớp bộ lọc.')
    expect(text(<TxnScreen {...base} />)).toContain('Chưa có giao dịch nào.')
  })

  it('shows the day each row belongs to, and totals the whole filter rather than the page', () => {
    const html = text(<TxnScreen {...base} rows={[sale]}
      totals={{ count: 137, purchases: 101130, sales: 15830, grams: { RP: 225 } }} />)
    expect(html).toContain('2026-01-08')
    expect(html).toContain('137')
    expect(html).toContain('101,130.00')
    expect(html).toContain('15,830.00')
  })

  it('says in the reader’s language why a row cannot be corrected', () => {
    // The database answers with a code; the sentence is the screen's to write.
    const leg = { ...sale, key: '2', doc_no: 'PC49-2601-029', blockedCode: 'CONVERSION_LEG' }
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="vi"><TxnScreen {...base} rows={[leg]} /></LocaleProvider>)
    expect(html).toContain('data-tip="Đây là một vế của lần quy đổi; hãy sửa lần quy đổi đó"')
    expect(html).not.toContain('one leg of a conversion')
    expect(html).not.toContain('CONVERSION_LEG')
  })

  it('offers the file of what is being looked at', () => {
    const q = parseLedgerQuery({ from: '2026-01-01', to: '2026-01-31' })
    const html = renderToStaticMarkup(
      <LocaleProvider initialLocale="vi"><TxnScreen {...base} query={q} /></LocaleProvider>)
    expect(html).toContain('href="/gold-transactions/export?from=2026-01-01&amp;to=2026-01-31"')
  })

  it('lists a receipt of several items as one row, named for what is on it', () => {
    const receipt: ReceiptRow = {
      ...sale, key: '3', receiptId: '3', doc_no: 'PC49-2609-010', txn_type: 'PO', amount: -2850,
      lines: [
        { ...sale.lines[0], id: 'a', lineNo: 1, itemDesc: 'Nhẫn 24K (vụn)', gold_type_code: 'SG',
          uom: 'GRAM', qty: 9.4, gold_pct: 0.987, unit_price: 101.06382979, amount: -950 },
        { ...sale.lines[0], id: 'b', lineNo: 2, itemDesc: 'Thỏi RCM', gold_type_code: 'GRAIN',
          uom: 'GRAM', qty: 15.6, gold_pct: 0.998, unit_price: 121.79487179, amount: -1900 },
      ],
    }
    const html = text(<TxnScreen {...base} rows={[receipt]}
      totals={{ count: 1, purchases: 2850, sales: 0, grams: {} }} />)
    expect(html).toContain('PC49-2609-010')
    expect(html).toContain('Nhiều loại (2 món)')
    expect(html).toContain('25.00 g')
    expect(html).toContain('-2,850.00')
    expect(html).toContain('Số phiếu')
  })
})
