// Loads a small batch the way the accountant will, against the real database:
// stage rows, look at what was turned back and why, commit the rest, and watch
// the reconciliation go from disagreeing to agreeing.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import pg from 'pg'
import { expect } from 'playwright/test'
import { untilRowIs } from './support/until.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}`)
}

// A date far enough from anything real that this run cannot be mistaken for it.
const AS_OF = '2019-09-30'
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

let batchId = null
const browser = await chromium.launch()

try {
  const { rows } = await db.query(
    `INSERT INTO pc49.import_batch (source, file_name, note)
     VALUES ('OPENING_INVENTORY', 'verify-import.xlsx', 'automated check') RETURNING id`)
  batchId = rows[0].id

  const staged = [
    [1, { as_of: AS_OF, gold_type_code: 'PT', qty: '120' }],
    [2, { as_of: AS_OF, gold_type_code: 'SG', qty: '80' }],
    [3, { as_of: AS_OF, gold_type_code: 'SG', qty: '#REF!' }],
    [4, { as_of: AS_OF, gold_type_code: 'NOTAGOLD', qty: '5' }],
  ]
  for (const [no, payload] of staged) {
    await db.query('SELECT pc49.stage_import_row($1, $2, $3::jsonb)',
      [batchId, no, JSON.stringify(payload)])
  }

  const counts = await db.query(
    `SELECT valid_count, rejected_count FROM pc49.v_import_batch_summary WHERE batch_id = $1`,
    [batchId])
  check('the database judges the rows as they are staged',
    Number(counts.rows[0].valid_count) === 2 && Number(counts.rows[0].rejected_count) === 2,
    `${counts.rows[0].valid_count} good, ${counts.rows[0].rejected_count} turned back`)

  const page = await openPage(browser)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
  await page.fill('input[autocomplete="current-password"]', 'pc49-test-KT-2026')
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 60000 })

  // Import is occasional work, so it sits behind Settings rather than on the
  // bar, where it was being pushed off the end into an overflow menu.
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  const hub = (await page.locator('body').textContent()) ?? ''
  check('the accountant reaches the import screen from settings',
    hub.includes('Nạp dữ liệu'))

  // What the source says this date closed at, stated from the screen. PT agrees
  // with what is being loaded; SG deliberately does not, so a real difference
  // has to show. Until this control existed the comparison could only be set up
  // in SQL — the reconciliation was testable and unusable.
  await page.goto(`${BASE}/import?asOf=${AS_OF}`, { waitUntil: 'networkidle' })
  // Opened once: the panel stays open after a save, which is right — figures
  // are stated several at a time, from one sheet.
  await page.locator('button', { hasText: 'Khai con số bảng tính' }).first().click()
  for (const [key, figure] of [['PT', '120'], ['SG', '95']]) {
    const keyField = page.getByLabel('Mã', { exact: true })
    // The panel clears itself after a save, so the next entry has to wait for
    // that to have happened — typing into a field a pending refresh is about to
    // blank means saving nothing.
    await expect(keyField).toHaveValue('')
    await keyField.fill(key)
    await page.getByLabel('Bảng tính', { exact: true }).fill(figure)
    await page.getByLabel('Lấy từ sheet nào', { exact: true }).fill('verify-import')
    await page.getByRole('button', { name: 'Lưu', exact: true }).click()
    await untilRowIs(db,
      `SELECT expected::text AS e FROM pc49.import_expected_figure
        WHERE as_of = $1 AND metric_key = $2`, [AS_OF, key],
      (r) => Number(r.e) === Number(figure))
  }
  const stated = await db.query(
    `SELECT metric_key AS k, expected::text AS e FROM pc49.import_expected_figure
      WHERE as_of = $1 ORDER BY metric_key`, [AS_OF])
  check('the expected figures can be stated from the screen',
    stated.rows.length === 2 && Number(stated.rows[0].e) === 120
      && Number(stated.rows[1].e) === 95,
    stated.rows.map((r) => `${r.k}=${r.e}`).join(' '))

  // The loader takes a file now, rather than only SQL. Staging one here proves
  // the front door works and that a bad row is judged on the way in.
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' })
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const stagedFile = join(mkdtempSync(join(tmpdir(), 'pc49-')), 'opening.csv')
  // Two rows: one the loader can take, one naming a gold type that does not
  // exist, so the judgement on the way in is visible.
  writeFileSync(stagedFile, [
    'as_of,gold_type_code,qty',
    `${AS_OF},ML,4`,
    `${AS_OF},NOTAGOLD,9`,
  ].join('\n'), 'utf8')
  await page.selectOption('#stage-source', 'OPENING_INVENTORY')
  await page.locator('input[type="file"]').setInputFiles(stagedFile)
  // Wait for the outcome, not for a stopwatch. The pattern needs the count in
  // front of it: "Số dòng" on its own is also a column heading that is always
  // on the page, so waiting for that returns instantly and reads too early.
  await page.getByText(/\d+ Số dòng · /).first()
    .waitFor({ state: 'visible', timeout: 20000 })
  const stagedSaid = (await page.locator('body').textContent()) ?? ''
  check('a file can be staged from the screen, and is judged on the way in',
    /2 Số dòng/.test(stagedSaid) && /1 Nhận được/.test(stagedSaid) && /1 Bị loại/.test(stagedSaid),
    stagedSaid.match(/\d+ (Số dòng|Nhận được|Bị loại)/g)?.join(' · ') ?? '(nothing said)')

  const fromFile = await db.query(
    `SELECT count(*)::int AS n FROM pc49.import_row r
       JOIN pc49.import_batch b ON b.id = r.batch_id
      WHERE b.file_name = 'opening.csv' AND r.row_no IN (2, 3)`)
  check('the sheet line number is what gets recorded', fromFile.rows[0].n === 2,
    `${fromFile.rows[0].n} rows`)

  await page.goto(`${BASE}/import?asOf=${AS_OF}&batch=${batchId}`, { waitUntil: 'networkidle' })
  const before = (await page.locator('body').textContent()) ?? ''

  check('the batch is listed with its file', before.includes('verify-import.xlsx'))
  // The accountant reads these and goes back to the spreadsheet, so they have to
  // arrive in the language the screen is in.
  check('a broken formula is named, not swallowed',
    before.includes('#REF!') && before.includes('bảng tính cũng không có đáp án'))
  check('an unknown gold type is named',
    before.includes('Không có loại vàng nào tên NOTAGOLD'))
  check('the rejected rows are pointed at by sheet row',
    before.includes('3') && before.includes('4'))
  check('nothing is committed yet', before.includes('Chờ duyệt'))

  // Before the load, the system knows nothing: both figures are short by the
  // whole amount.
  const gap = await db.query(
    `SELECT metric_key, difference FROM pc49.import_reconciliation($1) ORDER BY metric_key`,
    [AS_OF])
  check('the reconciliation starts out disagreeing',
    gap.rows.length === 2 && gap.rows.every((r) => Number(r.difference) !== 0),
    gap.rows.map((r) => `${r.metric_key} ${r.difference}`).join(', '))

  // Two rows cannot be fixed from here, so this is a deliberate partial load.
  await page.locator('button', { hasText: 'Ghi phần nhận được' }).first().click()
  // Waiting on the database would return before React had drawn anything, and
  // the next two checks read the screen.
  await page.getByText(/rows written/).first()
    .waitFor({ state: 'visible', timeout: 20000 })
  // The status badge is server-rendered, so it lands after the message the
  // action returned. Both are read below, so both are waited for.
  await page.getByText('Ghi thiếu dòng').first()
    .waitFor({ state: 'visible', timeout: 20000 })

  const after = (await page.locator('body').textContent()) ?? ''
  check('the screen says what it wrote and what it left',
    /2 rows written, 2 left behind/.test(after), after.includes('rows written') ? '' : 'no message')
  check('the batch is marked as committed short', after.includes('Ghi thiếu dòng'))

  const settled = await db.query(
    `SELECT metric_key, actual, difference, agrees FROM pc49.import_reconciliation($1)
      ORDER BY metric_key`, [AS_OF])
  const pt = settled.rows.find((r) => r.metric_key === 'PT')
  const sg = settled.rows.find((r) => r.metric_key === 'SG')
  check('the figure that adds up now agrees', pt?.agrees === true,
    `PT ${pt?.actual} vs 120`)
  check('the figure that does not still shows the gap',
    sg?.agrees === false && Number(sg?.difference).toFixed(2) === '-15.00',
    `SG ${sg?.actual} vs 95, difference ${sg?.difference}`)

  await page.goto(`${BASE}/import?asOf=${AS_OF}&batch=${batchId}`, { waitUntil: 'networkidle' })
  const shown = (await page.locator('body').textContent()) ?? ''
  check('the screen shows the difference the accountant has to explain',
    shown.includes('-15.00'))

  await page.screenshot({ path: 'import.png', fullPage: true })

  // Withdrawing puts the rows back, which is what makes a load re-runnable.
  const undone = await db.query('SELECT pc49.withdraw_import_batch($1) AS n', [batchId])
  check('the batch can be withdrawn whole', Number(undone.rows[0].n) === 2)
  const left = await db.query(
    `SELECT count(*)::int AS n FROM pc49.inventory_movement WHERE move_date = $1`, [AS_OF])
  check('withdrawing leaves nothing behind', left.rows[0].n === 0)
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  if (batchId) {
    await db.query(
      `DELETE FROM pc49.inventory_movement WHERE id IN (
         SELECT committed_ref FROM pc49.import_row WHERE batch_id = $1 AND committed_ref IS NOT NULL)`,
      [batchId])
    await db.query('DELETE FROM pc49.import_batch WHERE id = $1', [batchId])
  }
  {
    await db.query(`DELETE FROM pc49.import_batch WHERE file_name = 'opening.csv'`)
  }
  await db.query('DELETE FROM pc49.import_expected_figure WHERE as_of = $1', [AS_OF])
  await db.query('DELETE FROM pc49.inventory_movement WHERE move_date = $1', [AS_OF])
  const rest = await db.query(
    `SELECT (SELECT count(*) FROM pc49.import_batch WHERE file_name = 'verify-import.xlsx') AS batches,
            (SELECT count(*) FROM pc49.inventory_movement WHERE move_date = $1) AS movements`,
    [AS_OF])
  check('the check cleaned up after itself',
    Number(rest.rows[0].batches) === 0 && Number(rest.rows[0].movements) === 0,
    `${rest.rows[0].batches} batches, ${rest.rows[0].movements} movements left`)
  await db.end()
}

console.log(failures === 0 ? '\nALL IMPORT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
