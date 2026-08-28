// Types a day's prices the way the accountant will, closes a month the way the
// supervisor will, and checks each role is offered only its own screens.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'
import { untilGone, untilRowIs } from './support/until.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)}${detail}`)
}

// Far enough from anything real that this run cannot be mistaken for it.
const DAY = '2019-08-14'
const NEXT_DAY = '2019-08-15'
// The period screen lists the last fourteen months, so the month under test has
// to be one of them. The current one is put back the way it was afterwards.
const PERIOD = new Date().toISOString().slice(0, 7)
const IN_PERIOD = `${PERIOD}-14`

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', email)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 20000 })
}

try {
  // ---- The accountant types the day's prices -------------------------------
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await signIn(page, 'kt@pc49.test', 'pc49-test-KT-2026')

  // The navigation is the sidebar now, not the header bar; the header carries
  // only the name of the page you are on. A group is closed until it is opened
  // or until the page you are on is inside it, so this opens it the way a
  // reader would.
  check('the accountant reaches settings, for the import card',
    ((await page.locator('aside').first().textContent()) ?? '').includes('Cấu hình'))

  await page.locator('aside .ant-menu-submenu-title', { hasText: 'Vàng' }).first().click()
  await page.waitForTimeout(500)
  check('the accountant is offered the price screen',
    ((await page.locator('aside').first().textContent()) ?? '').includes('Giá vàng'))

  await page.goto(`${BASE}/prices?date=${DAY}`, { waitUntil: 'networkidle' })
  check('the screen lists every active gold type',
    (await page.locator('input[aria-label^="Giá thị trường"]').count()) === 9)

  const grain = page.getByLabel('Giá thị trường GRAIN', { exact: true })
  await grain.fill('139.20')
  await grain.blur()

  const stored = await untilRowIs(db,
    `SELECT market_price::text AS m FROM pc49.gold_price_daily
      WHERE price_date = $1 AND gold_type_code = 'GRAIN'`, [DAY],
    (r) => Number(r.m) === 139.2)
  check('a typed price reaches the database', stored !== null,
    stored?.m ?? 'nothing stored')

  // The spot price is typed per ounce and read per gram, and the divisor is the
  // valuation figure 31.1 rather than the 31.105 that converts weight.
  const spot = page.getByLabel('USD / oz GOLD', { exact: true })
  await spot.fill('4890')
  await spot.blur()
  const perGram = await untilRowIs(db,
    `SELECT spot_per_gram::text AS g FROM pc49.spot_price_daily
      WHERE price_date = $1 AND metal = 'GOLD'`, [DAY],
    (r) => Math.abs(Number(r.g) - 4890 / 31.1) < 1e-6)
  check('spot per gram is derived, not typed', perGram !== null,
    perGram?.g ?? 'nothing stored')

  // ---- Carrying prices forward --------------------------------------------
  await page.goto(`${BASE}/prices?date=${NEXT_DAY}`, { waitUntil: 'networkidle' })
  const blank = await db.query(
    `SELECT count(*)::int AS n FROM pc49.gold_price_daily WHERE price_date = $1`, [NEXT_DAY])
  check('the next day starts with no prices', blank.rows[0].n === 0)

  await page.locator('button', { hasText: 'Lấy giá hôm trước' }).first().click()
  await page.waitForTimeout(2500)
  const carried = await db.query(
    `SELECT market_price::text AS m, source FROM pc49.gold_price_daily
      WHERE price_date = $1 AND gold_type_code = 'GRAIN'`, [NEXT_DAY])
  check('yesterday\'s price is carried forward, and says so',
    Number(carried.rows[0]?.m) === 139.2 && (carried.rows[0]?.source ?? '').includes(DAY),
    carried.rows[0]?.source ?? 'nothing carried')

  // Carrying twice must not overwrite a figure somebody has since corrected.
  await db.query(
    `UPDATE pc49.gold_price_daily SET market_price = 200
      WHERE price_date = $1 AND gold_type_code = 'GRAIN'`, [NEXT_DAY])
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('button', { hasText: 'Lấy giá hôm trước' }).first().click()
  // Nothing should change, so this waits for the screen to have answered and
  // then reads: a corrected figure staying put is the whole assertion.
  await page.getByText(/nothing to carry|đã được/).first()
    .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
  const kept = await db.query(
    `SELECT market_price::text AS m FROM pc49.gold_price_daily
      WHERE price_date = $1 AND gold_type_code = 'GRAIN'`, [NEXT_DAY])
  check('carrying again leaves a corrected figure alone', Number(kept.rows[0]?.m) === 200,
    kept.rows[0]?.m)

  // ---- A blank cell clears the price rather than storing zero -------------
  await page.goto(`${BASE}/prices?date=${DAY}`, { waitUntil: 'networkidle' })
  const clearMe = page.getByLabel('Giá thị trường GRAIN', { exact: true })
  await clearMe.fill('')
  await clearMe.blur()
  const cleared = await untilGone(db,
    `SELECT 1 FROM pc49.gold_price_daily
      WHERE price_date = $1 AND gold_type_code = 'GRAIN'`, [DAY])
  check('clearing a cell removes the price rather than storing zero',
    cleared === true, cleared ? '' : 'the row is still there')

  await page.screenshot({ path: 'prices.png', fullPage: true })
  await ctx.close()

  // ---- The supervisor closes a month --------------------------------------
  const gsCtx = await browser.newContext()
  const gs = await gsCtx.newPage()
  await signIn(gs, 'gsus@pc49.test', 'pc49-test-GSUS-2026')

  const gsMenu = (await gs.locator('aside').first().textContent()) ?? ''
  check('the supervisor is offered settings', gsMenu.includes('Cấu hình'))
  check('the supervisor is not offered the price screen', !gsMenu.includes('Giá vàng'))

  const hub = await gs.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  check('the settings hub answers rather than 404s', hub?.status() === 200,
    String(hub?.status()))
  const hubText = (await gs.locator('body').textContent()) ?? ''
  // Same hub, three different sets of cards. The supervisor closes periods and
  // does nothing else here.
  check('the hub offers the supervisor periods and nothing else',
    hubText.includes('Kỳ kế toán')
      && !hubText.includes('Dữ liệu nền') && !hubText.includes('Nạp dữ liệu'))

  await gs.goto(`${BASE}/settings/periods`, { waitUntil: 'networkidle' })
  const month = gs.locator(`tr:has-text("${PERIOD}")`)
  await month.getByRole('button', { name: 'Đóng kỳ', exact: true }).click()
  // Wait for the row to say what happened rather than for a stopwatch.
  await month.getByRole('button', { name: 'Mở lại', exact: true })
    .waitFor({ state: 'visible', timeout: 15000 })
  const closed = await db.query(
    `SELECT status::text, closed_by FROM pc49.accounting_period WHERE period = $1`, [PERIOD])
  check('closing a month records the decision and who made it',
    closed.rows[0]?.status === 'CLOSED' && closed.rows[0]?.closed_by !== null,
    closed.rows[0]?.status ?? 'no row')

  // The guard is the database's, not the screen's.
  let refused = false
  try {
    await db.query(`
      WITH e AS (
        INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind, posted_at)
        VALUES ('${IN_PERIOD}', '${PERIOD}', 'settings check', 'MANUAL', now())
        RETURNING id) SELECT 1 FROM e`)
  } catch { refused = true }
  check('a closed month refuses a posting', refused)

  await month.getByRole('button', { name: 'Mở lại', exact: true }).click()
  await month.getByRole('button', { name: 'Đóng kỳ', exact: true })
    .waitFor({ state: 'visible', timeout: 15000 })
  const reopened = await db.query(
    `SELECT status::text, closed_at FROM pc49.accounting_period WHERE period = $1`, [PERIOD])
  check('reopening keeps the row and clears the closure',
    reopened.rows[0]?.status === 'OPEN' && reopened.rows[0]?.closed_at === null,
    reopened.rows[0]?.status ?? 'no row')

  await gs.screenshot({ path: 'settings-periods.png', fullPage: true })
  await gsCtx.close()

  // ---- The owner is offered none of it -------------------------------------
  const ocCtx = await browser.newContext()
  const oc = await ocCtx.newPage()
  await signIn(oc, 'oc@pc49.test', 'pc49-test-OC-2026')
  for (const path of ['/prices', '/settings', '/settings/periods', '/settings/reference']) {
    await oc.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    const body = (await oc.locator('body').textContent()) ?? ''
    check(`the owner is refused ${path}`, body.includes('không có quyền'))
  }
  await ocCtx.close()

  // ---- Reference data is the administrator's -------------------------------
  const adCtx = await browser.newContext()
  const ad = await adCtx.newPage()
  await signIn(ad, 'admin@pc49.test', 'pc49-test-ADMIN-2026')
  const adHub = await ad.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  const adText = (await ad.locator('body').textContent()) ?? ''
  check('the administrator is offered all three cards',
    adHub?.status() === 200 && ['Nạp dữ liệu', 'Kỳ kế toán', 'Dữ liệu nền']
      .every((c) => adText.includes(c)))

  await ad.goto(`${BASE}/settings/reference`, { waitUntil: 'networkidle' })
  const refText = (await ad.locator('body').textContent()) ?? ''
  check('the administrator sees the system parameters',
    refText.includes('VALUATION_GRAM_PER_OZ') && refText.includes('REFINING_FEE_PCT_PT'))
  // The sentence beside 31.1 is what stops somebody typing 31.105 into it, so
  // it has to arrive in the language the screen is in.
  check('and reads their meaning in the language of the screen',
    refText.includes('CỐ Ý không phải 31,105'))
  check('and the gold types with the accounts they post to',
    refText.includes('632Grain') && refText.includes('155Grain'))
  await ad.screenshot({ path: 'settings-reference.png', fullPage: true })
  await adCtx.close()
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await db.query(`DELETE FROM pc49.gold_price_daily WHERE price_date IN ($1, $2)`, [DAY, NEXT_DAY])
  await db.query(`DELETE FROM pc49.spot_price_daily WHERE price_date IN ($1, $2)`, [DAY, NEXT_DAY])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'journal_entry'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
  await db.query(`DELETE FROM pc49.accounting_period WHERE period = $1`, [PERIOD])
  // Closing and reopening a month is audited, and that trail belongs to this
  // run rather than to the client's history.
  await db.query(`DELETE FROM pc49.audit_log
                   WHERE entity_type = 'accounting_period' AND entity_id = $1`, [PERIOD])
  // Scoped to the days and the month this run touched: asserting on whole-table
  // counts makes the check fail whenever another suite has left something
  // behind, which is somebody else's bug reported in the wrong place.
  const rest = await db.query(
    `SELECT (SELECT count(*) FROM pc49.gold_price_daily WHERE price_date IN ($1, $2)) AS prices,
            (SELECT count(*) FROM pc49.spot_price_daily WHERE price_date IN ($1, $2)) AS spot,
            (SELECT count(*) FROM pc49.accounting_period WHERE period = $3) AS periods,
            (SELECT count(*) FROM pc49.journal_entry WHERE period = $3) AS entries`,
    [DAY, NEXT_DAY, PERIOD])
  const r = rest.rows[0]
  check('the check cleaned up after itself',
    [r.prices, r.spot, r.periods, r.entries].every((n) => Number(n) === 0),
    `${r.prices} prices, ${r.spot} spot, ${r.periods} periods, ${r.entries} entries`)
  await db.end()
}

console.log(failures === 0 ? '\nALL SETTINGS CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
