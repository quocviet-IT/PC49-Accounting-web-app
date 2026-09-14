import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const { LocaleProvider } = await import('@/lib/i18n/provider')
const { PageSkeleton } = await import('@/components/ui/PageSkeleton')

const render = (locale: 'vi' | 'en') => renderToStaticMarkup(
  <LocaleProvider initialLocale={locale}><PageSkeleton /></LocaleProvider>)

describe('the page skeleton', () => {
  it('says the screen is loading, to assistive technology, in the reader\'s language', () => {
    const vi = render('vi')
    expect(vi).toContain('role="status"')
    expect(vi).toContain('aria-busy="true"')
    expect(vi).toContain('Đang tải…')
    expect(render('en')).toContain('Loading…')
  })

  it('marks itself so a browser check can tell it from the page it stands in for', () => {
    expect(render('vi').match(/data-pc-skeleton/g)).toHaveLength(1)
  })
})
