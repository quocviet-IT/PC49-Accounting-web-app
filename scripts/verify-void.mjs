// Cancels a transaction the way the accountant will, and checks the ledger kept
// up with it: the posting reversed rather than removed, the stock given back,
// and the month left with nothing in it.
//
//   npm run verify:void      (dev server up)
//
// Rewritten on 2026-09-15 for the ledger as it is now. Entry has been a form
// since 2026-09-10 (eabfb54), and a row is cancelled with its Huỷ icon, which
// asks for the reason in a dialog. The check before this one typed into the
// inline grid and answered a browser prompt, and could reach neither.
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

// A day far enough from anything real that this run cannot be mistaken for it.
const DAY = '2019-07-11'
const PERIOD = '2019-07'
const PARTNER = 'VERIFY-VOID'
const REASON = 'typed against the wrong customer'
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
  await db.query('UPDATE pc49.gold_txn SET corrects_txn_id = NULL WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_sales_person WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  await removeReceipts(db, DAY)
  // Unpost first: a posted entry's lines are immutable, which is the same road
  // the system forces on everyone else. Reversals go before the entries they
  // point at, or the foreign key refuses.
  await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL', [PERIOD])
  await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [PERIOD])
  await db.query('DELETE FROM pc49.gold_price_daily WHERE price_date = $1', [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
  // Saving a customer's name files them in the catalogue; this one is invented.
  await db.query(
    `DELETE FROM pc49.partner WHERE code = $1
       AND code NOT IN (SELECT DISTINCT partner_code FROM pc49.gold_txn WHERE partner_code IS NOT NULL)`,
    [PARTNER])
}

async function selectOption(page, form, label, option) {
  await form.getByLabel(label, { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: option }).first().click()
}

try {
  // A run that died halfway must not leave rows that confuse this one.
  await cleanUp()

  // A priced day, so the sale is costed and there is something on both sides to
  // reverse.
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'GRAIN', 139.20)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = 139.20`, [DAY])

  const kt = accountFor('KT')
  const page = await openPage(await browser.newContext({ viewport: { width: 1366, height: 900 } }))
  // A form with unsaved input asks the browser before leaving; say yes.
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await signIn(page, BASE, kt.email, kt.password)

  // ---- A sale, typed on the form ------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Thêm giao dịch' }).first().click()
  const form = page.getByRole('dialog', { name: 'Giao dịch mới', exact: true }).last()
  await form.waitFor()
  await selectOption(page, form, 'Loại', 'SALE')
  await selectOption(page, form, 'Loại vàng', 'Grain')
  // A sale takes gold out, so its quantity is negative and its amount positive.
  await form.getByLabel('Số lượng', { exact: true }).fill('-10')
  await form.getByLabel('Đơn giá', { exact: true }).fill('145')
  await form.getByLabel('Khách / NCC', { exact: true }).fill(PARTNER)
  await form.getByLabel('Số tiền', { exact: true }).first().fill('1450')
  await form.getByLabel('Ghi chú', { exact: true }).fill('to be cancelled')
  await form.getByRole('button', { name: 'Lưu', exact: true }).click()

  const saved = await untilRowIs(db,
    `SELECT id, journal_entry_id AS e, amount::float8 AS amount
       FROM pc49.gold_txn WHERE txn_date = $1 AND partner_code = $2`,
    [DAY, PARTNER], (r) => r.e !== null)
  check('the sale saved and posted', saved !== null && saved.amount === 1450,
    saved ? `${saved.amount}` : '(never posted)')
  if (!saved) throw new Error('nothing was saved to cancel')

  const before = await db.query(
    `SELECT amount::text AS a FROM pc49.pl_report($1) WHERE code = 'REV_TOTAL'`, [PERIOD])
  check('the month reports the revenue', Number(before.rows[0].a) === 1450, before.rows[0].a)

  // ---- Cancelled from its row ---------------------------------------------
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Huỷ', exact: true }).first().click()
  const ask = page.getByRole('dialog', { name: 'Huỷ giao dịch', exact: true }).last()
  await ask.waitFor()
  const confirm = ask.getByRole('button', { name: 'Huỷ giao dịch', exact: true })
  check('cancelling asks why before it can be confirmed', await confirm.isDisabled())
  await ask.getByLabel('Huỷ giao dịch này vì lý do gì? (bút toán sẽ được đảo, không xoá)', { exact: true })
    .fill(REASON)
  await confirm.click()

  const voided = await untilRowIs(db,
    'SELECT voided_at, void_reason AS r FROM pc49.gold_txn WHERE id = $1', [saved.id],
    (r) => r.voided_at !== null)
  check('the sale is cancelled, with the reason kept', voided?.r === REASON, voided?.r ?? '(not cancelled)')

  const after = await db.query(
    `SELECT amount::text AS a FROM pc49.pl_report($1) WHERE code = 'REV_TOTAL'`, [PERIOD])
  check('the month is left with nothing in it', Number(after.rows[0].a) === 0, after.rows[0].a)

  const entries = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.journal_entry
              WHERE id = $1 AND posted_at IS NOT NULL AND voided_at IS NULL) AS original,
            (SELECT count(*)::int FROM pc49.journal_entry
              WHERE reversal_of_id = $1 AND posted_at IS NOT NULL) AS reversals`,
    [saved.e])
  check('the original posting is still there, with a reversal beside it',
    entries.rows[0].original === 1 && entries.rows[0].reversals === 1,
    `original ${entries.rows[0].original}, reversals ${entries.rows[0].reversals}`)

  const movements = await db.query(
    `SELECT coalesce(sum(qty_gram), 0)::text AS g, count(*)::int AS n
       FROM pc49.inventory_movement WHERE source_id = $1`, [saved.id])
  check('the stock is given back as a movement, not removed',
    movements.rows[0].n === 2 && Number(movements.rows[0].g) === 0,
    `${movements.rows[0].n} movements netting ${movements.rows[0].g}`)

  const listed = await page.getByRole('button', { name: 'Huỷ', exact: true }).count()
  await page.goto(SCREEN, { waitUntil: 'networkidle' })
  check('and the ledger no longer lists it',
    (await page.getByRole('button', { name: 'Huỷ', exact: true }).count()) === 0, `${listed} before reload`)

  // The guard: the column cannot be set by hand, which is what used to leave the
  // ledger behind. It fires on the change from not-voided to voided, so it needs
  // a transaction that has not been voided yet.
  const fresh = await db.query(
    `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount)
     VALUES ($1, 'PO', 'SG', 'GRAM', 3, -200) RETURNING id`, [DAY])
  let refused = false
  try {
    await db.query(
      `UPDATE pc49.gold_txn SET voided_at = now(), void_reason = 'by hand' WHERE id = $1`,
      [fresh.rows[0].id])
  } catch (e) {
    refused = /void_gold_txn/.test(String(e.message))
  }
  check('a void written by hand is refused', refused)

  await page.screenshot({ path: 'void.png', fullPage: false })
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await cleanUp()
  const left = await db.query(
    `SELECT (SELECT count(*) FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*) FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*) FROM pc49.gold_price_daily WHERE price_date = $1) AS prices,
            (SELECT count(*) FROM pc49.partner WHERE code = $3) AS partners`,
    [DAY, PERIOD, PARTNER])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.entries, r.prices, r.partners].every((n) => Number(n) === 0),
    `${r.txns} txns, ${r.entries} entries, ${r.prices} prices, ${r.partners} customers`)
  await db.end()
}

console.log(failures === 0 ? '\nALL VOID CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
