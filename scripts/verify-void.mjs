// Cancels a transaction the way the accountant will, and checks the ledger kept
// up with it: the posting reversed rather than removed, the stock given back,
// and the month left with nothing in it.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)}${detail}`)
}

// A day far enough from anything real that this run cannot be mistaken for it.
const DAY = '2019-07-11'
const PERIOD = '2019-07'

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

try {
  // A priced day, so the sale is costed and there is something on both sides to
  // reverse.
  await db.query(
    `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
     VALUES ($1, 'GRAIN', 139.20)
     ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = 139.20`, [DAY])

  const page = await browser.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
  await page.fill('input[autocomplete="current-password"]', 'pc49-test-KT-2026')
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 20000 })

  // Type a sale, the way the grid is used.
  await page.goto(`${BASE}/gold-transactions?date=${DAY}`, { waitUntil: 'networkidle' })
  const row = page.locator('tbody tr').last()
  await row.getByLabel('Loại', { exact: true }).selectOption('SALE')
  await row.getByLabel('Loại vàng', { exact: true }).selectOption('GRAIN')
  await row.getByLabel('Số lượng', { exact: true }).fill('-10')
  await row.getByLabel('Đơn giá', { exact: true }).fill('145')
  await row.getByLabel('Thanh toán 1', { exact: true }).fill('1450')
  await row.getByLabel('Ghi chú', { exact: true }).fill('to be cancelled')
  await row.getByLabel('Ghi chú', { exact: true }).press('Enter')
  await page.waitForTimeout(2500)

  const saved = await db.query(
    `SELECT id, journal_entry_id FROM pc49.gold_txn WHERE txn_date = $1`, [DAY])
  check('the sale saved and posted', saved.rows.length === 1 && !!saved.rows[0].journal_entry_id)
  const txnId = saved.rows[0]?.id

  const before = await db.query(
    `SELECT amount::text AS a FROM pc49.pl_report($1) WHERE code = 'REV_TOTAL'`, [PERIOD])
  check('the month reports the revenue', Number(before.rows[0].a) === 1450, before.rows[0].a)

  // Cancel it from the screen. The reason is asked for in a prompt.
  await page.reload({ waitUntil: 'networkidle' })
  page.once('dialog', (d) => d.accept('typed against the wrong customer'))
  await page.locator('button', { hasText: 'Huỷ' }).first().click()
  await page.waitForTimeout(2800)

  const after = await db.query(
    `SELECT amount::text AS a FROM pc49.pl_report($1) WHERE code = 'REV_TOTAL'`, [PERIOD])
  check('the month is left with nothing in it', Number(after.rows[0].a) === 0, after.rows[0].a)

  const entries = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.journal_entry
              WHERE id = $1 AND posted_at IS NOT NULL AND voided_at IS NULL) AS original,
            (SELECT count(*)::int FROM pc49.journal_entry
              WHERE reversal_of_id = $1 AND posted_at IS NOT NULL) AS reversals`,
    [saved.rows[0].journal_entry_id])
  check('the original posting is still there, with a reversal beside it',
    entries.rows[0].original === 1 && entries.rows[0].reversals === 1,
    `original ${entries.rows[0].original}, reversals ${entries.rows[0].reversals}`)

  const movements = await db.query(
    `SELECT coalesce(sum(qty_gram), 0)::text AS g, count(*)::int AS n
       FROM pc49.inventory_movement WHERE source_id = $1`, [txnId])
  check('the stock is given back as a movement, not removed',
    movements.rows[0].n === 2 && Number(movements.rows[0].g) === 0,
    `${movements.rows[0].n} movements netting ${movements.rows[0].g}`)

  const voided = await db.query(
    `SELECT void_reason AS r FROM pc49.gold_txn WHERE id = $1`, [txnId])
  check('the reason is recorded', voided.rows[0].r === 'typed against the wrong customer',
    voided.rows[0].r ?? '(none)')

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
  const txns = await db.query('SELECT id, journal_entry_id FROM pc49.gold_txn WHERE txn_date = $1', [DAY])
  for (const t of txns.rows) {
    await db.query('DELETE FROM pc49.inventory_movement WHERE source_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1', [t.id])
    await db.query('DELETE FROM pc49.gold_txn WHERE id = $1', [t.id])
  }
  // Unpost first: a posted entry's lines are immutable, which is the same road
  // the system forces on everyone else. Reversals go before the entries they
  // point at, or the foreign key refuses.
  await db.query(`UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.gold_price_daily WHERE price_date = $1`, [DAY])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)

  const left = await db.query(
    `SELECT (SELECT count(*) FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*) FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*) FROM pc49.gold_price_daily WHERE price_date = $1) AS prices`,
    [DAY, PERIOD])
  const r = left.rows[0]
  check('the check cleaned up after itself',
    [r.txns, r.entries, r.prices].every((n) => Number(n) === 0),
    `${r.txns} txns, ${r.entries} entries, ${r.prices} prices`)
  await db.end()
}

console.log(failures === 0 ? '\nALL VOID CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
