// A receipt of several items, typed the way the counter asked for it.
//
//   "nguoi ta ban 1 lan 6 mon la app dang bat nhap 6 lan"
//
// The paper receipt from 17-09, entered whole: six pieces bought from one
// customer, 8,361.00, paid 5,000 in cash and the rest by wire. Then the ledger
// is read the way the accountant reads it (one row, six items beneath), and
// the receipt is corrected (the pendant taken off) and cancelled.
//
//   npm run verify:receipt      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { until, untilRowIs } from './support/until.mjs'
import { removeReceipts } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-10-08'
const PERIOD = '2019-10'
const PARTNER = 'verify-receipt customer'
const SCREEN = `${BASE}/gold-transactions?date=${DAY}`

/** The six items on the paper: weight, purity, and the amount the receipt says. */
const ITEMS = [
  { desc: 'Nhẫn 24K (vụn)', gold: 'Scrap Gold', band: '19-24k/grs', qty: '9.40', purity: '0.987', total: '950' },
  { desc: 'Mũ 24K (vụn)', gold: 'Scrap Gold', band: '19-24k/grs', qty: '7.50', purity: '0.981', total: '825' },
  { desc: 'Thỏi RCM', gold: 'Grain', band: null, qty: '15.60', purity: '0.998', total: '1900' },
  { desc: 'Bi 24K (vụn)', gold: 'Scrap Gold', band: '19-24k/grs', qty: '37.50', purity: '0.990', total: '4125' },
  { desc: 'Xu Suisse 24K', gold: 'Grain', band: null, qty: '5.00', purity: '0.990', total: '525' },
  { desc: 'Mặt dây 14K (vụn)', gold: 'Scrap Gold', band: '10-18k/grs', qty: '0.60', purity: '0.597', total: '36' },
]

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes on its day, and the customer it invents. */
async function cleanUp() {
  const txns = await db.query('SELECT id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  await db.query('UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  await removeReceipts(db, DAY)
  // Unposted first: a posted entry's lines are immutable. Reversals go before
  // the entries they point at.
  await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL', [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [PERIOD])
  await db.query('DELETE FROM pc49.gold_price_daily WHERE price_date = $1', [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
}

/**
 * Clicks an option in whichever dropdown is open, scrolled to and pressed: an
 * option drawn below the dialog's scrolling body never counts as visible.
 */
async function pickOption(page, option) {
  const choice = page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option }).first()
  await choice.waitFor({ state: 'attached' })
  await choice.scrollIntoViewIfNeeded().catch(() => {})
  await choice.click({ force: true })
}

async function choose(page, scope, label, option) {
  await scope.getByLabel(label, { exact: true }).first().click()
  await pickOption(page, option)
}

const item = (form, n) => form.getByRole('group', { name: `Món ${n}`, exact: true })
const items = (form) => form.getByRole('group', { name: /^Món \d+$/ })
const shown = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ')

try {
  await cleanUp()
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'SG', 62.50), ($1, 'GRAIN', 139.20)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = excluded.market_price`, [DAY])

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- The receipt, typed once ---------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)

  for (const [i, it] of ITEMS.entries()) {
    if (i > 0) await form.getByRole('button', { name: 'Thêm món' }).click()
    const group = item(form, i + 1)
    await group.waitFor()
    await group.getByLabel('Mô tả món', { exact: true }).fill(it.desc)
    await choose(page, group, 'Loại vàng', it.gold)
    if (it.band) await choose(page, group, 'Nhóm Scrap Gold', it.band)
    await group.getByLabel('Số lượng', { exact: true }).fill(it.qty)
    await group.getByLabel('Tuổi vàng (0–1)', { exact: true }).fill(it.purity)
    await group.getByLabel('Thành tiền', { exact: true }).fill(it.total)
  }

  const first = item(form, 1)
  const finePrice = Number((await first.getByLabel('Giá/gram tinh', { exact: true }).inputValue())
    .replace(/,/g, ''))
  check('the price per fine gram follows from the amount', Math.abs(finePrice - 102.39) < 0.006, `${finePrice}`)
  check('and the fine grams are worked out', (await shown(first)).includes('9.2778'))
  check('six items on the form', (await items(form).count()) === 6, `${await items(form).count()}`)
  check('adding up to the paper total', (await shown(form)).includes('8,361.00'))

  const settle = form.locator('section[aria-labelledby="txn-settle-heading"]')
  const amounts = () => settle.getByLabel('Số tiền', { exact: true })
  await amounts().nth(0).fill('5000')
  await settle.getByRole('button', { name: 'Thêm hình thức thanh toán' }).click()
  await until(async () => ((await amounts().count()) === 2 ? true : null))
  await amounts().nth(1).fill('3361')
  await settle.getByLabel('Hình thức', { exact: true }).nth(1).click()
  await pickOption(page, 'BANKWIRE')
  check('paid in full, the form shows no difference',
    (await settle.getByText(/Còn nợ|Thanh toán nhiều hơn/).count()) === 0)

  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const saved = await untilRowIs(db,
    `SELECT r.id, r.doc_no, count(t.id)::int AS items, count(t.journal_entry_id)::int AS posted,
            count(DISTINCT t.doc_no)::int AS numbers, coalesce(-sum(t.amount), 0)::float8 AS total
       FROM pc49.gold_receipt r JOIN pc49.gold_txn t ON t.receipt_id = r.id
      WHERE r.txn_date = $1 AND r.partner_code = $2 AND r.voided_at IS NULL
      GROUP BY r.id`, [DAY, PARTNER], (r) => r.posted === 6)
  check('one receipt saves, its six items posted', saved !== null,
    saved ? `${saved.doc_no}, ${saved.items} items` : '(nothing posted)')
  if (!saved) throw new Error('the receipt did not save')
  check('under one number', saved.numbers === 1, `${saved.numbers} numbers`)
  check('for the paper total', saved.total === 8361, `${saved.total}`)

  const paid = await db.query(
    `SELECT gp.method::text AS method, sum(gp.amount)::float8 AS total
       FROM pc49.gold_txn t JOIN pc49.gold_txn_payment gp ON gp.txn_id = t.id
      WHERE t.receipt_id = $1 GROUP BY 1 ORDER BY 1`, [saved.id])
  check('the payments are divided without losing a cent',
    paid.rows.length === 2
      && paid.rows[0].method === 'BANKWIRE' && paid.rows[0].total === 3361
      && paid.rows[1].method === 'CASH' && paid.rows[1].total === 5000,
    paid.rows.map((r) => `${r.total} ${r.method}`).join(' + '))

  // ---- One row in the ledger -----------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  const rows = page.locator('.ant-table-tbody tr.ant-table-row')
  check('the ledger lists the receipt once', (await rows.count()) === 1, `${await rows.count()} rows`)
  const row = rows.first()
  const rowText = await shown(row)
  check('as several kinds of gold, six items', rowText.includes('Nhiều loại (6 món)'), rowText.slice(0, 140))
  check('with the paper total', rowText.includes('8,361.00'))
  await row.locator('.ant-table-row-expand-icon').click()
  const expanded = page.locator('.ant-table-expanded-row').first()
  await expanded.waitFor()
  check('and its items open beneath it', (await shown(expanded)).includes('Thỏi RCM'))

  // ---- Corrected: the pendant was not sold after all -----------------------
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click()
  const fix = page.getByRole('dialog', { name: 'Sửa giao dịch', exact: true }).last()
  await fix.waitFor()
  check('the correction opens holding all six items', (await items(fix).count()) === 6,
    `${await items(fix).count()}`)
  await item(fix, 6).getByRole('button', { name: 'Bỏ món này' }).click()
  await until(async () => ((await items(fix).count()) === 5 ? true : null))
  const fixSettle = fix.locator('section[aria-labelledby="txn-settle-heading"]')
  await fixSettle.getByLabel('Số tiền', { exact: true }).nth(1).fill('3325')
  await fix.getByLabel('Lý do sửa', { exact: true }).fill('Khách giữ lại mặt dây')
  await fix.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const fixed = await untilRowIs(db,
    `SELECT r.id, r.doc_no, r.corrects_receipt_id AS corrects, count(t.journal_entry_id)::int AS posted
       FROM pc49.gold_receipt r JOIN pc49.gold_txn t ON t.receipt_id = r.id
      WHERE r.txn_date = $1 AND r.partner_code = $2 AND r.voided_at IS NULL
      GROUP BY r.id`, [DAY, PARTNER], (r) => r.corrects === saved.id && r.posted === 5)
  check('the corrected receipt has five items, posted', fixed !== null, fixed ? '' : '(not corrected)')
  if (!fixed) throw new Error('the correction did not save')
  check('and keeps its number', fixed.doc_no === saved.doc_no, fixed.doc_no)
  const old = await db.query(
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_receipt WHERE id = $1) AS receipt,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE receipt_id = $1 AND voided_at IS NULL) AS live`,
    [saved.id])
  check('the original is cancelled, every item of it',
    old.rows[0].receipt === true && old.rows[0].live === 0, `${old.rows[0].live} live items`)

  // ---- Cancelled -----------------------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Huỷ', exact: true }).first().click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiểm tra huỷ cả phiếu')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  const cancelled = await untilRowIs(db,
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_receipt WHERE id = $1) AS receipt,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE receipt_id = $1 AND voided_at IS NULL) AS live`,
    [fixed.id], (r) => r.receipt === true && r.live === 0)
  check('cancelling takes every item off the books at once', cancelled !== null)
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('and the ledger lists nothing for the day',
    (await page.locator('.ant-table-tbody tr.ant-table-row').count()) === 0)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date = $1) AS receipts,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.gold_price_daily WHERE price_date = $1) AS prices,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.receipts, r.entries, r.prices, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.receipts} receipts, ${r.entries} entries, ${r.prices} prices, ${r.partners} customers`)
  await db.end()
}

console.log(failures === 0 ? '\nALL RECEIPT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
