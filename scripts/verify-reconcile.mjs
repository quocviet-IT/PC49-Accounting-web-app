// Squares an account against the other book the way the accountant will, and
// checks the thing that makes it worth doing: our figure comes from the ledger,
// not from the form, and a difference cannot be called explained without an
// explanation.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import pg from 'pg'
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)}${detail}`)
}

// A month far enough from anything real that this run cannot be mistaken for it.
const PERIOD = '2019-03'
const MONTH_END = '2019-03-31'
const OPENING_AS_OF = '2019-02-28'
const ACCOUNT = '1121-3388'
const OPENING = 50000

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

try {
  // A balance the ledger can work out, so the reconciliation has something real
  // on our side rather than a figure somebody typed.
  await db.query(
    `INSERT INTO pc49.cash_opening_balance (cash_account_code, as_of, amount)
     VALUES ($1, $2, $3)
     ON CONFLICT (cash_account_code, as_of) DO UPDATE SET amount = excluded.amount`,
    [ACCOUNT, OPENING_AS_OF, OPENING])

  const page = await openPage(browser)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
  await page.fill('input[autocomplete="current-password"]', 'pc49-test-KT-2026')
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 60000 })

  await page.goto(`${BASE}/cash?period=${PERIOD}`, { waitUntil: 'networkidle' })
  check('the cash screen offers a reconciliation',
    (await page.locator('button', { hasText: 'Đối chiếu' }).count()) > 0)

  // The other book says something different: a gap of 250 to account for.
  //
  // Scoped by the button rather than by the account name: the same account is
  // named in the balances table above, and picking the first row that mentions
  // it lands there instead.
  //
  // A locator re-resolves every time it is used, and clicking replaces the
  // button with the panel — so a row found *by* that button stops matching the
  // moment it is clicked. The field labels carry the account code and are
  // unique on the page, so they need no row scope at all.
  await page.locator('tr').filter({ hasText: '3388' })
    .getByRole('button', { name: 'Đối chiếu', exact: true }).first().click()
  await page.getByLabel(`Sổ US ${ACCOUNT}`, { exact: true }).fill('49750')

  const shown = (await page.locator('body').textContent()) ?? ''
  check('the gap is shown before the conclusion is chosen',
    /Chênh lệch:\s*250/.test(shown),
    shown.match(/Chênh lệch:\s*[\d,.-]+/)?.[0] ?? '(not shown)')

  // Calling it explained without an explanation is refused by the database.
  await page.getByLabel('Kết luận', { exact: true }).selectOption('DIFF_EXPLAINED')
  await page.getByRole('button', { name: 'Lưu', exact: true }).click()
  const refused = await page.getByText(/cash_reconciliation_explained_needs_reason|constraint/)
    .first().waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false)
  check('calling a difference explained with no explanation is refused', refused)

  await page.getByLabel('Giải thích chênh lệch', { exact: true })
    .fill('a wire landed on the first of the next month')
  await page.getByRole('button', { name: 'Lưu', exact: true }).click()

  const saved = await untilRowIs(db,
    `SELECT our_closing::text AS ours, us_closing::text AS theirs,
            difference::text AS diff, status::text AS s, reason
       FROM pc49.cash_reconciliation
      WHERE rec_date = $1 AND cash_account_code = $2`, [MONTH_END, ACCOUNT],
    (r) => r.s === 'DIFF_EXPLAINED')

  check('the reconciliation is recorded', saved !== null, saved?.s ?? '(nothing saved)')
  // The point of the whole screen: our side is the ledger's answer, not a
  // figure somebody typed into the form.
  check('our figure came from the ledger, not the form',
    Number(saved?.ours) === OPENING, `${saved?.ours} vs opening ${OPENING}`)
  check('the difference is worked out rather than entered',
    Number(saved?.diff) === 250, saved?.diff)
  check('and the explanation is kept with it',
    (saved?.reason ?? '').includes('wire landed'), saved?.reason ?? '')

  await page.reload({ waitUntil: 'networkidle' })
  const after = (await page.locator('body').textContent()) ?? ''
  check('the screen then shows the conclusion instead of the control',
    after.includes('Lệch, đã giải thích') && after.includes('wire landed'))
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await db.query(`DELETE FROM pc49.cash_reconciliation WHERE rec_date = $1`, [MONTH_END])
  await db.query(`DELETE FROM pc49.cash_opening_balance WHERE as_of = $1`, [OPENING_AS_OF])

  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.cash_reconciliation) AS rec,
            (SELECT count(*)::int FROM pc49.cash_opening_balance) AS opening`)
  check('the check cleaned up after itself',
    left.rows[0].rec === 0 && left.rows[0].opening === 0,
    `${left.rows[0].rec} reconciliations, ${left.rows[0].opening} opening balances`)
  await db.end()
}

console.log(failures === 0 ? '\nALL RECONCILE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
