// A deposit taken, and picked up from its own row.
//
//   "Deposit gặp lỗi giống cái thứ 2 phải thanh toán"
//   "Khi pickup không chỉnh sửa được trạng thái từ deposit sang pickup, cũng
//    chưa có trường dữ liệu để phân biệt ngày nào đặt cọc, ngày nào pickup"
//
// One luong of Rong Phung is ordered at 5,300.00 with 1,000.00 down, the
// quantity typed without a sign. A second order is taken with nothing down.
// A week on the first is picked up from its row with 3,000.00 paid: the pickup
// has its own day and number, the deposit says when it was collected, and
// 1,300.00 is owed. The pickup is cancelled and the deposit waits again.
//
//   npm run verify:deposit      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { untilRowIs } from './support/until.mjs'
import { removeSettlements } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-07-08'
const PICKUP_DAY = '2019-07-15'
const PERIOD = '2019-07'
const PARTNER = 'verify-deposit customer'
const MONTH = `${BASE}/gold-transactions?from=2019-07-01&to=2019-07-31`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes in its month, and the customer it invents. */
async function cleanUp() {
  const inMonth = `txn_date >= '2019-07-01' AND txn_date < '2019-08-01'`
  const txns = await db.query(`SELECT id FROM pc49.gold_txn WHERE ${inMonth}`)
  await db.query(`UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE ${inMonth}`)
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
  }
  // A pickup must name its deposit (0013), so pickups go before deposits
  // rather than being unhooked from them.
  await db.query(`DELETE FROM pc49.gold_txn WHERE ${inMonth} AND deposit_ref_id IS NOT NULL`)
  await db.query(`DELETE FROM pc49.gold_txn WHERE ${inMonth}`)
  await db.query(`UPDATE pc49.gold_receipt SET corrects_receipt_id = NULL WHERE ${inMonth}`)
  await db.query(`DELETE FROM pc49.gold_receipt WHERE ${inMonth}`)
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'gold_receipt'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.gold_receipt)`)
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
// By the number in its own column: a deposit's row also names its pickup's
// number, and the pickup's names the deposit's.
const rowOf = (page, doc) => rows(page)
  .filter({ has: page.locator('td').filter({ hasText: new RegExp(`^${doc}$`) }) }).first()

/** A deposit of one luong of Rong Phung at 5,300.00, typed on the entry form. */
async function typeDeposit(page, down, remarks) {
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Ngày', { exact: true }).fill(DAY)
  await form.getByLabel('Loại', { exact: true }).click()
  const offersPickup = await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: /^PICKUP$/ }).count()
  await pickOption(page, 'DEPOSIT')
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  const item = form.getByRole('group', { name: 'Món 1', exact: true })
  await choose(page, item, 'Loại vàng', 'Rong Phung')
  await item.getByLabel('Số lượng', { exact: true }).fill('1')
  await item.getByLabel('Thành tiền', { exact: true }).fill('5300')
  const settle = form.locator('section[aria-labelledby="txn-settle-heading"]')
  if (down > 0) await settle.getByLabel('Số tiền', { exact: true }).first().fill(String(down))
  await form.getByLabel('Ghi chú', { exact: true }).fill(remarks)
  const said = await shown(settle)
  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()
  return { offersPickup, said }
}

try {
  await cleanUp()

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)
  await page.goto(MONTH, { waitUntil: 'networkidle' })

  // ---- A deposit, 1,000.00 down --------------------------------------------
  const first = await typeDeposit(page, 1000, 'coc 1000')
  check('the type list no longer offers PICKUP on its own', first.offersPickup === 0)
  check('the form says what is left to pay at pickup', first.said.includes('Còn lại 4,300.00'), first.said.slice(0, 160))
  const deposit = await untilRowIs(db,
    `SELECT t.id, t.receipt_id, t.doc_no, t.qty::float8 AS qty, t.amount::float8 AS amount,
            t.journal_entry_id IS NOT NULL AS posted
       FROM pc49.gold_txn t
      WHERE t.txn_date = $1 AND t.partner_code = $2 AND t.remarks = 'coc 1000' AND t.voided_at IS NULL`,
    [DAY, PARTNER], (r) => r.posted)
  check('the deposit saves and posts', deposit !== null, deposit ? deposit.doc_no : '(nothing saved)')
  if (!deposit) throw new Error('the deposit did not save')
  check('with the quantity going out, typed without a sign', deposit.qty === -1, `${deposit.qty}`)
  check('at the order’s value', deposit.amount === 5300, `${deposit.amount}`)

  // ---- A deposit with nothing down -----------------------------------------
  await page.goto(MONTH, { waitUntil: 'networkidle' })
  await typeDeposit(page, 0, 'coc 0')
  const free = await untilRowIs(db,
    `SELECT t.id, t.journal_entry_id IS NULL AS unposted
       FROM pc49.gold_txn t
      WHERE t.txn_date = $1 AND t.partner_code = $2 AND t.remarks = 'coc 0' AND t.voided_at IS NULL`,
    [DAY, PARTNER], () => true)
  check('a deposit with nothing down saves, with nothing on the books', free !== null && free.unposted)

  // ---- Picked up a week on, 3,000.00 paid ----------------------------------
  await page.goto(MONTH, { waitUntil: 'networkidle' })
  const waiting = await shown(rowOf(page, deposit.doc_no))
  check('the deposit waits, and says what is left', waiting.includes('Chờ lấy hàng') && waiting.includes('Còn lại 4,300.00'),
    waiting.slice(0, 200))
  await rowOf(page, deposit.doc_no).getByRole('button', { name: 'Lấy hàng', exact: true }).click()
  const pick = page.getByRole('dialog', { name: `Lấy hàng — ${deposit.doc_no}`, exact: true }).last()
  await pick.waitFor()
  check('the pickup shows the order from its deposit',
    (await shown(pick)).includes('5,300.00') && (await shown(pick)).includes('4,300.00'))
  await pick.getByLabel('Ngày lấy', { exact: true }).fill(PICKUP_DAY)
  await pick.getByLabel('Số tiền', { exact: true }).first().fill('3000')
  check('paying less says what will be owed', (await shown(pick)).includes('Còn nợ 1,300.00'))
  await pick.getByRole('button', { name: 'Lưu', exact: true }).click()

  const pickup = await untilRowIs(db,
    `SELECT p.id, p.receipt_id, p.doc_no, p.txn_date::text AS day, p.amount::float8 AS amount,
            p.journal_entry_id IS NOT NULL AS posted,
            pc49.gold_receipt_owed(coalesce(p.receipt_id, p.id))::float8 AS owed
       FROM pc49.gold_txn p WHERE p.deposit_ref_id = $1 AND p.voided_at IS NULL`,
    [deposit.id], (r) => r.posted)
  check('the pickup saves on its own day, pointing at the deposit',
    pickup !== null && pickup.day === PICKUP_DAY, pickup ? `${pickup.doc_no} ${pickup.day}` : '(nothing saved)')
  if (!pickup) throw new Error('the pickup did not save')
  check('under its own number', pickup.doc_no !== deposit.doc_no)
  check('for the whole order, 1,300.00 still owed', pickup.amount === 5300 && pickup.owed === 1300,
    `${pickup.amount} / ${pickup.owed}`)

  await page.goto(MONTH, { waitUntil: 'networkidle' })
  const collected = await shown(rowOf(page, deposit.doc_no))
  check('the deposit says when it was picked up', collected.includes(`Đã lấy ${PICKUP_DAY}`), collected.slice(0, 200))
  const pickupRow = await shown(rowOf(page, pickup.doc_no))
  check('the pickup says when the deposit was taken, and what is owed',
    pickupRow.includes(`Cọc ${DAY}`) && pickupRow.includes('Còn nợ 1,300.00'), pickupRow.slice(0, 200))

  // ---- The pickup cancelled: the deposit waits again -----------------------
  await rowOf(page, pickup.doc_no).getByRole('button', { name: 'Huỷ', exact: true }).click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiem tra huy lay hang')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  const reopened = await untilRowIs(db,
    `SELECT count(*)::int AS live FROM pc49.gold_txn WHERE deposit_ref_id = $1 AND voided_at IS NULL`,
    [deposit.id], (r) => r.live === 0)
  check('cancelling the pickup takes it off the books', reopened !== null)
  await page.goto(MONTH, { waitUntil: 'networkidle' })
  check('and the deposit waits again', (await shown(rowOf(page, deposit.doc_no))).includes('Chờ lấy hàng'))
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date >= '2019-07-01' AND txn_date < '2019-08-01') AS txns,
            (SELECT count(*)::int FROM pc49.gold_receipt WHERE txn_date >= '2019-07-01' AND txn_date < '2019-08-01') AS receipts,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $1) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $2) AS partners`,
    [PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.receipts, r.entries, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.receipts} receipts, ${r.entries} entries, ${r.partners} partners`)
  await db.end()
}

console.log(failures === 0 ? '\nALL DEPOSIT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
