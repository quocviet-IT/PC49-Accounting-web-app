import { can, type Capability, type Role } from '@/lib/auth/roles'
import type { MessageKey } from '@/lib/i18n'

export type NavItem = { key: string; labelKey: MessageKey; href: string }

const ALL: (NavItem & { requires: Capability | null })[] = [
  { key: 'dashboard', labelKey: 'nav.dashboard', href: '/', requires: null },
  { key: 'goldTxn', labelKey: 'nav.goldTxn', href: '/gold-transactions', requires: 'goldTxn.write' },
  { key: 'inventory', labelKey: 'nav.inventory', href: '/inventory', requires: 'report.read' },
  { key: 'refining', labelKey: 'nav.refining', href: '/refining', requires: 'refining.write' },
  { key: 'cash', labelKey: 'nav.cash', href: '/cash', requires: 'bankImport.run' },
  { key: 'bankGold', labelKey: 'nav.bankGold', href: '/bank-conversion', requires: 'goldTxn.write' },
  { key: 'journal', labelKey: 'nav.journal', href: '/journal', requires: 'journal.post' },
  { key: 'reports', labelKey: 'nav.reports', href: '/reports', requires: 'report.read' },
  { key: 'import', labelKey: 'nav.import', href: '/import', requires: 'dataImport.run' },
  { key: 'settings', labelKey: 'nav.settings', href: '/settings', requires: 'catalog.manage' },
]

export function navItemsFor(role: Role | null): NavItem[] {
  if (!role) return []
  return ALL.filter((i) => i.requires === null || can(role, i.requires)).map(
    ({ key, labelKey, href }) => ({ key, labelKey, href }),
  )
}
