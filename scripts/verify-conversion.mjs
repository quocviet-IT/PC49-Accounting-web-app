// Works a bank transaction the way the accountant will: pick it, ask for a
// suggestion, save, and check the residual is surfaced rather than hidden.
import { chromium } from 'playwright'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
await page.fill('input[autocomplete="current-password"]', 'pc49-test-KT-2026')
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 20000 })

await page.goto(`${BASE}/bank-conversion`, { waitUntil: 'networkidle' })
check('the screen lists bank transactions',
  (await page.locator('[aria-current]').count()) > 0)

// CHECK # 1051 for 6,105 should resolve to a whole 44 grams of Grain.
await page.locator('button', { hasText: 'CHECK # 1051' }).first().click()
await page.getByLabel('Loại vàng', { exact: true }).first().selectOption('GRAIN')
await page.locator('button', { hasText: 'Gợi ý' }).first().click()
await page.waitForTimeout(2000)

const qty = await page.getByLabel('Số lượng', { exact: true }).first().inputValue()
check('suggests a whole quantity', qty === '44', qty)

const price = await page.getByLabel('Đơn giá', { exact: true }).first().inputValue()
check('implies the unit price that quantity needs', Number(price).toFixed(2) === '138.75', price)

const body = await page.locator('body').textContent()
check('shows the reference price alongside', (body ?? '').includes('139.20'))

await page.locator('button', { hasText: 'Lưu quy đổi' }).first().click()
await page.waitForTimeout(2500)
const err = await page.getByTestId('conv-error').count()
check('saves without an error', err === 0,
  err ? (await page.getByTestId('conv-error').textContent()) ?? '' : '')

await page.screenshot({ path: 'conversion.png', fullPage: true })
await browser.close()
console.log(failures === 0 ? '\nALL CONVERSION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
