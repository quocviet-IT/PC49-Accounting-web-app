// Correcting a row that has already posted.
//
//   "Chua co chuc nang sua, bo sung chuc nang chinh sua"
//   "Nhap lieu truc tiep de dan den vo tinh nhap khong de y"
//
// The two pull opposite ways, and the ledger settles the argument: a posted
// transaction cannot be edited where it sits, because the journal entry and the
// stock movement are already recorded. Correcting is cancelling and re-entering
// — the improvement is that the new row arrives holding the old one's values,
// so one field changes instead of eleven being retyped.
//
// What this checks is the part that matters: after a correction the books show
// the corrected figure and nothing of the original is left standing.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { untilRow, untilRowIs } from './support/until.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

const DAY = '2019-12-09'
const PERIOD = '2019-12'
const PARTNER = 'verify-correct customer'

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

try {
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'SG', 60.00)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = 60.00`, [DAY])

  const kt = accountFor('KT')
  const page = await openPage(browser)
  await signIn(page, BASE, kt.email, kt.password)
  await page.goto(`${BASE}/gold-transactions?date=${DAY}`, { waitUntil: 'networkidle' })

  // ---- A row typed with the wrong price ------------------------------------
  await page.getByLabel('Khách / NCC').first().fill(PARTNER)
  await page.getByLabel('Loại vàng').first().selectOption('SG')
  await page.getByLabel('Số lượng').first().fill('20')
  await page.getByLabel('Đơn giá').first().fill('600')     // a slipped decimal
  await page.getByLabel('Thanh toán 1').first().fill('12000')
  await page.getByLabel('Ghi chú').first().press('Enter')

  const wrong = await untilRowIs(db,
    `SELECT id, unit_price::float8 AS price, journal_entry_id AS e
       FROM pc49.gold_txn WHERE txn_date = $1 AND partner_code = $2 AND voided_at IS NULL`,
    [DAY, PARTNER], (r) => r.e !== null)
  check('the wrong row posts, as any row does', wrong !== null, `${wrong?.price}`)

  // ---- Correcting it -------------------------------------------------------
  await page.reload({ waitUntil: 'networkidle' })
  check('a saved row offers a correction, not only a cancellation',
    (await page.getByRole('button', { name: 'Sửa', exact: true }).count()) > 0)

  page.once('dialog', (d) => d.accept('Đơn giá gõ nhầm 600 thay vì 60'))
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click()

  const voided = await untilRowIs(db,
    `SELECT voided_at, void_reason AS why FROM pc49.gold_txn WHERE id = $1`, [wrong?.id],
    (r) => r.voided_at !== null)
  check('the original is cancelled, with the reason kept',
    voided !== null && /600/.test(voided.why ?? ''), voided?.why ?? '')

  // The whole point: what was typed comes back, so one field changes.
  const price = page.getByLabel('Đơn giá').last()
  check('and the new row arrives holding what the old one said',
    (await price.inputValue()) === '600'
      && (await page.getByLabel('Khách / NCC').last().inputValue()) === PARTNER
      && (await page.getByLabel('Thanh toán 1').last().inputValue()) === '12000',
    await page.getByLabel('Khách / NCC').last().inputValue())

  // Change the one thing that was wrong.
  await price.fill('60')
  await page.getByLabel('Thanh toán 1').last().fill('1200')
  await page.getByLabel('Ghi chú').last().press('Enter')

  const fixed = await untilRowIs(db,
    `SELECT id, unit_price::float8 AS price, amount::float8 AS amount, journal_entry_id AS e
       FROM pc49.gold_txn
      WHERE txn_date = $1 AND partner_code = $2 AND voided_at IS NULL`,
    [DAY, PARTNER], (r) => r.e !== null)
  check('the corrected row posts', fixed !== null && fixed.price === 60, `${fixed?.price}`)
  check('and carries the corrected amount', fixed?.amount === -1200, `${fixed?.amount}`)

  // ---- And the books agree --------------------------------------------------
  const stock = await db.query(
    `SELECT coalesce(sum(m.qty_gram), 0)::float8 AS g
       FROM pc49.inventory_movement m
       JOIN pc49.gold_txn t ON t.id = m.source_id
      WHERE t.txn_date = $1`, [DAY])
  check('stock counts the correction once, not twice',
    stock.rows[0].g === 20, `${stock.rows[0].g} g`)

  // Net, not the debit side alone. A reversing entry puts the wrong figure
  // back on the credit side rather than deleting it, so 12,000 in and 12,000
  // out and 1,200 in is three postings and one balance.
  const cost = await db.query(
    `SELECT coalesce(sum(
              CASE WHEN l.debit_account = '155SG' THEN l.amount_usd ELSE 0 END
            - CASE WHEN l.credit_account = '155SG' THEN l.amount_usd ELSE 0 END), 0)::float8 AS v
       FROM pc49.journal_line l
       JOIN pc49.journal_entry e ON e.id = l.entry_id
      WHERE e.period = $1 AND e.posted_at IS NOT NULL`, [PERIOD])
  // The wrong figure is not left sitting in the inventory account, which is the
  // whole reason a correction reverses rather than overwrites.
  check('and the inventory account nets to the corrected figure',
    cost.rows[0].v === 1200, `${cost.rows[0].v}`)

  await page.screenshot({ path: 'correct.png', fullPage: false })
} finally {
  await browser.close()
  const txns = await db.query(`SELECT id FROM pc49.gold_txn WHERE txn_date = $1`, [DAY])
  for (const t of txns.rows) {
    await db.query(`DELETE FROM pc49.inventory_movement WHERE source_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn WHERE id = $1`, [t.id])
  }
  await db.query(`UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query(
    `DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.gold_price_daily WHERE price_date = $1`, [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)

  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries`,
    [DAY, PERIOD])
  const r = left.rows[0]
  check('the check cleaned up after itself', r.txns === 0 && r.entries === 0,
    `${r.txns} txns, ${r.entries} entries`)
  await db.end()
}

console.log(failures === 0 ? '\nALL CORRECTION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
