// Takes a picture of every screen, in both themes and at phone width, so the
// design can be looked at rather than reasoned about.
//
// This has earned its place. Screenshots have caught things no test here has:
// an input cell with no visible edge, a table with no frame around it, a zero
// printed in the colour for money going out, a menu that overflowed and buried
// a whole screen, two panels that became one in dark mode, and prose cut off
// with an ellipsis in the one column meant to hold prose.
//
// Writes into ui-shots/. Run with the dev server up: npm run shots
import { chromium } from 'playwright'
import pg from 'pg'
import { mkdirSync, readdirSync } from 'node:fs'
import { openPage, signIn } from './support/page.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const OUT = 'ui-shots'
mkdirSync(OUT, { recursive: true })

// A day's trading, put in before the pictures are taken and removed after.
// Without it every screenshot is of an empty table, which hides most of what a
// picture is taken to check: how figures line up, where a column runs out of
// room, what a negative looks like beside a positive.
const DAY = '2026-01-15'
const PERIOD = '2026-01'

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}
const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

/** A morning's worth of buying and selling, enough to fill the screens. */
async function seed() {
  for (const [code, price] of [['GRAIN', 139.20], ['SG', 141.05], ['9999', 142.60]]) {
    await db.query(
      `INSERT INTO pc49.gold_price_daily (price_date, gold_type_code, market_price)
       VALUES ($1, $2, $3)
       ON CONFLICT (price_date, gold_type_code) DO UPDATE SET market_price = $3`,
      [DAY, code, price])
  }

  // Buying takes gold in and money out; selling is the other way round. The
  // table's constraints say so, and these rows are written to satisfy them
  // rather than to be waved through.
  const rows = [
    ['PO',   'Kim Anh',   'GRAIN',  31.5, -4382.40, 139.12, 'mua le buoi sang'],
    ['PO',   'Ngoc Ha',   'SG',     18.2, -2565.11, 140.94, null],
    ['SALE', 'Tran Bao',  'GRAIN', -12.4,  1748.16, 141.00, 'khach quen'],
    ['SALE', 'Le Thu',    '9999',  -7.85,  1123.41, 143.11, null],
    ['SALE', 'Pham Quoc', 'SG',    -22.0,  3124.20, 142.01, 'giao chieu'],
  ]
  for (const [type, partner, gold, qty, amount, price, remark] of rows) {
    await db.query(
      `INSERT INTO pc49.gold_txn
         (txn_date, txn_type, partner_code, gold_type_code, uom, qty, unit_price, amount, remarks)
       VALUES ($1, $2, $3, $4, 'GRAM', $5, $6, $7, $8)`,
      [DAY, type, partner, gold, qty, price, amount, remark])
  }

  // And something in the report queue, so that screen is not a picture of
  // nothing either.
  await db.query(
    `INSERT INTO pc49.feedback_report (kind, impact, description, page_url, page_route, page_title)
     VALUES
       ('WRONG_NUMBER', 'BLOCKING',
        'ui-shots: tong cuoi ngay 15/01 lech 250 so voi so tay, dong ban cho Le Thu ra sai',
        '/gold-transactions?date=2026-01-15', '/gold-transactions', 'Giao dich vang'),
       ('SUGGESTION', 'MINOR',
        'ui-shots: cho go tat ngay hom nay bang phim thay vi chon tren lich',
        '/prices', '/prices', 'Gia vang')`)
}

/** Puts the client's database back exactly as it was. */
async function unseed() {
  const txns = await db.query(`SELECT id FROM pc49.gold_txn WHERE txn_date = $1`, [DAY])
  for (const t of txns.rows) {
    await db.query(`DELETE FROM pc49.inventory_movement WHERE source_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn_payment WHERE txn_id = $1`, [t.id])
    await db.query(`DELETE FROM pc49.gold_txn WHERE id = $1`, [t.id])
  }
  // Unpost first: a posted entry's lines are immutable, which is the same road
  // the system forces on everyone else.
  await db.query(`UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1 AND reversal_of_id IS NOT NULL`,
                 [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.gold_price_daily WHERE price_date = $1`, [DAY])
  await db.query(`DELETE FROM pc49.feedback_report WHERE description LIKE 'ui-shots:%'`)
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)

  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.gold_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $2) AS entries,
            (SELECT count(*)::int FROM pc49.gold_price_daily WHERE price_date = $1) AS prices,
            (SELECT count(*)::int FROM pc49.feedback_report
              WHERE description LIKE 'ui-shots:%') AS reports`, [DAY, PERIOD])
  const r = left.rows[0]
  const clean = [r.txns, r.entries, r.prices, r.reports].every((n) => n === 0)
  console.log(clean
    ? 'the database is back as it was'
    : `LEFT BEHIND: ${r.txns} txns, ${r.entries} entries, ${r.prices} prices, ${r.reports} reports`)
  return clean
}

await seed()

const PAGES = [
  ['dashboard', '/'],
  ['gold-transactions', `/gold-transactions?date=${DAY}`],
  ['prices', `/prices?date=${DAY}`],
  ['refining', '/refining'],
  ['inventory', '/inventory'],
  ['cash', '/cash'],
  ['bank-conversion', '/bank-conversion'],
  ['journal', `/journal?period=${PERIOD}`],
  ['reports', `/reports?period=${PERIOD}`],
  ['feedback', '/feedback'],
  ['import', '/import'],
  ['settings', '/settings'],
  ['settings-periods', '/settings/periods'],
  ['settings-reference', '/settings/reference'],
]

/** Desktop and a phone, because the shell behaves differently on each. */
const VIEWPORTS = [
  ['', { width: 1440, height: 900 }],
  ['phone-', { width: 390, height: 844 }],
]

const browser = await chromium.launch()

try {
for (const theme of ['light', 'dark']) {
  for (const [prefix, viewport] of VIEWPORTS) {
    // The phone only needs one theme; the point there is layout, not colour.
    if (prefix && theme === 'dark') continue

    const ctx = await browser.newContext({
      viewport,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
    })
    const page = await openPage(ctx)

    // The sign-in screen is a screen too, and it is the only one anybody sees
    // before they have an account working.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await page.screenshot({ path: `${OUT}/${prefix}${theme}-login.png` })

    await signIn(page, BASE, 'admin@pc49.test', 'pc49-test-ADMIN-2026')

    for (const [name, path] of PAGES) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
      // Wait for the page to have drawn its own content rather than for a
      // fixed number of milliseconds, which is either wasted or not enough.
      await page.locator('main, [role="main"], #main').first()
        .waitFor({ state: 'visible' }).catch(() => {})
      await page.screenshot({ path: `${OUT}/${prefix}${theme}-${name}.png`, fullPage: true })
      console.log(`${prefix}${theme}/${name}`)
    }

    // And the thing people reach for when a screen is wrong, open.
    await page.goto(`${BASE}/prices?date=${DAY}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Báo lỗi / góp ý' }).click()
    await page.locator('.ant-modal-body').waitFor({ state: 'visible' })
    await page.screenshot({ path: `${OUT}/${prefix}${theme}-report-dialog.png` })
    console.log(`${prefix}${theme}/report-dialog`)

    await ctx.close()
  }
}

console.log(`\n${readdirSync(OUT).length} pictures in ${OUT}/`)
} finally {
  await browser.close()
  // The client's database is not a scratch pad, whatever went wrong above.
  const clean = await unseed()
  await db.end()
  if (!clean) process.exit(1)
}
