// Records gold coming back from the refinery the way the supervisor will, and
// checks the lot moves on: the third stage the source spreadsheet has no column
// for, which is why nobody could prove a lot had been settled.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import pg from 'pg'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)}${detail}`)
}

// A lot code and dates far enough from anything real to be unmistakable.
const LOT = 'VERIFY.01'
const SENT = '2019-04-02'
const ASSAYED = '2019-04-09'

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()
let lotId = null

try {
  const page = await openPage(browser)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'gsus@pc49.test')
  await page.fill('input[autocomplete="current-password"]', 'pc49-test-GSUS-2026')
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 60000 })

  await page.goto(`${BASE}/refining`, { waitUntil: 'networkidle' })

  // Open the lot from the screen. Until this existed, no lot could be started
  // at all and the rest of the module had nothing to act on.
  await page.locator('button', { hasText: 'Mở lô mới' }).first().click()
  await page.getByLabel('Mã lô', { exact: true }).fill(LOT)
  await page.getByLabel('Nhà máy', { exact: true }).fill('Verify Refinery')
  await page.locator('button', { hasText: 'Lưu' }).first().click()
  await page.waitForTimeout(2500)

  const made = await db.query(
    `SELECT id, status::text AS s FROM pc49.refining_lot WHERE lot_code = $1`, [LOT])
  check('a lot can be opened from the screen', made.rows[0]?.s === 'DRAFT',
    made.rows[0]?.s ?? '(no lot)')
  lotId = made.rows[0]?.id

  // Two owners on one shipment: PC49's metal and a partner's travel together.
  await db.query(
    // pure_weight_gram is generated from the gross weight and the purity.
    `INSERT INTO pc49.refining_lot_line
       (lot_id, seq, owner_code, gold_type_code, gross_weight_gram, gold_pct,
        assay_weight_gram)
     VALUES ($1, 1, 'PC49', 'SG', 600, 0.75, 600),
            ($1, 2, 'MH',   'SG', 400, 0.75, 400)`, [lotId])

  // Send it, then record the assay — one stage at a time, which the database
  // enforces and the screen only offers.
  await db.query(
    `UPDATE pc49.refining_lot
        SET status = 'SENT', sent_date = $2, spot_gold_per_oz_sent = 4800
      WHERE id = $1`, [lotId, SENT])
  await db.query(
    `UPDATE pc49.refining_lot
        SET status = 'ASSAYED', assay_date = $2, spot_gold_per_oz_assay = 4890
      WHERE id = $1`, [lotId, ASSAYED])

  await page.reload({ waitUntil: 'networkidle' })
  const body = (await page.locator('body').textContent()) ?? ''
  check('the lot is listed with its owners', body.includes(LOT) && body.includes('MH'))
  check('and says what each owner is still owed',
    body.includes('600.00') && body.includes('400.00'))

  // Record what came back for PC49, leaving the partner still owed.
  const row = page.locator('tr', { hasText: 'PC49' }).filter({ hasText: '600.00' }).first()
  await row.locator('button', { hasText: 'Ghi nhận về' }).click()
  await page.waitForTimeout(400)
  const qty = row.getByLabel('Ghi nhận về PC49', { exact: true })
  check('the quantity is offered pre-filled with what is owed',
    (await qty.inputValue()) === '600', await qty.inputValue())

  await row.locator('input[type="date"]').fill('2019-04-20')
  await qty.fill('600')
  await row.locator('button', { hasText: 'Lưu' }).click()
  await page.waitForTimeout(3000)

  const receipts = await db.query(
    `SELECT owner_code AS o, qty_gram::text AS g, gold_type_code AS t, receive_date::text AS d
       FROM pc49.refining_receipt WHERE lot_id = $1`, [lotId])
  check('the receipt is recorded against the right owner',
    receipts.rows.length === 1 && receipts.rows[0].o === 'PC49'
      && Number(receipts.rows[0].g) === 600 && receipts.rows[0].t === 'GRAIN',
    `${receipts.rows[0]?.o} ${receipts.rows[0]?.g}g ${receipts.rows[0]?.t}`)

  const moved = await db.query(
    `SELECT status::text AS s, received_date::text AS d FROM pc49.refining_lot WHERE id = $1`,
    [lotId])
  check('the first receipt moves the lot to RECEIVED',
    moved.rows[0].s === 'RECEIVED' && moved.rows[0].d === '2019-04-20',
    `${moved.rows[0].s} on ${moved.rows[0].d}`)

  await page.reload({ waitUntil: 'networkidle' })
  const after = (await page.locator('body').textContent()) ?? ''
  check('the partner is still shown as owed', after.includes('400.00'))

  // The rule belongs to the database, not the screen.
  let refused = false
  try {
    await db.query(`SELECT pc49.receive_refining($1, '2019-04-20', 'NOBODY', 10)`, [lotId])
  } catch (e) { refused = /has no line belonging to/.test(String(e.message)) }
  check('a receipt for somebody with no line on the lot is refused', refused)

  let tooEarly = false
  try {
    const draft = await db.query(
      `INSERT INTO pc49.refining_lot (lot_code, status, sent_date)
       VALUES ($1, 'SENT', $2) RETURNING id`, [`${LOT}.B`, SENT])
    await db.query(`SELECT pc49.receive_refining($1, '2019-04-20', 'PC49', 10)`,
      [draft.rows[0].id])
  } catch (e) { tooEarly = /has not been assayed/.test(String(e.message)) }
  check('a receipt before the assay is refused', tooEarly)

  let skipped = false
  try {
    const draft2 = await db.query(
      `INSERT INTO pc49.refining_lot (lot_code, status) VALUES ($1, 'DRAFT') RETURNING id`,
      [`${LOT}.C`])
    await db.query(`UPDATE pc49.refining_lot SET status = 'ASSAYED' WHERE id = $1`,
      [draft2.rows[0].id])
  } catch (e) { skipped = /one stage at a time/.test(String(e.message)) }
  check('a lot cannot skip a stage', skipped)

  // Closing while a partner is still owed metal is what turns "closed" into a
  // claim somebody can check.
  let owing = false
  try {
    await db.query(`UPDATE pc49.refining_lot SET status = 'CLOSED' WHERE id = $1`, [lotId])
  } catch (e) { owing = /still owes metal to MH/.test(String(e.message)) }
  check('a lot will not close while a partner is still owed', owing)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await db.query(`DELETE FROM pc49.refining_receipt WHERE lot_id IN (
                    SELECT id FROM pc49.refining_lot WHERE lot_code LIKE $1)`, [`${LOT}%`])
  await db.query(`DELETE FROM pc49.refining_lot_line WHERE lot_id IN (
                    SELECT id FROM pc49.refining_lot WHERE lot_code LIKE $1)`, [`${LOT}%`])
  await db.query(`DELETE FROM pc49.refining_lot WHERE lot_code LIKE $1`, [`${LOT}%`])

  const left = await db.query(
    `SELECT count(*)::int AS n FROM pc49.refining_lot WHERE lot_code LIKE $1`, [`${LOT}%`])
  check('the check cleaned up after itself', left.rows[0].n === 0,
    `${left.rows[0].n} lots left`)
  await db.end()
}

console.log(failures === 0 ? '\nALL REFINING CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
