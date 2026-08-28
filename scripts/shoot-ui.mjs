// Takes a picture of each screen in both themes, so the design can be looked at
// rather than reasoned about. Writes into ui-shots/. Run with the dev server up.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const OUT = 'ui-shots'
mkdirSync(OUT, { recursive: true })

const PAGES = [
  ['dashboard', '/'],
  ['prices', '/prices?date=2026-01-15'],
  ['gold-transactions', '/gold-transactions?date=2026-01-15'],
  ['reports', '/reports?period=2026-01'],
  ['settings', '/settings'],
  ['periods', '/settings/periods'],
  ['reference', '/settings/reference'],
  ['import', '/import'],
  ['cash', '/cash'],
]

const browser = await chromium.launch()

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  })
  const page = await ctx.newPage()

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'admin@pc49.test')
  await page.fill('input[autocomplete="current-password"]', 'pc49-test-ADMIN-2026')
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 20000 })

  for (const [name, path] of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png`, fullPage: false })
    console.log(`${theme}/${name}`)
  }
  await ctx.close()
}

await browser.close()
console.log(`\nwritten to ${OUT}/`)
