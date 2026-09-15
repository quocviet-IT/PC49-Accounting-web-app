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
import type { LedgerRow } from '@/components/gold/types'

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
  rows: [] as LedgerRow[],
  totals: { count: 0, purchases: 0, sales: 0, grams: {} },
}

const sale: LedgerRow = {
  id: '1', txn_date: '2026-01-08', doc_no: 'PC49-2601-028', txn_type: 'SALE',
  partner_code: 'Thuc Trinh', partner_phone: null, sales_person_code: 'T.Quỳnh',
  gold_type_code: 'RP', scrap_detail: null, gold_pct: null, uom: 'LUONG', qty: -1,
  unit_price: 5425, amount: 5425, remarks: null,
  payments: [{ seq: 1, amount: 5425, method: 'CASH' }],
  soldBy: [{ code: 'T.Quỳnh', sharePct: 100 }], revision: 1, blockedCode: null,
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
    const leg = { ...sale, id: '2', doc_no: 'PC49-2601-029', blockedCode: 'CONVERSION_LEG' }
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
})
