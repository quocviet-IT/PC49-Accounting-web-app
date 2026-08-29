import { describe, it, expect } from 'vitest'
import {
  findActiveGroup, findActivePage, isNavGroup, navigationForRole, pagesForRole,
} from '@/lib/nav'
import type { Role } from '@/lib/auth/roles'

const ROLES: Role[] = ['KT', 'GS_US', 'OC', 'ADMIN']

/** Every page a role can reach, by path. */
function paths(role: Role | null): string[] {
  return pagesForRole(role).map((p) => p.key)
}

describe('what each role is offered', () => {
  it('gives the accountant the screens they work in every day', () => {
    expect(paths('KT')).toEqual(expect.arrayContaining(
      ['/gold-transactions', '/prices', '/cash', '/bank-conversion', '/journal']))
  })

  it('gives the owner read-only screens and nothing else', () => {
    // Reporting a problem is on the list because it is not a privilege: the
    // owner is the likeliest person to notice a figure is wrong and the least
    // likely to have anywhere else to say so.
    expect(paths('OC').sort()).toEqual(['/', '/feedback', '/inventory', '/reports'])
  })

  it('lets every role report a problem', () => {
    for (const role of ROLES) expect(paths(role)).toContain('/feedback')
  })

  it('does not offer the owner anything that writes', () => {
    for (const forbidden of ['/gold-transactions', '/prices', '/cash', '/journal', '/settings']) {
      expect(paths('OC')).not.toContain(forbidden)
    }
  })

  it('keeps the price screen where the accountant works, not behind settings', () => {
    expect(paths('KT')).toContain('/prices')
    expect(paths('GS_US')).not.toContain('/prices')
  })

  it('offers settings to everyone with something behind it', () => {
    // Three roles reach three different cards there; the owner reaches none.
    for (const role of ['KT', 'GS_US', 'ADMIN'] as const) {
      expect(paths(role)).toContain('/settings')
    }
    expect(paths('OC')).not.toContain('/settings')
  })

  it('shows nothing at all when signed out', () => {
    expect(navigationForRole(null)).toEqual([])
  })
})

describe('the shape of the menu', () => {
  it('never shows a group that opens onto nothing', () => {
    for (const role of ROLES) {
      for (const item of navigationForRole(role)) {
        if (isNavGroup(item)) expect(item.children.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the top level short enough to read at a glance', () => {
    // A sidebar can scroll, but a reader cannot hold fifteen headings in view.
    for (const role of ROLES) {
      expect(navigationForRole(role).length).toBeLessThanOrEqual(6)
    }
  })

  it('lists no page twice', () => {
    for (const role of ROLES) {
      const keys = paths(role)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('knowing which page is open', () => {
  it('matches a page by its own path', () => {
    expect(findActivePage('/prices')?.key).toBe('/prices')
    expect(findActivePage('/journal')?.key).toBe('/journal')
  })

  it('matches a sub-path to the page it belongs to', () => {
    expect(findActivePage('/settings/periods')?.key).toBe('/settings')
    expect(findActivePage('/gold-transactions?date=2026-01-05')?.key)
      .toBe('/gold-transactions')
  })

  it('does not let the dashboard swallow every other path', () => {
    // '/' is a prefix of everything, so it matches only itself.
    expect(findActivePage('/reports')?.key).toBe('/reports')
    expect(findActivePage('/')?.key).toBe('/')
  })

  it('says which group to open for a page inside one', () => {
    expect(findActiveGroup('/prices')).toBe('trading')
    expect(findActiveGroup('/cash')).toBe('money')
    expect(findActiveGroup('/reports')).toBe('books')
  })

  it('says nothing for a page that stands on its own', () => {
    expect(findActiveGroup('/')).toBeUndefined()
    expect(findActiveGroup('/settings')).toBeUndefined()
  })

  it('returns nothing for a path the app does not serve', () => {
    expect(findActivePage('/nope')).toBeUndefined()
  })
})
