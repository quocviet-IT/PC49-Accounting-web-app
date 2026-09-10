// A look at the rebuilt gold-transactions screen: the day's list, and the
// entry form open over it, in both themes.
//
// Run with the dev server up:  node --env-file=.env.local scripts/shoot-txn-form.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { openPage, signIn } from './support/page.mjs'
import { passwordFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const OUT = 'ui-shots'
const DAY = '2026-08-26'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await openPage(context)

await signIn(page, BASE, 'kt@pc49.test', passwordFor('KT'))

const problems = []
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
page.on('pageerror', (e) => problems.push(String(e)))

for (const theme of ['light', 'dark']) {
  await page.emulateMedia({ colorScheme: theme })
  await page.goto(`${BASE}/gold-transactions?date=${DAY}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/txn-list-${theme}.png`, fullPage: true })

  // The whole point of the change: entry opens a form.
  await page.getByRole('button', { name: 'Thêm giao dịch' }).click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/txn-form-${theme}.png` })

  // And it holds a real transaction without the fields being the width of a
  // spreadsheet column.
  if (theme === 'light') {
    await page.locator('.ant-modal').getByRole('combobox').first().click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${OUT}/txn-form-type-open.png` })
    await page.keyboard.press('Escape')
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}

// Narrow, because a form that only works on a laptop is half a form.
await page.emulateMedia({ colorScheme: 'light' })
await page.setViewportSize({ width: 420, height: 900 })
await page.goto(`${BASE}/gold-transactions?date=${DAY}`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Thêm giao dịch' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/txn-form-phone.png`, fullPage: true })

await browser.close()
console.log(problems.length ? `console errors:\n  ${problems.join('\n  ')}` : 'no console errors')
console.log('wrote ui-shots/txn-list-*.png, txn-form-*.png')
