// Works a bank transaction the way the accountant will: pick it, ask for a
// suggestion, save, and check the residual is surfaced rather than hidden.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import pg from 'pg'
import { passwordFor } from './support/accounts.mjs'

/** Resolved before anything is launched, so a missing password is
 *  reported as a missing password rather than as a failed sign-in. */
const PASSWORD = {
  KT: passwordFor('KT'),
}

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}`)
}

// The transaction this check works was demo data that has since been cleared out
// of the client's database, so the check now brings its own and takes it away
// again. A check that depends on data somebody else left behind stops being a
// check the first time that data is tidied up.
const url = process.env.SUPABASE_DB_URL
if (!url) { console.error('Missing environment variable: SUPABASE_DB_URL'); process.exit(1) }
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

const TXN_DATE = '2026-01-16'
await db.query(
  `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price, source)
   VALUES ($1, 'GRAIN', 139.20, 'verify-conversion')
   ON CONFLICT (price_date, gold_type_code) DO UPDATE
     SET market_price = excluded.market_price, source = excluded.source`, [TXN_DATE])
const seeded = await db.query(
  `INSERT INTO pc49.cash_txn
     (txn_date, cash_account_code, direction, amount, description, source)
   VALUES ($1, '1121-3388', 'OUT', 6105, 'CHECK # 1051', 'MANUAL') RETURNING id`, [TXN_DATE])
const txnId = seeded.rows[0].id

const browser = await chromium.launch()
const page = await openPage(browser)
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
await page.fill('input[autocomplete="current-password"]', PASSWORD.KT)
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 60000 })

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

// The client's database is not a scratch pad.
await db.query('DELETE FROM pc49.bank_gold_allocation WHERE cash_txn_id = $1', [txnId])
await db.query('DELETE FROM pc49.cash_txn WHERE id = $1', [txnId])
await db.query(
  `DELETE FROM pc49.gold_price_daily WHERE price_date = $1 AND source = 'verify-conversion'`,
  [TXN_DATE])
const rest = await db.query(
  `SELECT (SELECT count(*) FROM pc49.cash_txn WHERE description = 'CHECK # 1051') AS txns,
          (SELECT count(*) FROM pc49.bank_gold_allocation) AS lines`)
check('the check cleaned up after itself',
  Number(rest.rows[0].txns) === 0 && Number(rest.rows[0].lines) === 0,
  `${rest.rows[0].txns} transactions, ${rest.rows[0].lines} allocation lines left`)
await db.end()
console.log(failures === 0 ? '\nALL CONVERSION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
