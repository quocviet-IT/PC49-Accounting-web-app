import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NavCount, NavDot } from '@/components/NavBadge'

it('draws nothing when nothing is waiting', () => {
  expect(renderToStaticMarkup(<NavCount count={0} label="0 mục cần xem" />)).toBe('')
  expect(renderToStaticMarkup(<NavDot count={0} label="0 mục cần xem"><i>icon</i></NavDot>))
    .toBe('<i>icon</i>')
})

it('draws the number, named for somebody who cannot see it, when something is', () => {
  const html = renderToStaticMarkup(<NavCount count={3} label="3 mục cần xem" />)
  expect(html).toContain('3')
  expect(html).toContain('3 mục cần xem')
  expect(renderToStaticMarkup(<NavDot count={3} label="3 mục cần xem"><i>icon</i></NavDot>))
    .toContain('ant-badge-dot')
})
