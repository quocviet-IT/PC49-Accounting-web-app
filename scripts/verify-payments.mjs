// Three things an accountant reported about the payment columns, checked the
// way they hit them.
//
//   "Hinh thuc thanh toan da nhap roi nhung khi luu khong hien thi"
//   "Chua phan loai truong hop khach thanh toan nhieu hinh thuc trong cung 1 don"
//   "Thanh toan chi dang co dinh khach chi duoc thanh toan 2 lan cho 1 don"
//
// The first was a display fault: the payment was stored correctly and the row
// drew two empty cells over it. The second was a screen that could only say
// what the books had always been able to record.
//
// The third went deeper than the screen. The table itself carried
// `CHECK (seq IN (1, 2))`, copied from a spreadsheet with two payment columns,
// so a customer settling one order three ways lost the third into the remarks.
// Migration 0046 removed it. The posting function never needed it: it loops
// over every payment row it finds.
//
//   npm run verify:payments      (dev server up)
//
// Rewritten on 2026-09-16 for the entry form. Entry stopped being an inline
// grid on 2026-09-10 (eabfb54): a transaction is typed into a dialog, and the
// payment lines are added one at a time with a button rather than waiting in
// numbered columns. The check before this one filled "Thanh toán 1" and
// "Hình thức 2", which have not existed since, so it could not even begin.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { until, untilRow, untilRowIs } from './support/until.mjs'
import { removeReceipts } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-11-14'
const PERIOD = '2019-11'
const PARTNER = 'verify-payments customer'

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes on its day, and the customer it invents. */
async function cleanUp() {
  const txns = await db.query('SELECT id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  await removeReceipts(db, DAY)
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
  await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [PERIOD])
  await db.query('DELETE FROM pc49.gold_price_daily WHERE price_date = $1', [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
}

/**
 * Clicks an option in whichever dropdown is open.
 *
 * Scrolled to and pressed rather than waited on: a dropdown opened near the
 * bottom of the dialog is drawn partly outside the dialog's scrolling body, and
 * an option down there never counts as visible, so a plain click waits until it
 * times out. That was the third payment line's method, one run in two.
 */
async function pickOption(page, option) {
  const choice = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option }).first()
  await choice.waitFor({ state: 'attached' })
  await choice.scrollIntoViewIfNeeded().catch(() => {})
  await choice.click({ force: true })
}

/** Picks an option from one of the form's dropdowns. */
async function selectOption(page, form, label, option) {
  await form.getByLabel(label, { exact: true }).first().click()
  await pickOption(page, option)
}

try {
  await cleanUp()
  // Scrap has a price that day, so the row can post.
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'SG', 62.50)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = 62.50`, [DAY])

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  await signIn(page, BASE, kt.email, kt.password)
  await page.goto(`${BASE}/gold-transactions?date=${DAY}`, { waitUntil: 'networkidle' })

  // ---- One order, settled three ways --------------------------------------
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await selectOption(page, form, 'Loại vàng', 'Scrap Gold')
  await form.getByLabel('Số lượng', { exact: true }).fill('40')
  await form.getByLabel('Đơn giá', { exact: true }).fill('62.50')
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)

  // The payments are a section of their own, and so is the order's own total:
  // both call a field "Số tiền", and scoping to the section is what tells the
  // money the customer handed over from the money the order came to.
  const settle = form.locator('section[aria-labelledby="txn-settle-heading"]')
  const lines = () => settle.getByLabel('Số tiền', { exact: true })
  const addLine = settle.getByRole('button', { name: 'Thêm hình thức thanh toán' })

  check('one payment line to begin with, not two empty columns',
    (await lines().count()) === 1, `${await lines().count()} line(s)`)

  await lines().nth(0).fill('1500')
  await selectOption(page, settle, 'Hình thức', 'CASH')

  // Half by transfer. The line arrives when it is asked for rather than
  // waiting in the way: one payment is the ordinary case.
  await addLine.click()
  const second = await until(async () => (await lines().count()) === 2 ? true : null)
  check('and another when the counter asks for one', second === true)
  await lines().nth(1).fill('700')
  await settle.getByLabel('Hình thức', { exact: true }).nth(1).click()
  await pickOption(page, 'BANKWIRE')

  // And a third, which is where the screen used to stop (0046).
  await addLine.click()
  const third = await until(async () => (await lines().count()) === 3 ? true : null)
  check('a third line is allowed, where the two columns used to stop', third === true)
  await lines().nth(2).fill('300')
  await settle.getByLabel('Hình thức', { exact: true }).nth(2).click()
  await pickOption(page, 'ZELLE')

  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const saved = await untilRow(db,
    `SELECT id, amount::float8 AS amount FROM pc49.gold_txn
      WHERE txn_date = $1 AND partner_code = $2`, [DAY, PARTNER])
  check('the order saves', saved !== null, saved ? `${saved.amount}` : '(nothing)')
  if (!saved) throw new Error('nothing was saved, so there are no payments to read')

  // Waited for, like the posting below. Saving is several round trips — the
  // row, whoever sold it, its payments, then the posting — and a read that
  // stops at the first finds the transaction there and its payments not yet
  // written, which reads as "the payments were lost" rather than "ask again".
  const paid = await until(async () => {
    const r = await db.query(
      `SELECT seq, amount::float8 AS amount, method::text FROM pc49.gold_txn_payment
        WHERE txn_id = $1 ORDER BY seq`, [saved.id])
    return r.rows.length === 3 ? r : null
  }) ?? { rows: [] }
  check('all three payments are recorded, in order',
    paid.rows.length === 3
      && paid.rows[0].amount === 1500 && paid.rows[0].method === 'CASH'
      && paid.rows[1].amount === 700 && paid.rows[1].method === 'BANKWIRE'
      && paid.rows[2].amount === 300 && paid.rows[2].method === 'ZELLE',
    paid.rows.map((r) => `${r.amount} ${r.method}`).join(' + '))

  // And the books took them. A purchase with no payment will not post at all,
  // so this is also the proof that a split order is postable.
  const posted = await untilRowIs(db,
    `SELECT journal_entry_id AS e FROM pc49.gold_txn WHERE id = $1`, [saved.id],
    (r) => r.e !== null)
  check('and the order posts to the ledger', posted !== null,
    posted ? '' : '(still unposted)')

  const journal = await db.query(
    `SELECT count(*)::int n FROM pc49.journal_line
      WHERE entry_id = $1 AND debit_account IS NOT NULL`, [posted?.e])
  check('with a line for each way it was paid', journal.rows[0].n === 3,
    `${journal.rows[0].n} lines`)

  // ---- And the screen says so afterwards ----------------------------------
  await page.reload({ waitUntil: 'networkidle' })
  const row = page.locator('tr').filter({ hasText: PARTNER }).first()
  const shown = ((await row.textContent()) ?? '').replace(/\s+/g, ' ')
  check('the saved row shows what was paid, not two blank cells',
    shown.includes('1,500.00') && shown.includes('700.00') && shown.includes('300.00'),
    shown.slice(-70))
  check('and by which methods, all three of them',
    shown.includes('CASH') && shown.includes('BANKWIRE') && shown.includes('ZELLE'))
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    r.txns === 0 && r.entries === 0 && r.partners === 0,
    `${r.txns} txns, ${r.entries} entries, ${r.partners} customers`)
  await db.end()
}

console.log(failures === 0 ? '\nALL PAYMENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
