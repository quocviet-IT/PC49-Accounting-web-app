// Correcting a row that has already posted.
//
//   "Chua co chuc nang sua, bo sung chuc nang chinh sua"
//   "Nhap lieu truc tiep de dan den vo tinh nhap khong de y"
//
// The two pull opposite ways, and the ledger settles the argument: a posted
// transaction cannot be edited where it sits, because the journal entry and the
// stock movement are already recorded. Correcting is cancelling and re-entering
// — the improvement is that the form arrives holding the old row's values, so
// one field changes instead of eleven being retyped.
//
// What this checks is the part that matters: after a correction the books show
// the corrected figure and nothing of the original is left standing.
//
//   npm run verify:correct      (dev server up)
//
// Rewritten on 2026-09-15 for the ledger as it is now: entry is a form (since
// 2026-09-10, eabfb54) and a row is corrected with its Sửa icon, which opens
// that form filled in, the reason included. The check before this one typed
// into the inline grid and could no longer reach it.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { untilRowIs } from './support/until.mjs'
import { removeReceipts } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

const DAY = '2019-12-09'
const PERIOD = '2019-12'
const PARTNER = 'verify-correct customer'
const SCREEN = `${BASE}/gold-transactions?date=${DAY}`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes on its day, and the customer it invents. */
async function cleanUp() {
  const txns = await db.query('SELECT id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  // A replacement points at the row it replaced, so the link has to go before
  // either can. Production never deletes a transaction at all — this exists
  // because a check that leaves the client's books full of its own practice
  // rows is worse than no check.
  await db.query('UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  await removeReceipts(db, DAY)
  // Naming a customer on a row files them in the catalogue, so the check has
  // to take its invented one back out.
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
  await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL', [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [PERIOD])
  await db.query('DELETE FROM pc49.gold_price_daily WHERE price_date = $1', [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
}

async function selectOption(page, form, label, option) {
  await form.getByLabel(label, { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option }).first().click()
}
const figure = async (form, label) =>
  Number((await form.getByLabel(label, { exact: true }).first().inputValue()).replace(/,/g, ''))

try {
  await cleanUp()
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'SG', 60.00)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = 60.00`, [DAY])

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1366, height: 900 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- A purchase typed with the wrong price --------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const typed = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await typed.waitFor()
  await selectOption(page, typed, 'Loại vàng', 'Vàng vụn')
  await typed.getByLabel('Số lượng', { exact: true }).fill('20')
  await typed.getByLabel('Đơn giá', { exact: true }).fill('600')     // a slipped decimal
  await typed.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  await typed.getByLabel('Số tiền', { exact: true }).first().fill('12000')
  await typed.getByRole('button', { name: 'Lưu', exact: true }).click()

  const wrong = await untilRowIs(db,
    `SELECT id, unit_price::float8 AS price, journal_entry_id AS e
       FROM pc49.gold_txn WHERE txn_date = $1 AND partner_code = $2 AND voided_at IS NULL`,
    [DAY, PARTNER], (r) => r.e !== null)
  check('the wrong row posts, as any row does', wrong !== null && wrong.price === 600, `${wrong?.price}`)
  if (!wrong) throw new Error('nothing was saved to correct')

  // ---- Correcting it -------------------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('a saved row offers a correction, not only a cancellation',
    (await page.getByRole('button', { name: 'Sửa', exact: true }).count()) > 0)
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click()
  const form = page.getByRole('dialog', { name: 'Sửa giao dịch', exact: true }).last()
  await form.waitFor()

  // The whole point: what was typed comes back, so one field changes.
  check('and the form arrives holding what the row said',
    (await form.getByLabel('Khách / NCC', { exact: true }).inputValue()) === PARTNER
      && await figure(form, 'Đơn giá') === 600
      && await figure(form, 'Số tiền') === 12000,
    `${await form.getByLabel('Khách / NCC', { exact: true }).inputValue()} · `
      + `${await figure(form, 'Đơn giá')} · ${await figure(form, 'Số tiền')}`)
  check('with a reason already filled in, so correcting is one click',
    (await form.getByLabel('Lý do sửa', { exact: true }).inputValue()).trim() !== '')

  // And the books have not moved. This is the fault PC49-01 named: pressing
  // Sửa used to reverse the original there and then, so closing the tab at
  // this moment left the transaction cancelled with nothing in its place.
  const stillOpen = await db.query(
    'SELECT voided_at, journal_entry_id AS e FROM pc49.gold_txn WHERE id = $1', [wrong.id])
  check('opening a correction has not touched the books',
    stillOpen.rows[0]?.voided_at === null && stillOpen.rows[0]?.e !== null,
    stillOpen.rows[0]?.voided_at ? 'already reversed' : 'still posted')

  // Change the one thing that was wrong.
  await form.getByLabel('Đơn giá', { exact: true }).fill('60')
  await form.getByLabel('Số tiền', { exact: true }).first().fill('1200')
  await form.getByLabel('Lý do sửa', { exact: true }).fill('Đơn giá gõ nhầm 600 thay vì 60')
  await form.getByRole('button', { name: 'Lưu', exact: true }).click()

  const fixed = await untilRowIs(db,
    `SELECT id, unit_price::float8 AS price, amount::float8 AS amount, journal_entry_id AS e
       FROM pc49.gold_txn
      WHERE txn_date = $1 AND partner_code = $2 AND voided_at IS NULL`,
    [DAY, PARTNER], (r) => r.e !== null && r.price === 60)
  check('the corrected row posts', fixed !== null && fixed.price === 60, `${fixed?.price}`)
  check('and carries the corrected amount', fixed?.amount === -1200, `${fixed?.amount}`)

  // Only now is the original reversed, and it happened with the replacement.
  const voided = await untilRowIs(db,
    'SELECT voided_at, void_reason AS why FROM pc49.gold_txn WHERE id = $1', [wrong.id],
    (r) => r.voided_at !== null)
  check('and only then is the original cancelled, with the reason kept',
    voided !== null && /600/.test(voided.why ?? ''), voided?.why ?? '')

  // The replacement is a receipt that says which receipt it replaces, under
  // the same number, so the pair can be read back later (0075).
  const linked = await db.query(
    `SELECT fr.corrects_receipt_id::text AS corrects, wt.receipt_id::text AS original,
            ft.doc_no = wt.doc_no AS same_number
       FROM pc49.gold_txn ft JOIN pc49.gold_receipt fr ON fr.id = ft.receipt_id
       CROSS JOIN pc49.gold_txn wt
      WHERE ft.id = $1 AND wt.id = $2`, [fixed?.id, wrong.id])
  check('and the replacement records which receipt it replaced',
    Boolean(linked.rows[0]?.original) && linked.rows[0]?.corrects === linked.rows[0]?.original,
    linked.rows[0]?.corrects ?? '(not linked)')
  check('under the same number', linked.rows[0]?.same_number === true)

  // ---- And the books agree --------------------------------------------------
  const stock = await db.query(
    `SELECT coalesce(sum(m.qty_gram), 0)::float8 AS g
       FROM pc49.inventory_movement m
       JOIN pc49.gold_txn t ON t.id = m.source_id
      WHERE t.txn_date = $1`, [DAY])
  check('stock counts the correction once, not twice', stock.rows[0].g === 20, `${stock.rows[0].g} g`)

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
  check('and the inventory account nets to the corrected figure', cost.rows[0].v === 1200, `${cost.rows[0].v}`)

  await page.screenshot({ path: 'correct.png', fullPage: false })
} finally {
  await browser.close()
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself', r.txns === 0 && r.entries === 0 && r.partners === 0,
    `${r.txns} txns, ${r.entries} entries, ${r.partners} customers`)
  await db.end()
}

console.log(failures === 0 ? '\nALL CORRECTION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
