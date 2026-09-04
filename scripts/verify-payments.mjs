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

try {
  // Scrap has a price that day, so the row can post.
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'SG', 62.50)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = 62.50`, [DAY])

  const kt = accountFor('KT')
  const page = await openPage(browser)
  await signIn(page, BASE, kt.email, kt.password)
  await page.goto(`${BASE}/gold-transactions?date=${DAY}`, { waitUntil: 'networkidle' })

  // ---- One order, settled two ways ----------------------------------------
  await page.getByLabel('Khách / NCC').first().fill(PARTNER)
  await page.getByLabel('Loại vàng').first().selectOption('SG')
  await page.getByLabel('Số lượng').first().fill('40')
  await page.getByLabel('Đơn giá').first().fill('62.50')

  // Half in cash. The second line should appear only once the first has a
  // figure — it is an ordinary morning, not the common case.
  check('a second payment line is not in the way until it is needed',
    (await page.getByLabel('Thanh toán 2').count()) === 0)

  await page.getByLabel('Thanh toán 1').first().fill('1500')
  const appeared = await until(async () => (await page.getByLabel('Thanh toán 2').count()) > 0)
  check('and appears once the first payment is entered', appeared === true)

  await page.getByLabel('Thanh toán 2').first().fill('700')
  await page.getByLabel('Hình thức 2').first().selectOption('BANKWIRE')

  // And a third, which is where the screen used to stop. The lines keep
  // arriving one at a time for as long as the settlement takes.
  const third = await until(async () => (await page.getByLabel('Thanh toán 3').count()) > 0)
  check('a third line appears once the second is entered', third === true)

  await page.getByLabel('Thanh toán 3').first().fill('300')
  await page.getByLabel('Hình thức 3').first().selectOption('ZELLE')
  await page.getByLabel('Ghi chú').first().press('Enter')

  const saved = await untilRow(db,
    `SELECT id, amount::float8 AS amount FROM pc49.gold_txn
      WHERE txn_date = $1 AND partner_code = $2`, [DAY, PARTNER])
  check('the order saves', saved !== null, saved ? `${saved.amount}` : '(nothing)')

  const paid = await db.query(
    `SELECT seq, amount::float8 AS amount, method::text FROM pc49.gold_txn_payment
      WHERE txn_id = $1 ORDER BY seq`, [saved?.id])
  check('all three payments are recorded, in order',
    paid.rows.length === 3
      && paid.rows[0].amount === 1500 && paid.rows[0].method === 'CASH'
      && paid.rows[1].amount === 700 && paid.rows[1].method === 'BANKWIRE'
      && paid.rows[2].amount === 300 && paid.rows[2].method === 'ZELLE',
    paid.rows.map((r) => `${r.amount} ${r.method}`).join(' + '))

  // And the books took them. A purchase with no payment will not post at all,
  // so this is also the proof that a split order is postable.
  //
  // Waited for: saving is three round trips — the row, its payments, then the
  // posting — and a poll that stops at the first reads a null entry id and
  // calls a transaction on its way to the ledger unposted.
  const posted = await untilRowIs(db,
    `SELECT journal_entry_id AS e FROM pc49.gold_txn WHERE id = $1`, [saved?.id],
    (r) => r.e !== null)
  check('and the order posts to the ledger', posted !== null,
    posted ? '' : '(still unposted)')

  const lines = await db.query(
    `SELECT count(*)::int n FROM pc49.journal_line
      WHERE entry_id = $1 AND debit_account IS NOT NULL`, [posted?.e])
  check('with a line for each way it was paid', lines.rows[0].n === 3, `${lines.rows[0].n} lines`)

  // ---- And the screen says so afterwards ----------------------------------
  await page.reload({ waitUntil: 'networkidle' })
  const row = page.locator('tr').filter({ hasText: PARTNER })
  const shown = (await row.textContent()) ?? ''
  check('the saved row shows what was paid, not two blank cells',
    shown.includes('1,500.00') && shown.includes('700.00') && shown.includes('300.00'),
    shown.replace(/\s+/g, ' ').slice(-70))
  check('and by which methods, all three of them',
    shown.includes('CASH') && shown.includes('BANKWIRE') && shown.includes('ZELLE'))

  await page.screenshot({ path: 'payments.png', fullPage: false })
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  const txns = await db.query(
    `SELECT id, journal_entry_id FROM pc49.gold_txn WHERE txn_date = $1`, [DAY])
  for (const t of txns.rows) {
    await db.query(`DELETE FROM pc49.inventory_movement WHERE source_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn WHERE id = $1`, [t.id])
  }
  // Naming a customer on a row now files them in the catalogue, so the check
  // has to take its invented one back out. A customer list that grew a test
  // name on every run is a customer list nobody trusts.
  await db.query(`DELETE FROM pc49.partner WHERE code = $1`, [PARTNER])
  await db.query(`UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.gold_price_daily WHERE price_date = $1`, [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)

  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.gold_price_daily WHERE price_date = $1) AS prices`,
    [DAY, PERIOD])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    r.txns === 0 && r.entries === 0 && r.prices === 0,
    `${r.txns} txns, ${r.entries} entries, ${r.prices} prices`)
  await db.end()
}

console.log(failures === 0 ? '\nALL PAYMENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
