// The transaction entry form, driven the way the accountant uses it.
//
//   npm run verify:grid      (dev server up)
//
// Replaces the check written for the inline entry grid, which went away on
// 2026-09-10 when entry became a form (eabfb54). That check also cleaned up by
// deleting every transaction on 2026-03-16 — a day inside the 2026 ledger that
// is about to be loaded for real. This one works on a day in 2019 and removes
// only the rows it wrote, by the partner it gave them.
//
// What it guards comes from one report. On 2026-09-06 somebody wrote that
// transactions entered on 05/09 and 06/09 were not there when they looked
// again. Nothing had been deleted: no save by that account ever reached the
// database. Tracing the form that replaced the grid turned up four ways the
// same thing can still happen — a payment typed without its method quietly
// dropped, a refusal from the database shown at the foot of a long dialog in
// English, what was typed thrown away on Esc, and (in development only) the
// default payment method missing altogether.
//
// Each block starts from a freshly loaded screen, so one failure does not
// take the checks after it down with it.
import pg from 'pg'
import { chromium } from 'playwright'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { removeReceipts } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const DAY = '2019-03-16'
const PARTNER = 'VERIFY-FORM'
const URL = `${BASE}/gold-transactions?date=${DAY}`
const VIEWPORT = { width: 1366, height: 900 }

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)}${detail}`)
}

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const written = async () => (await db.query(
  'SELECT count(*)::int AS n FROM pc49.gold_txn WHERE txn_date = $1 AND partner_code = $2',
  [DAY, PARTNER])).rows[0].n

/** Removes what this check wrote, and nothing else. */
async function cleanUp() {
  const made = await db.query(
    'SELECT id, journal_entry_id FROM pc49.gold_txn WHERE txn_date = $1 AND partner_code = $2',
    [DAY, PARTNER])
  for (const row of made.rows) {
    if (row.journal_entry_id) {
      await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE id = $1', [row.journal_entry_id])
      await db.query('DELETE FROM pc49.journal_line WHERE entry_id = $1', [row.journal_entry_id])
      await db.query('DELETE FROM pc49.audit_log WHERE entity_id = $1::text', [row.journal_entry_id])
    }
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [row.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [row.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [row.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [row.id])
    if (row.journal_entry_id) {
      await db.query('DELETE FROM pc49.journal_entry WHERE id = $1', [row.journal_entry_id])
    }
  }
  await removeReceipts(db, DAY, PARTNER)
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
}

await cleanUp()

const browser = await chromium.launch()
const page = await openPage(await browser.newContext({ viewport: VIEWPORT }))
// A form with unsaved input asks the browser to confirm leaving; each block
// reloads the screen on purpose, so say yes.
page.on('dialog', (d) => d.accept().catch(() => {}))
const kt = accountFor('KT')

// Exact names, and the newest match: in development React mounts a modal twice
// and a portal from the first mount can linger for a moment beside the second.
const dialogNamed = (name) => page.getByRole('dialog', { name, exact: true }).last()
const newForm = () => dialogNamed('Giao dịch mới')
const unsaved = () => dialogNamed('Giao dịch chưa lưu')

async function freshScreen() {
  await page.goto(URL, { waitUntil: 'networkidle' })
}
async function openForm() {
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  await newForm().waitFor()
  return newForm()
}
// The footer's Close, not the corner X: with the Vietnamese locale the X is also
// labelled "Đóng", and asking for the button named Đóng found both.
const closeButton = (form) =>
  form.locator('.ant-modal-footer').getByRole('button', { name: 'Đóng', exact: true })

async function selectOption(form, label, option) {
  await form.getByLabel(label, { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option }).first().click()
}
async function shownIn(form, label) {
  return form.evaluate((el, wanted) => {
    const item = [...el.querySelectorAll('.ant-form-item')]
      .find((it) => it.querySelector('label')?.textContent.trim() === wanted)
    return item?.querySelector('.ant-select')?.textContent.trim() ?? null
  }, label)
}
/** A complete scrap purchase, everything but the payment method touched. */
async function fillPurchase(form, { total = '250' } = {}) {
  await selectOption(form, 'Loại vàng', 'Vàng vụn')
  await form.getByLabel('Số lượng', { exact: true }).fill('4.5')
  await form.getByLabel('Thành tiền', { exact: true }).fill(total)
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  await form.getByLabel('Số tiền', { exact: true }).first().fill(total)
}
const purchases = () => page.evaluate(() => {
  const label = [...document.querySelectorAll('main span')].find((s) => s.textContent.trim() === 'Mua vào')
  return Number((label?.nextElementSibling?.textContent ?? '').replace(/,/g, ''))
})
async function block(name, fn) {
  try { await fn() } catch (e) { check(`${name}: ran to the end`, false, String(e).split('\n')[0].slice(0, 220)) }
}

try {
  await signIn(page, BASE, kt.email, kt.password)

  await block('default', async () => {
    await freshScreen()
    check('the screen opens on the day asked for',
      (await page.locator('.pc-date-input').first().inputValue()) === DAY)
    const form = await openForm()
    check('a new form offers cash as the payment method', (await shownIn(form, 'Hình thức')) === 'CASH',
      `shows "${await shownIn(form, 'Hình thức')}"`)
    await closeButton(form).click()
    await page.waitForTimeout(500)
    check('an untouched form closes without asking',
      !(await newForm().isVisible()) && !(await unsaved().isVisible()))
  })

  await block('empty', async () => {
    await freshScreen()
    const form = await openForm()
    await form.getByRole('button', { name: 'Lưu', exact: true }).click()
    await page.waitForTimeout(600)
    check('saving an empty form says what is missing', (await form.getByText('Chưa nhập').count()) > 0)
    check('and writes nothing', (await written()) === 0, `${await written()} row(s)`)
  })

  await block('method', async () => {
    await freshScreen()
    const form = await openForm()
    await fillPurchase(form)
    // A second way it was paid, typed without saying how.
    await form.getByRole('button', { name: 'Thêm hình thức thanh toán' }).click()
    await form.getByLabel('Số tiền', { exact: true }).nth(1).fill('100')
    await form.getByRole('button', { name: 'Lưu', exact: true }).click()
    await page.waitForTimeout(1500)
    check('a payment typed without its method is pointed out',
      (await form.getByText('Chọn hình thức thanh toán').count()) > 0)
    check('rather than dropped, and nothing is written', (await written()) === 0, `${await written()} row(s)`)
  })

  await block('save', async () => {
    await freshScreen()
    const before = await purchases()
    const form = await openForm()
    await fillPurchase(form)
    await form.getByRole('button', { name: 'Lưu', exact: true }).click()
    await form.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
    check('a complete purchase saves without choosing a method', !(await newForm().isVisible()))
    const saved = await db.query(
      'SELECT amount::text AS amount FROM pc49.gold_txn WHERE txn_date = $1 AND partner_code = $2',
      [DAY, PARTNER])
    check('the purchase is on the books, as money going out',
      saved.rows.length === 1 && Number(saved.rows[0].amount) === -250,
      saved.rows.map((r) => r.amount).join(', ') || '(nothing)')
    check('the screen says it was saved', (await page.getByText('Đã lưu').count()) > 0)
    let after = before
    for (let i = 0; i < 20 && after === before; i += 1) { await page.waitForTimeout(500); after = await purchases() }
    check('the day\'s purchases moved by exactly that row', after - before === 250, `${before} -> ${after}`)
  })

  await block('refusal', async () => {
    await freshScreen()
    const form = await openForm()
    await selectOption(form, 'Loại', 'DEPOSIT')
    await fillPurchase(form, { total: '10' })
    const rows = await written()
    await form.getByRole('button', { name: 'Lưu', exact: true }).click()
    // The answer comes back from the server; how long that takes varies, so wait
    // for it rather than for a fixed time that is sometimes too short.
    await form.locator('.ant-alert, .ant-form-item-explain-error').first()
      .waitFor({ timeout: 15000 }).catch(() => {})
    const message = form.getByText('quy tắc luồng vàng')
    const seen = (await message.count()) > 0
    const shown = seen ? '' : await form.evaluate((el) =>
      [...el.querySelectorAll('.ant-alert, .ant-form-item-explain-error')]
        .map((x) => x.textContent.trim()).join(' | ') || '(nothing shown)')
    check('a refusal from the books is said in Vietnamese', seen, shown.slice(0, 160))
    const box = seen ? await message.first().boundingBox() : null
    check('where it can be read without scrolling',
      Boolean(box) && box.y >= 0 && box.y + box.height <= VIEWPORT.height,
      box ? `y=${Math.round(box.y)}` : '(not shown)')
    check('and nothing is written', (await written()) === rows, `${await written()} row(s)`)
  })

  await block('unsaved', async () => {
    await freshScreen()
    const rows = await written()
    const form = await openForm()
    await form.getByLabel('Số lượng', { exact: true }).fill('1')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    const asked = await unsaved().isVisible()
    check('pressing Esc with something typed asks first', asked)
    check('and the form is still there behind the question', await newForm().isVisible())
    if (!asked) return
    await unsaved().getByRole('button', { name: 'Tiếp tục nhập' }).click()
    await page.waitForTimeout(400)
    check('keeping on leaves the form open', (await newForm().isVisible()) && !(await unsaved().isVisible()))
    check('with what was typed still in it',
      Number(await form.getByLabel('Số lượng', { exact: true }).inputValue()) === 1,
      await form.getByLabel('Số lượng', { exact: true }).inputValue())
    await closeButton(form).click()
    await page.waitForTimeout(400)
    check('the Close button asks too', await unsaved().isVisible())
    await unsaved().getByRole('button', { name: 'Bỏ, không lưu' }).click()
    await page.waitForTimeout(600)
    check('discarding closes the form', !(await newForm().isVisible()))
    check('and writes nothing', (await written()) === rows, `${await written()} row(s)`)
  })
} finally {
  await browser.close()
  await cleanUp()
  check('the check removed what it wrote', (await written()) === 0, `${await written()} row(s) left`)
  await db.end()
}

console.log(failures === 0 ? '\nALL TRANSACTION FORM CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
