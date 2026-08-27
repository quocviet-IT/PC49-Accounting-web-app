import { describe, it, expect } from 'vitest'
import { navItemsFor } from '@/lib/nav'

describe('navItemsFor', () => {
  it('shows data-entry sections to KT', () => {
    const keys = navItemsFor('KT').map((i) => i.key)
    expect(keys).toContain('goldTxn')
    expect(keys).toContain('cash')
  })

  it('shows OC read-only screens and nothing else', () => {
    const keys = navItemsFor('OC').map((i) => i.key)
    expect(keys).toEqual(['dashboard', 'inventory', 'reports'])
    for (const forbidden of ['goldTxn', 'cash', 'journal', 'refining', 'settings']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('shows settings to ADMIN', () => {
    expect(navItemsFor('ADMIN').map((i) => i.key)).toContain('settings')
  })

  it('shows nothing when signed out', () => {
    expect(navItemsFor(null)).toEqual([])
  })
})
