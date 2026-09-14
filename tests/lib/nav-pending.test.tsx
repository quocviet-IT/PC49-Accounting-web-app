import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NavPendingMark } from '@/components/NavPending'

it('keeps its place in the menu whether or not a screen is on its way', () => {
  // Same element, same size, either way: only the class changes, so the label
  // beside it never moves when a click starts or finishes.
  expect(renderToStaticMarkup(<NavPendingMark pending={false} />))
    .toBe('<span aria-hidden="true" class="pc-nav-pending"></span>')
  expect(renderToStaticMarkup(<NavPendingMark pending />))
    .toBe('<span aria-hidden="true" class="pc-nav-pending is-pending"></span>')
})
