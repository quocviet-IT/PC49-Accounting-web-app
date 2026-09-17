// Paying a receipt in instalments, and Transfer in the type list.
//
//   "Không có phân loại Transfer"
//   "Không lưu được đối với đơn chưa thanh toán hết. Thực tế vẫn sẽ có đơn
//    thanh toán 1 phần, còn nợ lại khách đợt sau thanh toán tiếp"
//
// TRANSFER is chosen in the type list and opens the conversion form. Then a
// purchase of 1,000.00 is saved with 300.00 paid; the ledger says 700.00 is
// owed and the Còn nợ filter finds it. 400.00 is paid by Zelle two days on,
// cancelled as typed in error, and the whole 700.00 paid in cash. A receipt
// with later payments on it is not cancelled.
//
//   npm run verify:settlement      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { untilRowIs } from './support/until.mjs'
import { removeReceipts, removeSettlements } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-06-10'
const PERIOD = '2019-06'
const PARTNER = 'verify-settlement seller'
const SCREEN = `${BASE}/gold-transactions?date=${DAY}`
const OWING = `${BASE}/gold-transactions?from=${DAY}&to=${DAY}&method=OWED`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes in its month, and the seller it invents. */
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
  await removeSettlements(db, PERIOD)
  await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL', [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
}

/** Clicks an option in whichever dropdown is open, scrolled to and pressed. */
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

const shown = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ')
const rows = (page) => page.locator('.ant-table-tbody tr.ant-table-row')
const owedOn = async (receiptId) => Number((await db.query(
  'SELECT pc49.gold_receipt_owed($1)::float8 AS o', [receiptId])).rows[0].o)

try {
  await cleanUp()

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- Transfer, from the type list ----------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('the ledger offers Transfer by that name',
    (await page.getByRole('button', { name: 'Transfer', exact: true }).count()) === 1)
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const typed = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await typed.waitFor()
  await choose(page, typed, 'Loại', 'TRANSFER (quy đổi vàng)')
  const transfer = page.getByRole('dialog', { name: 'Transfer — quy đổi vàng', exact: true }).last()
  await transfer.waitFor({ timeout: 10_000 }).catch(() => {})
  check('choosing TRANSFER opens the conversion form', await transfer.isVisible())
  check('in place of the receipt form',
    (await page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).count()) === 0)
  await transfer.getByRole('button', { name: 'Đóng', exact: true }).first().click()

  // ---- A purchase, 300.00 of 1,000.00 paid ---------------------------------
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  const item = form.getByRole('group', { name: 'Món 1', exact: true })
  await item.getByLabel('Mô tả món', { exact: true }).fill('Thoi Grain')
  await choose(page, item, 'Loại vàng', 'Vàng Grain')
  await item.getByLabel('Số lượng', { exact: true }).fill('10')
  await item.getByLabel('Tuổi vàng (0–1)', { exact: true }).fill('0.999')
  await item.getByLabel('Thành tiền', { exact: true }).fill('1000')
  const settle = form.locator('section[aria-labelledby="txn-settle-heading"]')
  await settle.getByLabel('Số tiền', { exact: true }).first().fill('300')
  check('the form says what will still be owed', (await shown(settle)).includes('Còn nợ 700.00'))
  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const saved = await untilRowIs(db,
    `SELECT r.id, r.doc_no, count(t.journal_entry_id)::int AS posted,
            (SELECT coalesce(sum(jl.amount_usd), 0)::float8
               FROM pc49.gold_txn x JOIN pc49.journal_line jl ON jl.entry_id = x.journal_entry_id
              WHERE x.receipt_id = r.id AND jl.credit_account = '331') AS owed
       FROM pc49.gold_receipt r JOIN pc49.gold_txn t ON t.receipt_id = r.id
      WHERE r.txn_date = $1 AND r.partner_code = $2 AND r.voided_at IS NULL
      GROUP BY r.id`, [DAY, PARTNER], (r) => r.posted === 1)
  check('a purchase paid in part saves and posts', saved !== null, saved ? saved.doc_no : '(nothing posted)')
  if (!saved) throw new Error('the receipt did not save')
  check('owing the seller 700.00', saved.owed === 700, `${saved.owed}`)

  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('the ledger row says what is owed', (await shown(rows(page).first())).includes('Còn nợ 700.00'))
  await page.goto(OWING, { waitUntil: 'networkidle' })
  check('the Còn nợ filter finds it', (await rows(page).count()) === 1, `${await rows(page).count()} rows`)

  // ---- 400.00 by Zelle, two days on ----------------------------------------
  const openPayments = async () => {
    await rows(page).first().getByRole('button', { name: 'Thanh toán tiếp', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: `Thanh toán tiếp — ${saved.doc_no}`, exact: true }).last()
    await dialog.waitFor()
    return dialog
  }
  let pay = await openPayments()
  await pay.getByLabel('Ngày trả', { exact: true }).fill('2019-06-12')
  await pay.getByLabel('Số tiền', { exact: true }).fill('400')
  await choose(page, pay, 'Hình thức', 'ZELLE')
  await pay.getByRole('button', { name: 'Lưu lần trả', exact: true }).click()

  const later = await untilRowIs(db,
    `SELECT s.id, e.entry_date::text AS day, jl.debit_account AS dr, jl.credit_account AS cr,
            jl.amount_usd::float8 AS amount
       FROM pc49.gold_receipt_settlement s
       JOIN pc49.journal_entry e ON e.id = s.journal_entry_id
       JOIN pc49.journal_line jl ON jl.entry_id = e.id
      WHERE s.receipt_key = $1 AND s.voided_at IS NULL`, [saved.id], (r) => r.amount === 400)
  check('the later payment posts on its own day, against the seller',
    later !== null && later.day === '2019-06-12' && later.dr === '331' && later.cr === '1121ZL',
    later ? `${later.day} ${later.dr}/${later.cr} ${later.amount}` : '(nothing posted)')
  check('and 300.00 is owed', (await owedOn(saved.id)) === 300, `${await owedOn(saved.id)}`)

  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  const paidRow = await shown(rows(page).first())
  check('the row lists the payment with its day, and what is left',
    paidRow.includes('400.00 ZELLE · 2019-06-12') && paidRow.includes('Còn nợ 300.00'), paidRow.slice(0, 200))

  // ---- Typed in error: cancelled -------------------------------------------
  pay = await openPayments()
  await pay.getByRole('button', { name: 'Huỷ lần trả này', exact: true }).click()
  await pay.getByLabel('Lý do huỷ lần trả này', { exact: true }).fill('Nhap nham so tien')
  await pay.getByRole('button', { name: 'Huỷ lần trả', exact: true }).click()
  const undone = await untilRowIs(db,
    `SELECT voided_at IS NOT NULL AS voided, reversal_entry_id IS NOT NULL AS reversed
       FROM pc49.gold_receipt_settlement WHERE id = $1`, [later?.id], (r) => r.voided)
  check('cancelling the payment reverses it', undone !== null && undone.reversed)
  check('and 700.00 is owed again', (await owedOn(saved.id)) === 700, `${await owedOn(saved.id)}`)

  // ---- The rest, in cash ---------------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  pay = await openPayments()
  await pay.getByLabel('Ngày trả', { exact: true }).fill('2019-06-15')
  await pay.getByRole('button', { name: 'Lưu lần trả', exact: true }).click()
  const settled = await untilRowIs(db,
    `SELECT pc49.gold_receipt_owed($1)::float8 AS owed`, [saved.id], (r) => r.owed === 0)
  check('paying the rest leaves nothing owed', settled !== null)
  await page.goto(OWING, { waitUntil: 'networkidle' })
  check('and the Còn nợ filter no longer finds it', (await rows(page).count()) === 0)

  // ---- Not cancelled with payments on it -----------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await rows(page).first().getByRole('button', { name: 'Huỷ', exact: true }).click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiem tra huy phieu da tra sau')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  await page.getByText(/lần thanh toán tiếp/).first().waitFor({ timeout: 10_000 }).catch(() => {})
  check('a receipt with later payments is not cancelled, and says why',
    (await page.getByText(/lần thanh toán tiếp/).count()) > 0)
  const still = await db.query('SELECT voided_at IS NULL AS live FROM pc49.gold_receipt WHERE id = $1', [saved.id])
  check('it is still in the books', still.rows[0]?.live === true)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date = $1) AS receipts,
            (SELECT count(*)::int FROM pc49.gold_receipt_settlement
              WHERE to_char(pay_date, 'YYYY-MM') = $2) AS payments,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.receipts, r.payments, r.entries, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.receipts} receipts, ${r.payments} payments, ${r.entries} entries, ${r.partners} partners`)
  await db.end()
}

console.log(failures === 0 ? '\nALL SETTLEMENT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
