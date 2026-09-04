// Drives the transaction grid the way the accountant will: sign in, type a row,
// press Enter, and check it saved and the running totals moved.
// Run with the dev server up: npm run verify:grid
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
const DAY = process.env.PC49_GRID_DAY ?? '2026-03-16'   // a clean day per run

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await openPage(ctx)

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
await page.fill('input[autocomplete="current-password"]', PASSWORD.KT)
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 60000 })

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

const amount = await page.locator('tbody tr').first().locator('td').nth(9).textContent()
// A purchase is a negative amount by the source convention: gold in, money out.
check('amount is calculated, negative for a purchase', amount?.trim() === '-250.00', amount ?? '')

const grams = await page.locator('tbody tr').first().locator('td').nth(7).textContent()
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

// ---- Getting back to a day you have already entered -------------------------
//
// Reported as "da nhap 2 giao dich vao ngay 31 nhung bi mat khong tim lai
// duoc". Nothing was lost. The grid always opened on today and loaded only
// today's rows, and there was no control that changed the day — so a day
// entered under any other date had no way back to it, and the totals at the
// foot of the screen read zero because they count the rows on the day shown.
const NEXT_DAY = '2026-03-17'
const dateField = page.getByLabel('Ngày', { exact: true })
check('the grid says which day it is showing', (await dateField.inputValue()) === DAY)

await dateField.fill(NEXT_DAY)
await page.waitForURL(`**/gold-transactions?date=${NEXT_DAY}`, { timeout: 30000 })
await page.waitForLoadState('networkidle')
const elsewhere = await page.getByTestId('total-purchases').textContent()
check('another day is a different set of books', elsewhere?.trim() === '0.00', elsewhere ?? '')

await page.getByLabel('Ngày', { exact: true }).fill(DAY)
await page.waitForURL(`**/gold-transactions?date=${DAY}`, { timeout: 30000 })
await page.waitForLoadState('networkidle')
const returned = await page.getByTestId('total-purchases').textContent()
check('and the day you entered is still there when you go back',
  returned?.trim() === '250.00', returned ?? '')
check('with the row on it, not just the total',
  (await page.locator('tbody tr').filter({ hasText: 'HPAREZ' }).count()) === 1)

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

// ---- Two people on one order ------------------------------------------------
//
// Reported as "1 don hang he thong chi dang ghi nhan duoc 1 nhan vien". The
// column holds one name, so whoever else worked the sale appeared in no figure
// taken from these rows. The percent stays hidden while one person has the
// order and comes out the moment a second name does, because from then on only
// the person typing knows how it divides.
await page.click('text=Thêm dòng')
const split = page.locator('tbody tr').last()

await split.getByLabel('Loại', { exact: true }).selectOption('PO')
await split.getByLabel('Loại vàng', { exact: true }).selectOption('SG')
await split.getByLabel('Khách / NCC', { exact: true }).fill('SPLITCO')

check('one person on an order is not asked for a percentage',
  (await split.getByLabel('Tỷ lệ 1', { exact: true }).count()) === 0)

await split.getByLabel('Sales', { exact: true }).fill('L.Thanh')
await split.getByLabel('Sales 2', { exact: true }).fill('P.Minh')
check('a second name brings out the shares',
  (await split.getByLabel('Tỷ lệ 1', { exact: true }).count()) === 1)

await split.getByLabel('Tỷ lệ 1', { exact: true }).fill('60')
await split.getByLabel('Tỷ lệ 2', { exact: true }).fill('30')
await split.getByLabel('Số lượng', { exact: true }).fill('2')
await split.getByLabel('Đơn giá', { exact: true }).fill('50')
await split.getByLabel('Ghi chú', { exact: true }).press('Enter')
await page.waitForTimeout(1500)

const short = await split.locator('[class*="rowError"]').first().textContent()
check('shares that do not come to a hundred are refused, on the row',
  (short ?? '').includes('100'), (short ?? '').trim())

await split.getByLabel('Tỷ lệ 2', { exact: true }).fill('40')
await split.getByLabel('Thanh toán 1', { exact: true }).fill('100')
await split.getByLabel('Ghi chú', { exact: true }).press('Enter')
await page.waitForTimeout(2500)

await page.screenshot({ path: 'grid.png', fullPage: true })
console.log('\nscreenshot written to grid.png')

await browser.close()

// The client's database is not a scratch pad. Two runs in a row used to leave
// two purchases behind and the second run then failed on its own leftovers.
// The posting guard forces an unpost before anything can be removed, which is
// the same road it forces on everyone else.
const dbUrl = process.env.SUPABASE_DB_URL
if (dbUrl) {
  const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await db.connect()

  // What the split row actually recorded, read before the cleanup takes it.
  const shared = await db.query(
    `SELECT s.sales_person_code AS code, s.share_pct::float8 AS pct, t.sales_person_code AS lead
       FROM pc49.gold_txn_sales_person s
       JOIN pc49.gold_txn t ON t.id = s.txn_id
      WHERE t.txn_date = $1 AND t.partner_code = 'SPLITCO'
      ORDER BY s.share_pct DESC`, [DAY])
  check('the order is credited to both people, in the shares typed',
    shared.rows.length === 2
      && shared.rows[0].code === 'L.Thanh' && shared.rows[0].pct === 60
      && shared.rows[1].code === 'P.Minh' && shared.rows[1].pct === 40,
    shared.rows.map((r) => `${r.code} ${r.pct}%`).join(' + ') || '(nothing)')
  // The single column a report or an import still reads holds the leading name
  // rather than whichever row happened to be written first.
  check('and the row still names one of them for whoever reads one name',
    shared.rows[0]?.lead === 'L.Thanh', shared.rows[0]?.lead ?? '(none)')

  const made = await db.query(
    'SELECT id, journal_entry_id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  for (const row of made.rows) {
    if (row.journal_entry_id) {
      await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE id = $1',
        [row.journal_entry_id])
      await db.query('DELETE FROM pc49.journal_line WHERE entry_id = $1', [row.journal_entry_id])
      await db.query('DELETE FROM pc49.audit_log WHERE entity_id = $1::text',
        [row.journal_entry_id])
    }
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [row.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [row.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [row.id])
    if (row.journal_entry_id) {
      await db.query('DELETE FROM pc49.journal_entry WHERE id = $1', [row.journal_entry_id])
    }
  }
  const left = await db.query(
    'SELECT count(*)::int AS n FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  check('the check cleaned up after itself', left.rows[0].n === 0,
    `${left.rows[0].n} transaction(s) left`)
  await db.end()
} else {
  console.log('NOTE  SUPABASE_DB_URL is not set, so the typed rows were left in the database')
}

console.log(failures === 0 ? '\nALL GRID CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
