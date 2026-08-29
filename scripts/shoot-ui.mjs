// Takes a picture of every screen, in both themes and at phone width, so the
// design can be looked at rather than reasoned about.
//
// This has earned its place. Screenshots have caught things no test here has:
// an input cell with no visible edge, a table with no frame around it, a zero
// printed in the colour for money going out, a menu that overflowed and buried
// a whole screen, two panels that became one in dark mode, and prose cut off
// with an ellipsis in the one column meant to hold prose.
//
// Writes into ui-shots/. Run with the dev server up: npm run shots
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync, readdirSync } from 'node:fs'
import { openPage, signIn } from './support/page.mjs'
import { passwordFor } from './support/accounts.mjs'

/** Resolved before anything is launched, so a missing password is
 *  reported as a missing password rather than as a failed sign-in. */
const PASSWORD = {
  ADMIN: passwordFor('ADMIN'),
}

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const OUT = 'ui-shots'
mkdirSync(OUT, { recursive: true })

// The busiest day of the demo fortnight, and the month it sits in.
const DAY = '2026-08-26'
const PERIOD = '2026-08'

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

// The pictures are of the demo fortnight, put there by `npm run demo`. This
// used to seed a day of its own, which meant two sets of assumptions about how
// a transaction is written — and the copy here was already wrong, entering
// 9999 in grams when it trades in luong.
const present = await db.query(
  `SELECT count(*)::int n FROM pc49.gold_txn WHERE doc_no LIKE 'DEMO-%'`)
await db.end()
if (present.rows[0].n === 0) {
  console.error('No demo data to photograph. Run "npm run demo" first.')
  process.exit(1)
}
console.log(`photographing ${present.rows[0].n} demo transactions`)

const PAGES = [
  ['dashboard', '/'],
  ['gold-transactions', `/gold-transactions?date=${DAY}`],
  ['prices', `/prices?date=${DAY}`],
  ['refining', '/refining'],
  ['inventory', '/inventory'],
  ['cash', '/cash'],
  ['bank-conversion', '/bank-conversion'],
  ['journal', `/journal?period=${PERIOD}`],
  ['reports', `/reports?period=${PERIOD}`],
  ['feedback', '/feedback'],
  ['import', '/import'],
  ['settings', '/settings'],
  ['settings-periods', '/settings/periods'],
  ['settings-reference', '/settings/reference'],
]

/** Desktop and a phone, because the shell behaves differently on each. */
const VIEWPORTS = [
  ['', { width: 1440, height: 900 }],
  ['phone-', { width: 390, height: 844 }],
]

const browser = await chromium.launch()

for (const theme of ['light', 'dark']) {
  for (const [prefix, viewport] of VIEWPORTS) {
    // The phone only needs one theme; the point there is layout, not colour.
    if (prefix && theme === 'dark') continue

    const ctx = await browser.newContext({
      viewport,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
    })
    const page = await openPage(ctx)

    // The sign-in screen is a screen too, and it is the only one anybody sees
    // before they have an account working.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${OUT}/${prefix}${theme}-login.png` })

    await signIn(page, BASE, 'admin@pc49.test', PASSWORD.ADMIN)

    for (const [name, path] of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
      // Wait for the page to have drawn its own content rather than for a
      // fixed number of milliseconds, which is either wasted or not enough.
      await page.locator('main, [role="main"], #main').first()
        .waitFor({ state: 'visible' }).catch(() => {})
      await page.screenshot({ path: `${OUT}/${prefix}${theme}-${name}.png`, fullPage: true })
      console.log(`${prefix}${theme}/${name}`)
    }

    // And the thing people reach for when a screen is wrong, open.
    await page.goto(`${BASE}/prices?date=${DAY}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Báo lỗi / góp ý' }).click()
    await page.locator('.ant-modal-body').waitFor({ state: 'visible' })
    await page.screenshot({ path: `${OUT}/${prefix}${theme}-report-dialog.png` })
    console.log(`${prefix}${theme}/report-dialog`)

    await ctx.close()
  }
}

await browser.close()
console.log(`\n${readdirSync(OUT).length} pictures in ${OUT}/`)
