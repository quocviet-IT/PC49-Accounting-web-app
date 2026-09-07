/*
 * The menu must declare exactly what the page behind it enforces.
 *
 * `nav.ts` says so in its own words — "a page names every capability that
 * opens it" — but nothing checked it, and three entries had drifted:
 *
 *   /cash     asked for bankImport.run while the page admitted report.read
 *   /journal  asked for journal.post   while the page admitted report.read
 *   /refining asked for refining.write while the page also admitted approve
 *
 * Each drift makes one of two faults. Asking for too much hides a page from
 * somebody who may open it, so they reach it by typing the URL or not at all.
 * Asking for too little offers a link that lands on Forbidden, which reads as
 * a broken system rather than as a boundary.
 *
 * This reads the guard out of each page file rather than trusting a list kept
 * beside it, because a list kept beside it is the thing that drifted.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isNavGroup, navigationForRole } from '@/lib/nav'
import type { NavItem, NavPage } from '@/lib/nav'

/**
 * Every page in the menu, groups flattened.
 *
 * The list itself is module-private on purpose, so it is read back through the
 * one role that sees everything. An entry hidden from ADMIN too would escape
 * this check, which is why the count is asserted below.
 */
function allPages(): NavPage[] {
  return navigationForRole('ADMIN').flatMap((item: NavItem) =>
    (isNavGroup(item) ? item.children : [item]))
}

const APP = join(process.cwd(), 'src', 'app', '(app)')

function pageFile(key: string): string | null {
  const path = key === '/'
    ? join(APP, 'page.tsx')
    : join(APP, ...key.slice(1).split('/'), 'page.tsx')
  return existsSync(path) ? path : null
}

/**
 * The condition of the `if` that returns Forbidden, with parentheses matched
 * rather than guessed — the condition itself contains `can(role, '…')`, so a
 * non-greedy match to the first `)` would cut it in half.
 */
function guardCondition(source: string): string | null {
  const at = source.indexOf('<Forbidden')
  if (at === -1) return null
  // Walk back to the nearest `if (` before it.
  const head = source.lastIndexOf('if (', at)
  if (head === -1) return null
  let depth = 0
  for (let i = head + 3; i < at; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(head + 4, i)
    }
  }
  return null
}

/** Capabilities named in a guard, following one level of `const x = can(...)`. */
function guardCapabilities(source: string): Set<string> {
  const condition = guardCondition(source)
  if (condition === null) return new Set()

  const found = new Set<string>()
  for (const m of condition.matchAll(/can\(role,\s*'([^']+)'\)/g)) found.add(m[1])

  // The settings hub reads its guard off named booleans rather than inline
  // calls, so a check that only understood the inline form would score it as
  // having no guard at all.
  const aliases = new Map<string, string>()
  for (const m of source.matchAll(/const\s+(\w+)\s*=\s*can\(role,\s*'([^']+)'\)/g)) {
    aliases.set(m[1], m[2])
  }
  for (const [name, capability] of aliases) {
    if (new RegExp(`\\b${name}\\b`).test(condition)) found.add(capability)
  }
  return found
}

function required(page: NavPage): Set<string> {
  if (page.requires === null) return new Set()
  return new Set(Array.isArray(page.requires) ? page.requires : [page.requires])
}

const sorted = (s: Set<string>) => [...s].sort()

describe('the menu and the pages agree about who may enter', () => {
  const pages = allPages()

  it('finds a file for every page in the menu', () => {
    // If this fails the rest of the suite is checking nothing.
    const missing = pages.filter((p) => pageFile(p.key) === null).map((p) => p.key)
    expect(missing).toEqual([])
    expect(pages.length).toBeGreaterThanOrEqual(10)
  })

  for (const page of allPages()) {
    it(`${page.key} asks for what its page enforces`, () => {
      const file = pageFile(page.key)
      if (!file) return
      const source = readFileSync(file, 'utf8')
      expect(sorted(guardCapabilities(source))).toEqual(sorted(required(page)))
    })
  }
})

describe('the reader that makes the check above meaningful', () => {
  it('reads a guard written inline', () => {
    const source = `
      if (!can(role, 'report.read')) {
        return <Forbidden locale={user?.locale} />
      }`
    expect(sorted(guardCapabilities(source))).toEqual(['report.read'])
  })

  it('reads a guard with two capabilities', () => {
    const source = `
      if (!can(role, 'journal.post') && !can(role, 'report.read')) {
        return <Forbidden locale={user?.locale} />
      }`
    expect(sorted(guardCapabilities(source)))
      .toEqual(['journal.post', 'report.read'])
  })

  it('follows named booleans, as the settings hub uses', () => {
    const source = `
      const mayClose = can(role, 'period.close')
      const mayManage = can(role, 'catalog.manage')
      if (!mayClose && !mayManage) {
        return <Forbidden locale={user?.locale} />
      }`
    expect(sorted(guardCapabilities(source)))
      .toEqual(['catalog.manage', 'period.close'])
  })

  it('ignores a capability used after the guard, not in it', () => {
    // /cash computes `mayWrite` below its guard to hide the import and
    // reconcile controls. That is a control, not an entry condition, and
    // counting it would re-create the very mismatch this file exists to stop.
    const source = `
      if (!can(role, 'report.read')) {
        return <Forbidden locale={user?.locale} />
      }
      const mayWrite = can(role, 'bankImport.run')`
    expect(sorted(guardCapabilities(source))).toEqual(['report.read'])
  })

  it('reports no capabilities for a page with no Forbidden guard', () => {
    expect(sorted(guardCapabilities('export default function P() { return null }')))
      .toEqual([])
  })
})
