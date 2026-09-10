// A quick look at the screens that still use the older table, to check the
// shared stylesheet change did not break them.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { openPage, signIn } from './support/page.mjs'
import { passwordFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const OUT = 'ui-shots'
mkdirSync(OUT, { recursive: true })

const SCREENS = [
  ['home', '/'],
  ['refining', '/refining'],
  ['inventory', '/inventory'],
  ['journal', '/journal'],
]

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await openPage(context)
const problems = []
page.on('pageerror', (e) => problems.push(String(e)))

await signIn(page, BASE, 'kt@pc49.test', passwordFor('KT'))

for (const [name, path] of SCREENS) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/check-${name}.png`, fullPage: true })
}

await browser.close()
console.log(problems.length ? `page errors:\n  ${problems.join('\n  ')}` : 'no page errors')
console.log('wrote ui-shots/check-*.png')
