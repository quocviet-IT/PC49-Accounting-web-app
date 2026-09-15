// How long the screens really take, and whether that meets the targets.
//
//   PC49_BASE_URL=https://pc49-accounting.vercel.app npm run probe:speed
//
// Each screen is opened twice and the second visit counts, once the browser has
// its cache. "Built" is when the last byte of HTML arrived, measured from the
// request, which is the column recorded before this work in
// docs/superpowers/specs/2026-09-14-toc-do-va-loading-design.md. Targets from
// that design: every screen within 800 ms, and signing in within 4 seconds.
import { chromium } from 'playwright'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const HTML_TARGET_MS = 800
const SIGN_IN_TARGET_MS = 4000
const ROUTES = [
  '/', '/gold-transactions', '/gold-transactions?date=2026-01-08', '/prices?date=2026-01-08', '/inventory',
  '/cash?period=2026-08', '/journal?period=2026-01', '/reports', '/refining', '/import',
  '/settings/reference',
]

const browser = await chromium.launch()
const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 900 } }))
const admin = accountFor('ADMIN')
const started = Date.now()
await signIn(page, BASE, admin.email, admin.password)
const signInMs = Date.now() - started

const measured = []
for (const round of [1, 2]) {
  for (const route of ROUTES) {
    const t0 = Date.now()
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    const settled = Date.now() - t0
    const timing = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0]
      return {
        firstByte: Math.round(n.responseStart - n.requestStart),
        built: Math.round(n.responseEnd - n.requestStart),
      }
    })
    if (round === 2) measured.push({ route, ...timing, settled })
  }
}
await browser.close()

console.table(measured)
console.log(`Signing in to the home page: ${signInMs} ms (target ${SIGN_IN_TARGET_MS})`)
const slow = measured.filter((m) => m.built > HTML_TARGET_MS)
for (const m of slow) console.log(`SLOW  ${m.route}: built in ${m.built} ms (target ${HTML_TARGET_MS})`)
const ok = slow.length === 0 && signInMs <= SIGN_IN_TARGET_MS
console.log(ok ? '\nSPEED TARGETS MET' : '\nSPEED TARGETS NOT MET')
process.exitCode = ok ? 0 : 1
