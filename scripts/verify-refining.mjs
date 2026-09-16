// A lot of scrap, from the purchases it is made of to the day it closes.
//
// The third stage the source spreadsheet has no column for, which is why
// nobody could prove a lot had been settled: gold goes to the refinery, the
// refinery says what it really was, and each owner is either given metal back
// or paid for theirs. This drives that whole cycle through the screen the
// supervisor uses, and reads the books afterwards to see it happened.
//
//   npm run verify:refining      (dev server up)
//
// Rewritten on 2026-09-16 for the lot page as it is now (2026-09-10, a3f76ac).
// The check before this one clicked "Mở lô mới", "Đưa vào đợt" and "Chốt đợt
// thành dòng gửi đi" on the list page, and typed a lot code by hand. None of
// those exist any more: a lot is opened with one click and numbered by the
// database, and the work happens on the lot's own page, one stage at a time.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { until, untilRow, untilRowIs } from './support/until.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Dates far enough from anything real to be unmistakable, and a seller who
// exists only here.
const BOUGHT = '2019-04-01'
const SENT = '2019-04-02'
const ASSAYED = '2019-04-09'
const RECEIVED = '2019-04-20'
const SELLER = 'verify-refining seller'
const PARTNER_OWNER = 'MH'

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)}${detail}`)
}

/**
 * What the screen is complaining about, if anything.
 *
 * A refused save leaves the dialog open with the reason in it, and a check
 * that only says the row never appeared sends whoever runs it looking in the
 * wrong place.
 */
async function complaint(page) {
  const alerts = page.locator('.ant-alert-message, .ant-alert-description, .ant-form-item-explain-error')
  const said = []
  for (let i = 0; i < await alerts.count(); i += 1) {
    const text = ((await alerts.nth(i).textContent()) ?? '').trim()
    if (text) said.push(text)
  }
  // A form that refused to submit says nothing at all and stays open, which is
  // itself the answer: the click landed, the save did not.
  if (await page.getByRole('dialog').count() > 0) said.push('the form is still open')
  return said.join(' | ').slice(0, 160) || 'the screen said nothing'
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Every lot this run opens, so the clean-up knows what to take away again. */
const lots = []

/**
 * Presses a button until the thing it was for has happened.
 *
 * A button whose behaviour is an onClick handler does nothing until React has
 * hydrated, and a click that lands in that window is silently lost. The click
 * is repeated until `done` — a database read, usually — says it worked.
 */
async function press(locator, done, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    try { await locator.click({ timeout: 5000 }) } catch { /* gone, or not ready */ }
    const answer = await until(done, { timeout: 2500, every: 250 })
    if (answer) return answer
    if (Date.now() >= deadline) return null
  }
}

/** Removes every row this check wrote: its lots, their transfers, its purchases. */
async function cleanUp() {
  const entries = []
  async function dropTransactions(where, params) {
    const rows = await db.query(
      `SELECT id, journal_entry_id AS e FROM pc49.gold_txn WHERE ${where}`, params)
    for (const t of rows.rows) {
      if (t.e) entries.push(t.e)
      await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
      await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
      await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
      await db.query('DELETE FROM pc49.refining_lot_source WHERE txn_id = $1', [t.id])
      await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
    }
  }

  for (const lotId of lots) {
    // In this order for a reason. The receipts point at the transactions that
    // brought the metal back, so they go first. The bags are not deleted at
    // all: a bag may not leave a lot that has been sent (0061), and deleting
    // the lot takes them with it, which is a lot being swept away rather than
    // a bag walking out of one.
    await db.query('DELETE FROM pc49.refining_receipt WHERE lot_id = $1', [lotId])
    await db.query('DELETE FROM pc49.refining_lot_source WHERE lot_id = $1', [lotId])
    await dropTransactions('refining_lot_id = $1', [lotId])
    await db.query('DELETE FROM pc49.refining_lot WHERE id = $1', [lotId])
  }
  await dropTransactions('partner_code = $1', [SELLER])

  // A posted entry is not deletable while it is posted, which is the point of
  // posting. Production never deletes one at all — this exists because a check
  // that leaves the client's books full of its own practice rows is worse than
  // no check.
  if (entries.length > 0) {
    await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE id = ANY($1)', [entries])
    await db.query('DELETE FROM pc49.journal_line WHERE entry_id = ANY($1)', [entries])
    await db.query('DELETE FROM pc49.journal_entry WHERE id = ANY($1)', [entries])
  }
  // Naming a seller on a row files them in the catalogue, so the invented one
  // has to come back out.
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [SELLER])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
}

/** A lot opened straight in the database, for the refusals below. */
async function lotInState(status, sentDate = null) {
  const r = await db.query(
    `INSERT INTO pc49.refining_lot (lot_code, status, sent_date)
     VALUES ('', $1, $2) RETURNING id`, [status, sentDate])
  lots.push(r.rows[0].id)
  return r.rows[0].id
}

/** Runs something that should be refused, and hands back what it said. */
async function refused(fn) {
  try { await fn(); return null } catch (e) { return String(e.message) }
}

try {
  await cleanUp()

  // Two purchases of scrap, in the two bands the counter writes on the bag:
  // 14k goes in the low bag, 23-24k in the high one (0058).
  await db.query(
    `INSERT INTO pc49.gold_txn
       (txn_date, txn_type, gold_type_code, uom, qty, unit_price, amount, partner_code,
        scrap_detail, gold_pct)
     VALUES ($1, 'PO', 'SG', 'GRAM', 20, 50, -1000, $2, '14k/grs', 0.583),
            ($1, 'PO', 'SG', 'GRAM', 10, 90,  -900, $2, '23-24k/grs', 0.9893)`,
    [BOUGHT, SELLER])

  const gs = accountFor('GS_US')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, gs.email, gs.password)

  // ---- Opening a lot --------------------------------------------------------
  //
  // One click, and the code is minted by the database (0057): nothing is typed,
  // so no two people can invent the same lot number.
  const before = (await db.query('SELECT id FROM pc49.refining_lot')).rows.map((r) => r.id)
  await page.goto(`${BASE}/refining`, { waitUntil: 'networkidle' })
  const opened = await press(
    page.getByRole('button', { name: 'Mở lô mới' }).first(),
    async () => {
      const r = await db.query(
        `SELECT id, lot_code AS code, status::text AS s FROM pc49.refining_lot
          WHERE NOT (id = ANY($1)) LIMIT 1`, [before])
      return r.rows[0] ?? null
    })
  check('a lot is opened with one click', opened !== null && opened.s === 'DRAFT', opened?.s ?? '(none)')
  if (!opened) throw new Error('no lot was opened, so there is nothing to fill')
  lots.push(opened.id)
  check('and the database numbers it', /^S\d{2}\.\d+$/.test(opened.code ?? ''), opened.code ?? '(no code)')

  const lotPage = `${BASE}/refining/${opened.id}`
  await page.goto(lotPage, { waitUntil: 'networkidle' })

  // ---- The purchases the lot is made of -------------------------------------
  //
  // The checkbox column of sheet 1.Scrap Gold. Until this existed the lines of
  // a lot were retyped from the purchases they came from, which is slower than
  // the spreadsheet and a second place for the figures to disagree.
  await page.getByRole('tab', { name: /Nguồn mua/ }).click()
  const offered = page.locator('tbody tr').filter({ hasText: SELLER })
  check('the scrap bought is offered to the lot, not retyped into it',
    await until(async () => (await offered.count()) === 2 ? true : null),
    `${await offered.count()} offered`)

  for (let i = 0; i < await offered.count(); i += 1) {
    await offered.nth(i).locator('input[type="checkbox"]').check()
  }
  const picked = await press(
    page.getByRole('button', { name: /Đưa vào lô/ }).first(),
    async () => {
      const r = await db.query(
        `SELECT count(*)::int AS n FROM pc49.refining_lot_source WHERE lot_id = $1`, [opened.id])
      return r.rows[0].n === 2 ? r.rows[0] : null
    })
  check('ticking them puts them in the lot', picked !== null, `${picked?.n ?? 0} picked`)

  // The four figures the spreadsheet's batch tab computes, per bag.
  const bands = await db.query(
    `SELECT grade_band AS b, gross_weight_gram::float8 AS gross,
            round(pure_weight_gram, 4)::float8 AS pure, total_cost::float8 AS cost
       FROM pc49.v_refining_lot_source_summary WHERE lot_id = $1 ORDER BY grade_band`, [opened.id])
  const low = bands.rows.find((r) => r.b === '10-18k/grs')
  const high = bands.rows.find((r) => r.b === '19-24k/grs')
  check('and totals them in the two bands the scrap is sent in',
    bands.rows.length === 2
      && low?.gross === 20 && low?.pure === 11.66 && low?.cost === 1000
      && high?.gross === 10 && high?.pure === 9.893 && high?.cost === 900,
    bands.rows.map((r) => `${r.b} ${r.gross}g/${r.pure}g24k/$${r.cost}`).join('  '))

  const stillOffered = await db.query(
    `SELECT count(*)::int AS n FROM pc49.v_refining_available_purchase WHERE partner_code = $1`,
    [SELLER])
  check('and takes them off the list of what can still be sent',
    stillOffered.rows[0].n === 0, `${stillOffered.rows[0].n} left`)

  // ---- The bags that go -----------------------------------------------------
  //
  // The totals stop being a calculation and become the bags that leave the
  // vault, one per band. Without this the figures were worked out and then
  // retyped, which is the retyping the ticking was meant to remove.
  const bagged = await press(
    page.getByRole('button', { name: /Đóng túi từ phiếu đã chọn/ }).first(),
    async () => {
      const r = await db.query(
        `SELECT source_desc AS d, gross_weight_gram::float8 AS g, gold_pct::float8 AS p
           FROM pc49.refining_lot_line WHERE lot_id = $1 ORDER BY source_desc`, [opened.id])
      return r.rows.length === 2 ? r.rows : null
    })
  check('the ticked bands become the bags that are sent',
    bagged !== null
      && bagged[0].d === '10-18k/grs' && bagged[0].g === 20 && bagged[0].p === 0.583
      && bagged[1].d === '19-24k/grs' && bagged[1].g === 10 && bagged[1].p === 0.9893,
    (bagged ?? []).map((r) => `${r.d} ${r.g}g @${r.p}`).join('  '))

  // A partner's bag travelling in the same shipment. The owner sits on the bag
  // rather than the lot for exactly this reason, and the lot cannot close until
  // they have been settled with.
  await page.getByRole('tab', { name: /Các túi gửi đi/ }).click()
  await page.getByRole('button', { name: 'Thêm túi tay' }).first().click()
  const bagForm = page.getByRole('dialog').last()
  await bagForm.waitFor()
  await bagForm.getByLabel('Chủ sở hữu', { exact: true }).fill(PARTNER_OWNER)
  await bagForm.getByLabel('Chi tiết', { exact: true }).fill('verify partner bag')
  await bagForm.getByLabel('TL thô (g)', { exact: true }).fill('40')
  await bagForm.getByLabel('Tuổi vàng (0–1)', { exact: true }).fill('0.75')
  await bagForm.getByRole('button', { name: 'Lưu', exact: true }).click()
  const withPartner = await untilRowIs(db,
    `SELECT count(*)::int AS n FROM pc49.refining_lot_line WHERE lot_id = $1`, [opened.id],
    (r) => r.n === 3)
  check('a partner bag can be written by hand beside them', withPartner !== null,
    `${withPartner?.n ?? 0} bags`)

  // ---- Sending it -----------------------------------------------------------
  await page.getByRole('button', { name: 'Gửi đi', exact: true }).click()
  const sendForm = page.getByRole('dialog').last()
  await sendForm.waitFor()
  await sendForm.getByLabel('Ngày', { exact: true }).fill(SENT)
  await sendForm.getByLabel('Spot /oz — Gold', { exact: true }).fill('4800')
  await sendForm.getByRole('button', { name: /Gửi đi/ }).click()
  const sent = await untilRowIs(db,
    `SELECT status::text AS s, sent_date::text AS d, spot_gold_per_oz_sent::float8 AS spot
       FROM pc49.refining_lot WHERE id = $1`, [opened.id],
    (r) => r.s === 'SENT')
  check('sending it at the day’s spot moves the lot on',
    sent !== null && sent.d === SENT && sent.spot === 4800,
    sent ? `${sent.s} on ${sent.d} at ${sent.spot}` : await complaint(page))
  if (!sent) throw new Error('the lot never went, so there is nothing to assay')

  // The gold is out of the vault, not merely marked as sent (0056). A transfer
  // writes both halves — off the shelf and into the refinery's hands — so what
  // says the metal has gone is the shelf, not the sum of the two.
  //
  // Thirty grams, not seventy: the partner's forty travel in the same shipment
  // and stay off the house's books, which is 0017's rule and 0056's stance.
  const stock = (await db.query(
    `SELECT coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'ON_HAND'), 0)::float8 AS shelf,
            coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'AT_REFINERY'), 0)::float8 AS away
       FROM pc49.inventory_movement m
       JOIN pc49.gold_txn t ON t.id = m.source_id
      WHERE t.refining_lot_id = $1`, [opened.id])).rows[0]
  check('and the house metal leaves the shelf for the refinery',
    stock.shelf === -30 && stock.away === 30,
    `${stock.shelf} g off the shelf, ${stock.away} g at the refinery`)

  // ---- What the refinery found ----------------------------------------------
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Đã có kết quả assay' }).click()
  const assayForm = page.getByRole('dialog').last()
  await assayForm.waitFor()
  await assayForm.getByLabel('Ngày assay', { exact: true }).fill(ASSAYED)
  await assayForm.getByLabel('Spot sau assay (10) — Gold', { exact: true }).fill('4890')
  // One row per bag: what the refinery weighed, and what it says the metal was.
  const assayRows = assayForm.locator('tbody tr')
  for (let i = 0; i < await assayRows.count(); i += 1) {
    const cells = assayRows.nth(i).locator('input')
    await cells.nth(1).fill('0.74')
  }
  await assayForm.getByRole('button', { name: 'Lưu', exact: true }).click()
  const assayed = await untilRowIs(db,
    `SELECT status::text AS s, assay_date::text AS d, spot_gold_per_oz_assay::float8 AS spot
       FROM pc49.refining_lot WHERE id = $1`, [opened.id],
    (r) => r.s === 'ASSAYED')
  check('the refinery’s answer is recorded against the lot',
    assayed !== null && assayed.d === ASSAYED && assayed.spot === 4890,
    assayed ? `${assayed.s} on ${assayed.d} at ${assayed.spot}` : await complaint(page))
  if (!assayed) throw new Error('the assay was not recorded, so nothing can be settled')

  // Sheet 3.3 read left to right: 20 g sent as 58.3% came back weighed at 74%,
  // so 14.8 g of it is 24k — not the 11.66 estimated, which is the entire
  // reason the sheet has an assay column.
  const settles = await db.query(
    `SELECT round(assay_pure_weight_gram, 4)::float8 AS p, round(assay_value, 2)::float8 AS v
       FROM pc49.v_refining_lot_line_value
      WHERE lot_id = $1 AND source_desc = '10-18k/grs'`, [opened.id])
  check('the lot says what it settles at, not only what it was estimated at',
    settles.rows[0]?.p === 14.8 && settles.rows[0]?.v > 0,
    `24k ${settles.rows[0]?.p} g settles at ${settles.rows[0]?.v}`)

  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /Kết quả phân kim/ }).click()
  check('and the screen shows it beside what was estimated',
    ((await page.locator('body').textContent()) ?? '').includes('Giá chốt'))

  // ---- Settling with each owner ---------------------------------------------
  await page.getByRole('tab', { name: /Quyết toán/ }).click()
  // The row that both names the owner and offers to settle with them.
  //
  // The owner's name alone picks a bag: the bags table is still in the page
  // behind this one and its rows say PC49 too. The tab's own panel is no help
  // either — it carries no class of its own in this version of antd, so a
  // locator written around one matches nothing at all.
  const settleWith = (owner) => page.locator('tr')
    .filter({ hasText: owner })
    .filter({ has: page.getByRole('button', { name: 'Ghi nhận về' }) })
    .first()
  const house = settleWith('PC49')
  await house.getByRole('button', { name: 'Ghi nhận về' }).click()
  const settleForm = page.getByRole('dialog').last()
  await settleForm.waitFor()
  const offeredBack = await settleForm.getByLabel(/Đã nhận về/).inputValue()
  check('what is owed is offered rather than worked out again',
    Number(offeredBack.replace(/,/g, '')) === 30, offeredBack)

  await settleForm.getByLabel('Ngày nhận', { exact: true }).fill(RECEIVED)
  await settleForm.getByRole('button', { name: 'Lưu', exact: true }).click()
  const receipt = await untilRow(db,
    `SELECT owner_code AS o, qty_gram::float8 AS g, gold_type_code AS t, settle_kind AS k
       FROM pc49.refining_receipt WHERE lot_id = $1 AND owner_code = 'PC49'`, [opened.id])
  check('metal taken back is recorded against the right owner',
    receipt !== null && receipt.g === 30 && receipt.t === 'GRAIN' && receipt.k === 'METAL',
    `${receipt?.o} ${receipt?.g} g ${receipt?.t} ${receipt?.k}`)

  const moved = await untilRowIs(db,
    `SELECT status::text AS s, received_date::text AS d FROM pc49.refining_lot WHERE id = $1`,
    [opened.id], (r) => r.s === 'RECEIVED')
  check('the first receipt moves the lot to Đã nhận về',
    moved !== null && moved.d === RECEIVED, `${moved?.s} on ${moved?.d}`)

  // A receipt for somebody with no bag on the lot is refused by the database,
  // not by the screen: a screen is not the only way in.
  const stranger = await refused(() =>
    db.query(`SELECT pc49.receive_refining($1, $2, 'NOBODY', 10)`, [opened.id, RECEIVED]))
  check('a receipt for somebody with no bag on the lot is refused',
    /has no line belonging to/.test(stranger ?? ''), (stranger ?? '(allowed)').slice(0, 60))

  // ---- Closing it -----------------------------------------------------------
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('tab', { name: /Quyết toán/ }).click()
  const owed = settleWith(PARTNER_OWNER)
  check('the partner is still shown as owed',
    ((await owed.textContent()) ?? '').includes('40.00'))
  check('and the lot cannot be closed while they are',
    await page.getByRole('button', { name: 'Đóng lô' }).isDisabled())

  // Column S of the source sheet: `Lấy tiền / Lấy vàng`. An owner may take the
  // money instead (0050), and a lot whose partner did was the one thing that
  // could never be closed at all.
  await owed.getByRole('button', { name: 'Ghi nhận về' }).click()
  const cashForm = page.getByRole('dialog').last()
  await cashForm.waitFor()
  await cashForm.getByLabel('Ngày nhận', { exact: true }).fill(RECEIVED)
  await cashForm.getByLabel('Hình thức nhận', { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'Lấy tiền' }).first().click()
  await cashForm.getByLabel('Số tiền', { exact: true }).fill('6400')
  await cashForm.getByRole('button', { name: 'Lưu', exact: true }).click()
  const paid = await untilRow(db,
    `SELECT settle_kind AS k, amount_usd::float8 AS a FROM pc49.refining_receipt
      WHERE lot_id = $1 AND owner_code = $2`, [opened.id, PARTNER_OWNER])
  check('a partner may take the money instead of the metal',
    paid !== null && paid.k === 'CASH' && paid.a === 6400, `${paid?.k} ${paid?.a}`)

  await page.reload({ waitUntil: 'networkidle' })
  const closed = await press(
    page.getByRole('button', { name: 'Đóng lô' }),
    async () => {
      const r = await db.query(
        `SELECT status::text AS s FROM pc49.refining_lot WHERE id = $1`, [opened.id])
      return r.rows[0].s === 'CLOSED' ? r.rows[0] : null
    })
  check('and the lot closes once everybody has been settled with',
    closed !== null, closed?.s ?? '(still open)')

  // ---- The order of the cycle belongs to the database -----------------------
  const early = await refused(async () => {
    const draft = await lotInState('SENT', SENT)
    await db.query(`SELECT pc49.receive_refining($1, $2, 'PC49', 10)`, [draft, RECEIVED])
  })
  check('a receipt before the assay is refused',
    /has not been assayed/.test(early ?? ''), (early ?? '(allowed)').slice(0, 60))

  const skipped = await refused(async () => {
    const draft = await lotInState('DRAFT')
    await db.query(`UPDATE pc49.refining_lot SET status = 'ASSAYED' WHERE id = $1`, [draft])
  })
  check('a lot cannot skip a stage',
    /one stage at a time/.test(skipped ?? ''), (skipped ?? '(allowed)').slice(0, 60))
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const over = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.refining_lot WHERE id = ANY($1)) AS lots,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE partner_code = $2) AS txns,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $2) AS sellers`,
    [lots, SELLER])
  const r = over.rows[0]
  check('the check cleaned up after itself',
    r.lots === 0 && r.txns === 0 && r.sellers === 0,
    `${r.lots} lots, ${r.txns} transactions, ${r.sellers} sellers`)
  await db.end()
}

console.log(failures === 0 ? '\nALL REFINING CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
