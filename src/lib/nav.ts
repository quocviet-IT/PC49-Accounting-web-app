import { can, type Capability, type Role } from '@/lib/auth/roles'
import type { MessageKey } from '@/lib/i18n'

/**
 * The navigation, as plain data.
 *
 * A page names every capability that opens it; holding any one is enough. A
 * group is shown when at least one page inside it is, so a role never sees a
 * heading that opens onto nothing.
 *
 * Icons are not here. They live in the shell, so this file stays data a unit
 * test can check against the app's actual routes.
 */

export type NavPage = {
  key: string
  labelKey: MessageKey
  requires: Capability | Capability[] | null
}

export type NavGroup = {
  key: string
  labelKey: MessageKey
  children: NavPage[]
}

export type NavItem = NavPage | NavGroup

export function isNavGroup(item: NavItem): item is NavGroup {
  return 'children' in item
}

const ALL: NavItem[] = [
  { key: '/', labelKey: 'nav.dashboard', requires: null },
  {
    key: 'trading',
    labelKey: 'nav.group.trading',
    children: [
      { key: '/gold-transactions', labelKey: 'nav.goldTxn', requires: 'goldTxn.write' },
      { key: '/prices', labelKey: 'nav.prices', requires: 'goldTxn.write' },
      { key: '/refining', labelKey: 'nav.refining', requires: 'refining.write' },
      { key: '/inventory', labelKey: 'nav.inventory', requires: 'report.read' },
    ],
  },
  {
    key: 'money',
    labelKey: 'nav.group.money',
    children: [
      { key: '/cash', labelKey: 'nav.cash', requires: 'bankImport.run' },
      { key: '/bank-conversion', labelKey: 'nav.bankGold', requires: 'goldTxn.write' },
    ],
  },
  {
    key: 'books',
    labelKey: 'nav.group.books',
    children: [
      { key: '/journal', labelKey: 'nav.journal', requires: 'journal.post' },
      { key: '/reports', labelKey: 'nav.reports', requires: 'report.read' },
    ],
  },
  // No capability. Everybody may report a problem, and everybody may see what
  // happened to what they reported — the row filtering is the database's job,
  // not the menu's.
  { key: '/feedback', labelKey: 'nav.feedback', requires: null },
  {
    key: '/settings',
    labelKey: 'nav.settings',
    requires: ['dataImport.run', 'period.close', 'catalog.manage'],
  },
]

function allowed(role: Role, requires: NavPage['requires']): boolean {
  if (requires === null) return true
  const needed = Array.isArray(requires) ? requires : [requires]
  return needed.some((c) => can(role, c))
}

export function navigationForRole(role: Role | null): NavItem[] {
  if (!role) return []
  return ALL.flatMap<NavItem>((item) => {
    if (!isNavGroup(item)) return allowed(role, item.requires) ? [item] : []
    const children = item.children.filter((child) => allowed(role, child.requires))
    // An empty group is a heading that opens onto nothing.
    return children.length > 0 ? [{ ...item, children }] : []
  })
}

/** Every page a role may open, flattened — what a permission check reads. */
export function pagesForRole(role: Role | null): NavPage[] {
  return navigationForRole(role).flatMap((item) => (isNavGroup(item) ? item.children : [item]))
}

/** The page a path belongs to, longest match first so `/settings/periods` wins. */
export function findActivePage(pathname: string): NavPage | undefined {
  const pages = ALL.flatMap((item) => (isNavGroup(item) ? item.children : [item]))
  return [...pages]
    .sort((a, b) => b.key.length - a.key.length)
    .find((page) => (page.key === '/' ? pathname === '/' : pathname.startsWith(page.key)))
}

/** The group a page sits in, so the sidebar can open it. */
export function findActiveGroup(pageKey: string): string | undefined {
  return ALL.find((item) => isNavGroup(item) && item.children.some((c) => c.key === pageKey))?.key
}
