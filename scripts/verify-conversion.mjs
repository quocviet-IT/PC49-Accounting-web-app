// Converting gold, typed the way the counter asked for it.
//
//   "cai transfer dau?"
//
// The exchange with Nini from 08-05, entered whole: 4 luong of Rong Phung out;
// 2 oz Credit Suisse, 1 oz other gold and 56.7 g of Grain in. The form weighs
// the two sides as they are typed and asks for a reason when they do not meet.
// Then the ledger is read (one row, the legs beneath by side), the stock is
// checked (nothing sent to the refinery), and the conversion is corrected (the
// ounce of other gold made up in Grain) and cancelled.
//
//   npm run verify:conversion      (a server up; PC49_BASE_URL for Production)
//
// Everything this writes is removed at the end.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { until, untilRowIs } from './support/until.mjs'
import { removeConversions } from './support/receipts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

// Far from the demo fortnight and from anything real.
const DAY = '2019-05-20'
const PERIOD = '2019-05'
const PARTNER = 'verify-conversion partner'
const SCREEN = `${BASE}/gold-transactions?date=${DAY}`

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(60)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Removes what this check writes on its day, and the partner it invents. */
async function cleanUp() {
  const txns = await db.query('SELECT id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  await db.query('UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  await removeConversions(db, DAY)
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

const group = (form, name) => form.getByRole('group', { name, exact: true })
const legs = (form, side) => form.getByRole('group', { name: new RegExp(`^${side} \\d+$`) })
const shown = async (locator) => ((await locator.textContent()) ?? '').replace(/\s+/g, ' ')
const conversionsOnDay = async () => (await db.query(
  'SELECT count(*)::int AS n FROM pc49.gold_conversion WHERE conv_date = $1', [DAY])).rows[0].n

try {
  await cleanUp()

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 1000 } }))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- The exchange, typed once --------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Transfer', exact: true }).first().click()
  const form = page.getByRole('dialog', { name: 'Transfer — quy đổi vàng', exact: true }).last()
  await form.waitFor()
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  await form.getByLabel('Ghi chú', { exact: true }).fill('Doi voi Nini')

  const out1 = group(form, 'Ra 1')
  await choose(page, out1, 'Loại vàng', 'Rồng Phụng')
  await out1.getByLabel('Số lượng', { exact: true }).fill('4')

  const ins = [['Credit Suisse', '2'], ['Vàng khác', '1'], ['Vàng Grain', '50']]
  for (const [i, [gold, qty]] of ins.entries()) {
    if (i > 0) await form.getByRole('button', { name: 'Thêm dòng vào' }).click()
    const line = group(form, `Vào ${i + 1}`)
    await line.waitFor()
    await choose(page, line, 'Loại vàng', gold)
    await line.getByLabel('Số lượng', { exact: true }).fill(qty)
  }

  // 50 g of Grain where there were 56.7: 4.46 percent short.
  const reason = form.getByLabel('Lý do lệch', { exact: true })
  check('weights that do not meet ask for a reason', (await reason.count()) === 1)
  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()
  await page.waitForTimeout(1500)
  check('and nothing is saved without one', (await conversionsOnDay()) === 0,
    `${await conversionsOnDay()} conversion(s)`)

  await group(form, 'Vào 3').getByLabel('Số lượng', { exact: true }).fill('56.7')
  check('weights that meet ask for nothing', (await form.getByLabel('Lý do lệch', { exact: true }).count()) === 0)
  check('and the form says they balance', (await shown(form)).includes('Cân'))

  await form.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const saved = await untilRowIs(db,
    `SELECT c.id, c.doc_no, c.variance_note, count(t.id)::int AS legs,
            count(t.journal_entry_id)::int AS posted, count(DISTINCT t.doc_no)::int AS numbers
       FROM pc49.gold_conversion c JOIN pc49.gold_txn t ON t.conversion_id = c.id
      WHERE c.conv_date = $1 AND c.voided_at IS NULL
      GROUP BY c.id`, [DAY], (r) => r.posted === 4)
  check('one conversion saves, its four legs posted', saved !== null,
    saved ? `${saved.doc_no}, ${saved.legs} legs` : '(nothing posted)')
  if (!saved) throw new Error('the conversion did not save')
  check('under one number', saved.numbers === 1)
  check('within the tolerance, so no variance is noted', saved.variance_note === null)

  const stock = await db.query(
    `SELECT count(*) FILTER (WHERE m.bucket = 'AT_REFINERY')::int AS refinery,
            coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'ON_HAND'), 0)::float8 AS on_hand
       FROM pc49.inventory_movement m JOIN pc49.gold_txn t ON t.id = m.source_id
      WHERE t.conversion_id = $1`, [saved.id])
  check('nothing is sent to the refinery', stock.rows[0].refinery === 0, `${stock.rows[0].refinery}`)
  check('and the vault holds 0.015 g more, as weighed', Math.abs(stock.rows[0].on_hand - 0.015) < 0.0005,
    `${stock.rows[0].on_hand} g`)

  // ---- One row in the ledger -----------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  const rows = page.locator('.ant-table-tbody tr.ant-table-row')
  check('the ledger lists the conversion once', (await rows.count()) === 1, `${await rows.count()} rows`)
  const row = rows.first()
  const rowText = await shown(row)
  check('as a conversion, one line out into three in',
    rowText.includes('TRANSFER') && rowText.includes('Nhiều loại (1 ra → 3 vào)'), rowText.slice(0, 160))
  check('moving 150 grams', rowText.includes('150.00 g'))
  await row.locator('.ant-table-row-expand-icon').click()
  const expanded = page.locator('.ant-table-expanded-row').first()
  await expanded.waitFor()
  const legsText = await shown(expanded)
  check('and its legs open beneath it, by side', legsText.includes('Ra 1') && legsText.includes('Vào 3'))

  // ---- Corrected: the ounce of other gold was Grain after all --------------
  await page.getByRole('button', { name: 'Sửa', exact: true }).first().click()
  const fix = page.getByRole('dialog', { name: 'Sửa transfer', exact: true }).last()
  await fix.waitFor()
  check('the correction opens holding every leg',
    (await legs(fix, 'Ra').count()) === 1 && (await legs(fix, 'Vào').count()) === 3)
  await group(fix, 'Vào 2').getByRole('button', { name: 'Bỏ dòng này' }).click()
  await until(async () => ((await legs(fix, 'Vào').count()) === 2 ? true : null))
  await fix.getByRole('button', { name: 'Thêm dòng vào' }).click()
  const added = group(fix, 'Vào 3')
  await added.waitFor()
  await choose(page, added, 'Loại vàng', 'Vàng Grain')
  await added.getByLabel('Số lượng', { exact: true }).fill('31.105')
  await fix.getByLabel('Lý do sửa', { exact: true }).fill('1 oz khac la Grain')
  await fix.getByRole('button', { name: 'Lưu', exact: true }).first().click()

  const fixed = await untilRowIs(db,
    `SELECT c.id, c.doc_no, c.corrects_conversion_id AS corrects, count(t.journal_entry_id)::int AS posted
       FROM pc49.gold_conversion c JOIN pc49.gold_txn t ON t.conversion_id = c.id
      WHERE c.conv_date = $1 AND c.voided_at IS NULL
      GROUP BY c.id`, [DAY], (r) => r.corrects === saved.id && r.posted === 4)
  check('the corrected conversion has four legs, posted', fixed !== null, fixed ? '' : '(not corrected)')
  if (!fixed) throw new Error('the correction did not save')
  check('and keeps its number', fixed.doc_no === saved.doc_no, fixed.doc_no)
  const old = await db.query(
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_conversion WHERE id = $1) AS conversion,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE conversion_id = $1 AND voided_at IS NULL) AS live`,
    [saved.id])
  check('the original is cancelled, every leg of it',
    old.rows[0].conversion === true && old.rows[0].live === 0, `${old.rows[0].live} live legs`)

  // ---- Cancelled -----------------------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Huỷ', exact: true }).first().click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill('Kiểm tra huỷ cả phiên')
  await ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true }).click()
  const cancelled = await untilRowIs(db,
    `SELECT (SELECT voided_at IS NOT NULL FROM pc49.gold_conversion WHERE id = $1) AS conversion,
            (SELECT count(*)::int FROM pc49.gold_txn WHERE conversion_id = $1 AND voided_at IS NULL) AS live`,
    [fixed.id], (r) => r.conversion === true && r.live === 0)
  check('cancelling takes every leg off the books at once', cancelled !== null)
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('and the ledger lists nothing for the day',
    (await page.locator('.ant-table-tbody tr.ant-table-row').count()) === 0)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.gold_conversion WHERE conv_date = $1) AS conversions,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.conversions, r.entries, r.partners].every((n) => n === 0),
    `${r.txns} txns, ${r.conversions} conversions, ${r.entries} entries, ${r.partners} partners`)
  await db.end()
}

console.log(failures === 0 ? '\nALL CONVERSION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
