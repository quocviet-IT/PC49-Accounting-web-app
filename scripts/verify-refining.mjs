// Records gold coming back from the refinery the way the supervisor will, and
// checks the lot moves on: the third stage the source spreadsheet has no column
// for, which is why nobody could prove a lot had been settled.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import pg from 'pg'
import { passwordFor } from './support/accounts.mjs'

/** Resolved before anything is launched, so a missing password is
 *  reported as a missing password rather than as a failed sign-in. */
const PASSWORD = {
  GS_US: passwordFor('GS_US'),
}

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
const PICKED_FROM = 'verify-refining seller'

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()
let lotId = null

try {
  const page = await openPage(browser)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'gsus@pc49.test')
  await page.fill('input[autocomplete="current-password"]', PASSWORD.GS_US)
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


  // ---- Assembling the lot out of the purchases going into it ---------------
  //
  // The checkbox column of sheet `1.Scrap Gold`. Until this existed the lines
  // of a lot had to be retyped from the purchases they came from, which is
  // both slower than the spreadsheet and a second place for the figures to
  // disagree with each other.
  await db.query(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, partner_code,
        scrap_detail, gold_pct)
     VALUES ($1, 'PO', 'SG', 'GRAM', 20, 50, -1000, $2, '14k/grs', 0.583),
            ($1, 'PO', 'SG', 'GRAM', 10, 90, -900,  $2, '23-24k/grs', 0.9893)`,
    [SENT, PICKED_FROM])

  await page.reload({ waitUntil: 'networkidle' })
  const offered = page.getByLabel(new RegExp(`Chọn .*${PICKED_FROM}`))
  check('the scrap bought is offered to the lot, not retyped into it',
    (await offered.count()) === 2, `${await offered.count()} offered`)

  await offered.first().check()
  await offered.last().check()
  await page.locator('button', { hasText: 'Đưa vào đợt' }).first().click()
  await page.waitForTimeout(3000)

  const linked = await db.query(
    `SELECT count(*)::int AS n FROM pc49.refining_lot_source WHERE lot_id = $1`, [lotId])
  check('ticking them puts them in the lot', linked.rows[0].n === 2, `${linked.rows[0].n} picked`)

  // The four figures the spreadsheet's batch tab computes, in the two bands
  // the scrap is actually sent in.
  const bands = await db.query(
    `SELECT grade_band AS b, gross_weight_gram::float8 AS gross,
            round(pure_weight_gram, 4)::float8 AS pure, total_cost::float8 AS cost
       FROM pc49.v_refining_lot_source_summary WHERE lot_id = $1 ORDER BY grade_band`, [lotId])
  const low = bands.rows.find((r) => r.b === '10-18k/grs')
  const high = bands.rows.find((r) => r.b === '19-24k/grs')
  check('and totals them in the two bands the scrap is sent in',
    bands.rows.length === 2
      && low?.gross === 20 && low?.pure === 11.66 && low?.cost === 1000
      && high?.gross === 10 && high?.pure === 9.893 && high?.cost === 900,
    bands.rows.map((r) => `${r.b} ${r.gross}g/${r.pure}g24k/$${r.cost}`).join('  '))

  const stillOffered = await db.query(
    `SELECT count(*)::int AS n FROM pc49.v_refining_available_purchase WHERE partner_code = $1`,
    [PICKED_FROM])
  check('and takes them off the list of what can still be sent',
    stillOffered.rows[0].n === 0, `${stillOffered.rows[0].n} left`)

  // The last step of the batch tab: the totals stop being a calculation and
  // become the rows that leave the vault, one per band. Without this the
  // figures were worked out and then retyped, which is the retyping the
  // picking was meant to remove.
  await page.locator('button', { hasText: 'Chốt đợt thành dòng gửi đi' }).first().click()
  await page.waitForTimeout(3000)

  const made2 = await db.query(
    `SELECT source_desc AS d, gross_weight_gram::float8 AS g, gold_pct::float8 AS p
       FROM pc49.refining_lot_line WHERE lot_id = $1 ORDER BY source_desc`, [lotId])
  check('the picked bands become the lines that are sent',
    made2.rows.length === 2
      && made2.rows[0].d === '10-18k/grs' && made2.rows[0].g === 20 && made2.rows[0].p === 0.583
      && made2.rows[1].d === '19-24k/grs' && made2.rows[1].g === 10 && made2.rows[1].p === 0.9893,
    made2.rows.map((r) => `${r.d} ${r.g}g @${r.p}`).join('  '))

  // Cleared again so the pooled-owner part below starts from the lines it
  // expects rather than from these.
  await db.query(`DELETE FROM pc49.refining_lot_line WHERE lot_id = $1`, [lotId])
  await db.query(`DELETE FROM pc49.refining_lot_source WHERE lot_id = $1`, [lotId])

  // Two owners on one shipment: PC49's metal and a partner's travel together.
  await db.query(
    // pure_weight_gram is generated from the gross weight and the purity.
    `INSERT INTO pc49.refining_lot_line
       (lot_id, seq, owner_code, gold_type_code, gross_weight_gram, gold_pct,
        assay_weight_gram)
     VALUES ($1, 1, 'PC49', 'SG', 600, 0.75, 600),
            ($1, 2, 'MH',   'SG', 400, 0.75, 400)`, [lotId])
  // What the refinery says it is, which is the whole point of an assay and is
  // what the settle price is worked out from.
  await db.query(
    `UPDATE pc49.refining_lot_line SET assay_pct = 0.74 WHERE lot_id = $1`, [lotId])

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

  // Sheet 3.3 read left to right: what the refinery weighed, what that settles
  // at, and the three things the assay changed. Computed since 0051 and shown
  // here, or the figure the lot is actually priced at lives nowhere anybody
  // can see it.
  const lineValues = await db.query(
    `SELECT round(assay_pure_weight_gram, 4)::float8 AS p,
            round(assay_value, 2)::float8 AS t,
            round(purity_variance, 4)::float8 AS w
       FROM pc49.v_refining_lot_line_value WHERE lot_id = $1 AND owner_code = 'PC49'`, [lotId])
  // 600 g came back weighed at 74%, so 444 g of it is 24k — not the 600 that
  // went, which is the entire reason the sheet has an assay column.
  check('the lot says what it settles at, not only what it was estimated at',
    lineValues.rows[0]?.p === 444 && lineValues.rows[0]?.t > 0,
    `24k ${lineValues.rows[0]?.p}g settles at ${lineValues.rows[0]?.t}`)
  check('and the screen shows it',
    ((await page.locator('body').textContent()) ?? '').includes('Giá chốt'))

  // Record what came back for PC49, leaving the partner still owed.
  // Last, not first: the lines table above says PC49 too, and the owner table
  // is below it. Filtering on the button instead would have stopped matching
  // the moment it was clicked and became a form.
  const row = page.locator('tr').filter({ hasText: 'PC49' }).last()
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

  // Closing while a partner has been settled with in neither way is what turns
  // "closed" into a claim somebody can check. The refusal no longer says "owes
  // metal": since 0050 an owner may take the money instead, and a lot whose
  // partner did was the one thing that could never be closed at all.
  let owing = false
  try {
    await db.query(`UPDATE pc49.refining_lot SET status = 'CLOSED' WHERE id = $1`, [lotId])
  } catch (e) { owing = /has not settled with MH/.test(String(e.message)) }
  check('a lot will not close while a partner is settled with neither way', owing)

  // And it closes once they take the money, which is column S of the source
  // sheet: `Lấy tiền / Lấy vàng`.
  await db.query(
    `INSERT INTO pc49.refining_receipt
       (lot_id, receive_date, gold_type_code, owner_code, settle_kind, amount_usd)
     VALUES ($1, '2019-04-20', 'GRAIN', 'MH', 'CASH', 64000)`, [lotId])
  let closed = false
  try {
    await db.query(`UPDATE pc49.refining_lot SET status = 'CLOSED' WHERE id = $1`, [lotId])
    const r = await db.query(
      `SELECT status::text AS s FROM pc49.refining_lot WHERE id = $1`, [lotId])
    closed = r.rows[0].s === 'CLOSED'
  } catch (e) { closed = String(e.message) }
  check('and closes once the partner takes the money instead', closed === true,
    closed === true ? '' : String(closed))
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  const bought = await db.query(
    `SELECT id FROM pc49.gold_txn WHERE partner_code = $1`, [PICKED_FROM])
  for (const t of bought.rows) {
    await db.query(`DELETE FROM pc49.refining_lot_source WHERE txn_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.inventory_movement WHERE source_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn WHERE id = $1`, [t.id])
  }
  await db.query(`DELETE FROM pc49.partner WHERE code = $1`, [PICKED_FROM])
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
