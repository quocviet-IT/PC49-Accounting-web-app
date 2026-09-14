// Every screen, at the widths people actually use, measured rather than looked at.
//
//   npm run verify:layout      (dev server up)
//
// Written after a round of layout breakage that no test here could see, because
// nothing measured layout at all:
//
//   - the dashboard's two columns were bare `1fr` tracks, whose minimum is the
//     width of what is inside them; the recent-transactions table pushed its
//     column past the window and squeezed the waiting list to a word per line
//     at 1024px, and shoved the whole page 361px sideways on a phone;
//   - the transaction list declared 936px of fixed columns, so on a 1280px
//     laptop the customer and remark columns got 33px each, and none at 1024px;
//   - the bank conversion screen and the report queue did the same on a phone.
//
// A screen fails here if the page scrolls sideways, if an element spills past
// the window outside a box meant to scroll, if content is cut off inside a box
// that hides overflow, or if prose is squeezed to a word per line. Truncation
// somebody chose — an ellipsis on a long remark, a file input hidden behind its
// button — is not a failure.
import pg from 'pg'
import { chromium } from 'playwright'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const WIDTHS = (process.env.WIDTHS ?? '1440,1366,1280,1024,390').split(',').map(Number)

const SCREENS = [
  ['home', '/'],
  ['transactions', '/gold-transactions?date=2026-08-26'],
  ['prices', '/prices?date=2026-08-26'],
  ['refining', '/refining'],
  ['lot', null],
  ['inventory', '/inventory'],
  ['import', '/import'],
  ['cash', '/cash?period=2026-08'],
  ['bank-conversion', '/bank-conversion'],
  ['journal', '/journal?period=2026-08'],
  ['reports', '/reports'],
  ['report-pnl', '/reports?report=pnl&period=2026-08'],
  ['feedback', '/feedback'],
  ['settings', '/settings'],
  ['reference', '/settings/reference'],
  ['periods', '/settings/periods'],
  ['users', '/settings/users'],
]

// The lot list opens a lot with a button rather than a link, so the detail page
// is reached by id. The demo lot is used because it has every table filled.
let lotPath = null
if (process.env.SUPABASE_DB_URL) {
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const lot = (await db.query(`SELECT id FROM pc49.refining_lot ORDER BY lot_code LIMIT 1`)).rows[0]
  await db.end()
  if (lot) lotPath = `/refining/${lot.id}`
}

/** Runs in the page: everything that is wrong with this screen's layout. */
function survey() {
  const vw = document.documentElement.clientWidth
  const label = (el) => {
    const c = typeof el.className === 'string'
      ? el.className.split(' ').find((x) => x && !x.startsWith('css-')) : ''
    return `${el.tagName.toLowerCase()}${c ? '.' + c.replace(/-module__\w+__/, ':') : ''}`
  }
  const insideScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll') return true
    }
    return false
  }
  const chosenTruncation = (el) => {
    if (el.tagName === 'INPUT' && el.type === 'file') return true
    for (let p = el; p; p = p.parentElement) {
      if (getComputedStyle(p).textOverflow === 'ellipsis') return true
    }
    return false
  }
  // antd's tab bar clips the tabs that do not fit and lists them under its own
  // "more" button. That is overflow by design, so long as the button is there
  // to reach them: at 390px the reference screen shows two of its five tabs,
  // and the other three are one tap away.
  const tabsWithMore = (el) => {
    const wrap = el.closest('.ant-tabs-nav-wrap')
    const more = wrap?.parentElement?.querySelector(':scope > .ant-tabs-nav-operations')
    return Boolean(more) && !more.classList.contains('ant-tabs-nav-operations-hidden')
  }
  const problems = []
  const overflow = document.documentElement.scrollWidth - vw
  if (overflow > 0) problems.push(`the page scrolls sideways by ${overflow}px`)
  const seen = new Set()
  for (const el of document.querySelectorAll('main *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    let issue = null
    if (r.right > vw + 1 && !insideScroller(el) && !tabsWithMore(el)) {
      issue = `${label(el)} runs past the window (right edge ${Math.round(r.right)}px)`
    } else if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip')
        && el.scrollWidth > el.clientWidth + 2 && !chosenTruncation(el) && !tabsWithMore(el)) {
      issue = `${label(el)} cuts off its content (${el.scrollWidth}px in ${el.clientWidth}px)`
    } else if (el.children.length === 0 && (el.textContent ?? '').trim().length > 12 && r.width < 90
        && r.height > 4 * (parseFloat(cs.lineHeight) || 18)) {
      issue = `${label(el)} is squeezed to ${Math.round(r.width)}px: "${el.textContent.trim().slice(0, 24)}"`
    }
    if (issue && !seen.has(issue)) { seen.add(issue); problems.push(issue) }
    if (problems.length >= 6) break
  }
  return problems
}

const browser = await chromium.launch()
const admin = accountFor('ADMIN')
let failures = 0

for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await openPage(context)
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  await signIn(page, BASE, admin.email, admin.password)

  for (const [name, path] of SCREENS) {
    const target = path ?? lotPath
    if (!target) { console.log(`SKIP  ${width} ${name}: no lot to open`); continue }
    pageErrors.length = 0
    await page.goto(`${BASE}${target}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const problems = [...await page.evaluate(survey), ...pageErrors.map((e) => `page error: ${e}`)]
    const ok = problems.length === 0
    if (!ok) failures += 1
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(width).padEnd(4)} ${name}` +
      (ok ? '' : `\n        ${problems.join('\n        ')}`))
  }
  await context.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL LAYOUT CHECKS PASSED' : `\n${failures} SCREEN(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
