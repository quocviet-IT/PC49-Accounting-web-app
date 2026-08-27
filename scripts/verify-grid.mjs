// Drives the transaction grid the way the accountant will: sign in, type a row,
// press Enter, and check it saved and the running totals moved.
// Run with the dev server up: npm run verify:grid
import { chromium } from 'playwright'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const DAY = process.env.PC49_GRID_DAY ?? '2026-03-16'   // a clean day per run

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
await page.fill('input[autocomplete="current-password"]', 'pc49-test-KT-2026')
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 20000 })

await page.goto(`${BASE}/gold-transactions?date=${DAY}`, { waitUntil: 'networkidle' })
check('the grid opens for a chosen day', page.url().includes(DAY))

const before = await page.getByTestId('total-purchases').textContent()

// A scrap gold purchase, typed exactly as the accountant would.
await page.getByLabel('Loại', { exact: true }).first().selectOption('PO')
await page.getByLabel('Sales', { exact: true }).first().fill('L.Thanh')
await page.getByLabel('Khách / NCC', { exact: true }).first().fill('HPAREZ')
await page.getByLabel('Loại vàng', { exact: true }).first().selectOption('SG')
await page.getByLabel('Tuổi vàng', { exact: true }).first().fill('14k/grs')
await page.getByLabel('Số lượng', { exact: true }).first().fill('4.5')
await page.getByLabel('Đơn giá', { exact: true }).first().fill('55.55555556')

const amount = await page.locator('tbody tr').first().locator('td').nth(8).textContent()
// A purchase is a negative amount by the source convention: gold in, money out.
check('amount is calculated, negative for a purchase', amount?.trim() === '-250.00', amount ?? '')

const grams = await page.locator('tbody tr').first().locator('td').nth(6).textContent()
check('the gram equivalent shows next to the quantity', (grams ?? '').includes('4.50 g'), grams ?? '')

await page.getByLabel('Thanh toán 1', { exact: true }).first().fill('250')
await page.getByLabel('Ghi chú', { exact: true }).first().fill('Mua vao 4.5gr vang 14k')
await page.getByLabel('Ghi chú', { exact: true }).first().press('Enter')

await page.waitForTimeout(2500)

const error = await page.locator('[class*="rowError"]').count()
check('the row saved without an error', error === 0,
  error ? await page.locator('[class*="rowError"]').first().textContent() ?? '' : '')

const after = await page.getByTestId('total-purchases').textContent()
check('the running purchase total moved by exactly one row', Number(after?.replace(/,/g, '')) - Number(before?.replace(/,/g, '')) === 250,
  `${before} -> ${after}`)

const movement = await page.getByTestId('total-movement').textContent()
check('gold movement counts the row once, not twice',
  (movement ?? '').includes('SG +4.50 g'), movement ?? '')

// A row that breaks a seeded flow rule must be refused, with the reason shown.
await page.click('text=Thêm dòng')
const rows = page.locator('tbody tr')
const last = rows.last()
await last.getByLabel('Loại', { exact: true }).selectOption('DEPOSIT')
await last.getByLabel('Loại vàng', { exact: true }).selectOption('SG')
await last.getByLabel('Số lượng', { exact: true }).fill('-10')
await last.getByLabel('Đơn giá', { exact: true }).fill('50')
await last.getByLabel('Ghi chú', { exact: true }).fill('should be refused')
await last.getByLabel('Ghi chú', { exact: true }).press('Enter')
await page.waitForTimeout(2500)

const refusal = await page.locator('[class*="rowError"]').first().textContent()
check('a movement the Link sheet forbids is refused', (refusal ?? '').length > 0, refusal ?? '')

await page.screenshot({ path: 'grid.png', fullPage: true })
console.log('\nscreenshot written to grid.png')

await browser.close()
console.log(failures === 0 ? '\nALL GRID CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
