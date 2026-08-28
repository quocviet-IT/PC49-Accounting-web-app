// Runs the report centre against a month of real entries and checks the two
// things a set of books is read for: that the trial balance proves itself, and
// that the ledger under it agrees with the figure it summarises.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)}${detail}`)
}

// A month far enough from anything real that this run cannot be mistaken for it.
const PERIOD = '2019-02'
const BEFORE = '2019-01'

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

/** Posts a one-line entry, which balances itself. */
async function post(date, dr, cr, amount, memo) {
  const e = await db.query(
    `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind)
     VALUES ($1, to_char($1::date, 'YYYY-MM'), $2, 'MANUAL') RETURNING id`, [date, memo])
  await db.query(
    `INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
     VALUES ($1, 1, $2, $3, $4)`, [e.rows[0].id, dr, cr, amount])
  await db.query('UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1', [e.rows[0].id])
}

try {
  // January, so February has an opening balance to carry in.
  await post('2019-01-15', '1111', '4111', 100000, 'verify-reports opening')
  // February.
  await post('2019-02-05', '131', '511', 6000, 'verify-reports sale')
  await post('2019-02-06', '1111', '131', 4000, 'verify-reports part paid')
  await post('2019-02-20', '642', '1111', 250, 'verify-reports fee')

  const page = await openPage(browser)
  await signIn(page, BASE, 'kt@pc49.test', 'pc49-test-KT-2026')

  // ---- The catalogue -------------------------------------------------------
  await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' })
  const hub = (await page.locator('body').textContent()) ?? ''
  check('the centre lists the reports, grouped',
    ['Lãi lỗ', 'Bảng cân đối phát sinh', 'Sổ cái tài khoản', 'Nhập xuất tồn',
     'Đơn cọc', 'Nợ nhà cung cấp'].every((x) => hub.includes(x)))

  // ---- The trial balance ---------------------------------------------------
  await page.goto(`${BASE}/reports?report=trial&period=${PERIOD}`, { waitUntil: 'networkidle' })
  const trial = (await page.locator('body').textContent()) ?? ''

  check('the trial balance opens the month from the month before',
    trial.includes('100,000.00'), 'cash opening')
  check('and proves itself', trial.includes('Cân') && !trial.includes('LỆCH'))
  await page.screenshot({ path: 'report-trial.png', fullPage: true })

  const proof = await db.query(
    `SELECT sum(debit)::text AS dr, sum(credit)::text AS cr
       FROM pc49.trial_balance($1)`, [PERIOD])
  check('debits equal credits in the figures behind it',
    Math.abs(Number(proof.rows[0].dr) - Number(proof.rows[0].cr)) < 0.005,
    `${proof.rows[0].dr} vs ${proof.rows[0].cr}`)

  const listed = await db.query(
    `SELECT count(*)::int AS n FROM pc49.trial_balance($1)`, [PERIOD])
  const all = await db.query('SELECT count(*)::int AS n FROM pc49.account')
  check('an account that never moved is left off',
    listed.rows[0].n < all.rows[0].n && listed.rows[0].n > 0,
    `${listed.rows[0].n} of ${all.rows[0].n} accounts`)

  // ---- The ledger under it -------------------------------------------------
  await page.goto(
    `${BASE}/reports?report=ledger&from=${PERIOD}-01&to=${PERIOD}-28&account=1111`,
    { waitUntil: 'networkidle' })
  const led = (await page.locator('body').textContent()) ?? ''
  check('the ledger names the other side of each line',
    led.includes('verify-reports part paid') && led.includes('131'))

  const last = await db.query(
    `SELECT balance::text AS b FROM pc49.general_ledger('1111', $1, $2)
      ORDER BY entry_date DESC LIMIT 1`, [`${PERIOD}-01`, `${PERIOD}-28`])
  const closing = await db.query(
    `SELECT closing::text AS c FROM pc49.trial_balance($1) WHERE account_code = '1111'`,
    [PERIOD])
  // The two reports answer the same question at different resolutions.
  // Disagreeing would make both useless.
  check('the ledger ends where the trial balance says the account closed',
    Math.abs(Number(last.rows[0].b) - Number(closing.rows[0].c)) < 0.005,
    `${last.rows[0].b} vs ${closing.rows[0].c}`)
  check('and it started from where the account already stood',
    Number(last.rows[0].b) === 103750, last.rows[0].b)

  // ---- A report only offers the control it reads ---------------------------
  const monthOnly = await page.goto(`${BASE}/reports?report=pnl&period=${PERIOD}`,
    { waitUntil: 'networkidle' })
  check('a monthly report offers a month and no date range',
    monthOnly?.status() === 200
      && (await page.locator('input[type="month"]').count()) === 1
      && (await page.locator('input[type="date"]').count()) === 0)

  await page.goto(`${BASE}/reports?report=assets`, { waitUntil: 'networkidle' })
  check('an as-at report offers a date and no month',
    (await page.locator('input[type="date"]').count()) === 1
      && (await page.locator('input[type="month"]').count()) === 0)

  // ---- Every report answers -------------------------------------------------
  for (const id of ['pnl', 'assets', 'trial', 'ledger', 'stock', 'deposits', 'apar', 'vendor']) {
    const r = await page.goto(`${BASE}/reports?report=${id}&period=${PERIOD}`,
      { waitUntil: 'networkidle' })
    const body = (await page.locator('body').textContent()) ?? ''
    check(`the ${id} report opens`,
      r?.status() === 200 && !body.includes('không có quyền'), String(r?.status()))
  }

  // A name nobody serves falls back to the catalogue rather than an error.
  await page.goto(`${BASE}/reports?report=nonsense`, { waitUntil: 'networkidle' })
  check('an unknown report name falls back to the centre',
    ((await page.locator('body').textContent()) ?? '').includes('Trung tâm báo cáo'))

} finally {
  await browser.close()
  // The client's database is not a scratch pad. Unpost first: a posted entry's
  // lines are immutable, which is the road the system forces on everyone else.
  for (const period of [BEFORE, PERIOD]) {
    await db.query('UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1', [period])
    await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                      SELECT id FROM pc49.journal_entry WHERE period = $1)`, [period])
    await db.query('DELETE FROM pc49.journal_entry WHERE period = $1', [period])
  }
  await db.query(`DELETE FROM pc49.audit_log
                   WHERE entity_type IN ('journal_entry', 'journal_line')
                     AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry
                                           UNION SELECT id::text FROM pc49.journal_line)`)

  const left = await db.query(
    `SELECT count(*)::int AS n FROM pc49.journal_entry WHERE period IN ($1, $2)`,
    [BEFORE, PERIOD])
  check('the check cleaned up after itself', left.rows[0].n === 0,
    `${left.rows[0].n} entries left`)
  await db.end()
}

console.log(failures === 0 ? '\nALL REPORT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
