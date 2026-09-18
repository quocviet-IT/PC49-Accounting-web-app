/*
 * The stock table in each gold's own unit.
 *
 * "Bảng tồn kho, thể hiện đơn vị tính L, Oz nhưng số tồn đang thể hiện là gr"
 * (18-09-2026): the unit column said L and Oz while the figures beside it were
 * grams.
 */
import { it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
}))

const { LocaleProvider } = await import('@/lib/i18n/provider')
const { InventoryView } = await import('@/components/gold/InventoryView')

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

it('writes luong and ounces as luong and ounces, the grams beneath, and grams as grams', () => {
  const html = text(renderToStaticMarkup(
    <LocaleProvider initialLocale="vi">
      <InventoryView
        period="2026-09"
        asOf="2026-09-18"
        rows={[
          { code: 'RP', nameVi: 'Rong Phung', nameEn: 'Rong Phung', uom: 'LUONG',
            book: 450, physical: 487.5, total: 487.5 },
          { code: 'CS', nameVi: 'Credit Suisse', nameEn: 'Credit Suisse', uom: 'OZ',
            book: 62.21, physical: 62.21, total: 62.21 },
          { code: 'SG', nameVi: 'Scrap Gold', nameEn: 'Scrap Gold', uom: 'GRAM',
            book: 16.9, physical: 16.9, total: 16.9 },
        ]}
        movements={[{ code: 'RP', opening: 375, receipt: 75, issue: 37.5, closing: 412.5,
                      openingValue: 0, closingValue: 0, adjustment: 0 }]}
      />
    </LocaleProvider>))
  expect(html).toContain('12.00 L 450.00 g')
  expect(html).toContain('13.00 L 487.50 g')
  expect(html).toContain('2.00 Oz 62.21 g')
  expect(html).toContain('16.90')
  // The month's movement too: opening, in, out, closing.
  expect(html).toContain('10.00 L 375.00 g')
  expect(html).toContain('2.00 L 75.00 g')
  expect(html).toContain('-1.00 L -37.50 g')
  expect(html).toContain('11.00 L 412.50 g')
})
