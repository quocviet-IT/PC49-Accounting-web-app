/*
 * The dashboard's activity chart, as the server sends it.
 *
 * Rendered to static markup because both faults this guards against live in
 * what the server writes. The browser check found them as a hydration failure
 * on every load of the home page, which throws the server's HTML away and
 * draws the whole dashboard again on the client.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const { LocaleProvider } = await import('@/lib/i18n/provider')
const { TransactionCharts } = await import('@/components/home/TransactionCharts')
const { aggregateDashboardTransactions } = await import('@/components/home/dashboard-series')

// One purchase, stored the way the books store it: the money paid is negative.
const summary = aggregateDashboardTransactions(
  [{ txnDate: '2026-08-29', txnType: 'PO', amount: -4300 }], '2026-09-14')

const html = renderToStaticMarkup(
  <LocaleProvider initialLocale="vi">
    <TransactionCharts activity={{ state: 'ready', value: summary, fetchedAt: '2026-09-14T00:00:00Z' }}
                       start="2026-08-16" end="2026-09-14" today="2026-09-14"
                       onRetry={() => {}} />
  </LocaleProvider>)

describe('the dashboard activity chart', () => {
  it('writes each bar\'s label into the page the server sends', () => {
    // A <title> whose children are several pieces renders as nothing on the
    // server and as text in the browser, so the two never agreed.
    expect(html).toMatch(/<title>2026-08-29: [^<]+ 4,300\.00 USD<\/title>/)
  })

  it('draws a purchase as money paid out, never as a bar below its baseline', () => {
    // Summing the stored amount drew the purchase 903,000 pixels high,
    // upside down: −4,300 over a scale that bottomed out at 1.
    const heights = [...html.matchAll(/<rect[^>]*height="(-?[\d.]+)"/g)].map((m) => Number(m[1]))
    expect(heights.length).toBeGreaterThan(0)
    expect(heights.every((h) => h >= 0)).toBe(true)
    expect(Math.max(...heights)).toBeGreaterThan(0)
  })
})
