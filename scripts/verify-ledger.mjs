// The gold ledger, checked against the database it reads.
//
//   npm run verify:ledger       (dev server up, or PC49_BASE_URL for Production)
//
// Read-only: nothing is written. January 2026 is used because it is real
// loaded data with more than one page of rows.
import pg from 'pg'
import { chromium } from 'playwright'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const FROM = '2026-01-01'
const TO = '2026-01-31'

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(62)}${detail}`)
}

/** Records in a CSV, honouring quotes, so a remark with a newline is one row. */
function csvRecords(text) {
  let rows = 0
  let quoted = false
  let any = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (c === '"') { quoted = !quoted; any = true; continue }
    if (!quoted && c === '\n') { if (any) rows += 1; any = false; continue }
    if (c !== '\r') any = true
  }
  return any ? rows + 1 : rows
}

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()
// The screen counts receipts and conversions; the file has a line per item or leg (0080).
const expected = (await db.query(
  `SELECT count(DISTINCT coalesce(receipt_id, conversion_id, id))::int AS receipts,
          count(*)::int AS items,
          coalesce(-sum(amount) FILTER (WHERE txn_type IN ('PO', 'PO_VENDOR')), 0)::numeric(18,2)::text AS purchases
     FROM pc49.gold_txn WHERE voided_at IS NULL AND txn_date BETWEEN $1 AND $2`, [FROM, TO])).rows[0]
const everything = (await db.query(
  `SELECT count(DISTINCT coalesce(receipt_id, conversion_id, id))::int AS n
     FROM pc49.gold_txn WHERE voided_at IS NULL`)).rows[0].n
await db.end()

const browser = await chromium.launch()
const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 900 } }))
const kt = accountFor('KT')

/** The figure under a stat label, as a number. */
const stat = (label) => page.evaluate((wanted) => {
  const el = [...document.querySelectorAll('main span')].find((s) => s.textContent.trim() === wanted)
  return Number((el?.nextElementSibling?.textContent ?? '').replace(/,/g, ''))
}, label)

try {
  await signIn(page, BASE, kt.email, kt.password)

  await page.goto(`${BASE}/gold-transactions`, { waitUntil: 'networkidle' })
  check('opening the ledger counts every live receipt', await stat('Số phiếu') === everything,
    `${await stat('Số phiếu')} on screen, ${everything} in the database`)

  await page.goto(`${BASE}/gold-transactions?from=${FROM}&to=${TO}`, { waitUntil: 'networkidle' })
  check('the range is shown in the date boxes',
    (await page.locator('.pc-date-input').first().inputValue()) === FROM)
  check('January counts what the database holds for January', await stat('Số phiếu') === expected.receipts,
    `${await stat('Số phiếu')} vs ${expected.receipts}`)
  check('and its purchases add up to the same money', (await stat('Mua vào')).toFixed(2) === expected.purchases,
    `${(await stat('Mua vào')).toFixed(2)} vs ${expected.purchases}`)
  check('a page holds at most fifty rows', (await page.locator('.ant-table-tbody tr.ant-table-row').count()) <= 50)

  const response = await page.request.get(`${BASE}/gold-transactions/export?from=${FROM}&to=${TO}`)
  const body = await response.text()
  check('the file downloads as CSV', response.status() === 200
    && (response.headers()['content-type'] ?? '').startsWith('text/csv'), `${response.status()}`)
  check('holding every January item, not just the first page', csvRecords(body.replace(/^﻿/, '')) - 1 === expected.items,
    `${csvRecords(body.replace(/^﻿/, '')) - 1} rows vs ${expected.items}`)

  const month = new Date().toISOString().slice(0, 7)
  await page.getByRole('button', { name: 'Tháng này', exact: true }).click()
  await page.waitForURL((url) => new URL(url).searchParams.get('from') === `${month}-01`, { timeout: 20000 })
    .catch(() => {})
  check('"Tháng này" moves the range to this month', new URL(page.url()).searchParams.get('from') === `${month}-01`,
    page.url().replace(BASE, ''))
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\nALL LEDGER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
