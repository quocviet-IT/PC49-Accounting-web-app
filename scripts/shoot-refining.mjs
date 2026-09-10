// A look at the rebuilt refining screens: the lot list, a sent lot (green
// table), a received lot (green + blue + owners), and a fresh draft with the
// purchase picker. The draft it opens is removed at the end.
//
// Run with the dev server up:  node --env-file=.env.local scripts/shoot-refining.mjs
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync } from 'node:fs'
import { openPage, signIn } from './support/page.mjs'
import { passwordFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const OUT = 'ui-shots'
mkdirSync(OUT, { recursive: true })

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
const lots = await db.query(
  `SELECT id, lot_code, status::text AS status FROM pc49.refining_lot WHERE lot_code LIKE 'DEMO-%' ORDER BY lot_code`)
const byStatus = Object.fromEntries(lots.rows.map((r) => [r.status, r.id]))

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await openPage(context)
const problems = []
page.on('pageerror', (e) => problems.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })

await signIn(page, BASE, 'kt@pc49.test', passwordFor('KT'))

await page.goto(`${BASE}/refining`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/refining-list.png`, fullPage: true })

for (const [status, id] of Object.entries(byStatus)) {
  await page.goto(`${BASE}/refining/${id}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/refining-lot-${status.toLowerCase()}.png`, fullPage: true })
}

// A draft, opened the way the accountant will, then cleaned up — whatever
// happens in between, so a failed run leaves no S26.xx lying around.
let draftId = null
try {
await page.goto(`${BASE}/refining`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Mở lô mới' }).click()
await page.waitForURL(/\/refining\/[0-9a-f-]{36}$/, { timeout: 30000 })
await page.waitForLoadState('networkidle')
await page.waitForTimeout(700)
draftId = page.url().split('/').pop()
await page.screenshot({ path: `${OUT}/refining-lot-draft.png`, fullPage: true })

// Pick the first two purchases and make bags, so the green table has rows.
const boxes = page.locator('.pc-data-table').last().locator('input[type=checkbox]')
const n = await boxes.count()
if (n > 2) {
  await boxes.nth(1).click(); await boxes.nth(2).click()
  await page.getByRole('button', { name: /Đưa vào lô/ }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Đóng túi từ phiếu đã chọn' }).click()
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${OUT}/refining-lot-draft-bags.png`, fullPage: true })
  await page.getByRole('button', { name: 'Gửi đi' }).first().click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/refining-send-dialog.png` })
}

} finally {
  await browser.close()
  if (draftId) {
    await db.query(`DELETE FROM pc49.refining_lot_source WHERE lot_id = $1`, [draftId])
    await db.query(`DELETE FROM pc49.refining_lot_line WHERE lot_id = $1`, [draftId])
    await db.query(`DELETE FROM pc49.refining_lot WHERE id = $1 AND status = 'DRAFT'`, [draftId])
    // The code it took goes back, so the accountant's first real lot is S26.01.
    await db.query(`UPDATE pc49.lot_counter c SET last_no = coalesce(
      (SELECT max(substring(lot_code from '\.(\d+)$')::int) FROM pc49.refining_lot
        WHERE lot_code LIKE 'S' || (c.year % 100)::text || '.%'), 0)`)
  }
  await db.end()
}
console.log(problems.length ? `problems:\n  ${problems.join('\n  ')}` : 'no page/console errors')
console.log('wrote ui-shots/refining-*.png · draft lot removed')
