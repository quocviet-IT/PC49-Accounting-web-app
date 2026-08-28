// Downloads the month's reports the way the accountant will, then opens the
// file and checks it is worth opening: the byte-order mark that saves
// Vietnamese, figures Excel can sum, and all three reports present.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import { readFileSync } from 'node:fs'
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)}${detail}`)
}

// Far enough from anything real that this run cannot be mistaken for it.
const PERIOD = '2019-06'
const DAY = '2019-06-15'
// A counterparty with diacritics and a figure with decimals: the two things a
// CSV most often ruins.
const PARTNER = 'KHÁCH LẺ'
const AMOUNT = 791130.81

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

try {
  // Something to export. An empty file would pass a weaker check.
  const entry = await db.query(
    `INSERT INTO pc49.journal_entry (entry_date, period, memo, txn_kind, partner_code)
     VALUES ($1, $2, 'export check', 'MANUAL', $3) RETURNING id`,
    [DAY, PERIOD, PARTNER])
  await db.query(
    `INSERT INTO pc49.journal_line (entry_id, seq, debit_account, credit_account, amount_usd)
     VALUES ($1, 1, '131', '511', $2)`, [entry.rows[0].id, AMOUNT])
  await db.query(`UPDATE pc49.journal_entry SET posted_at = now() WHERE id = $1`,
    [entry.rows[0].id])

  const ctx = await browser.newContext({ acceptDownloads: true })
  const page = await openPage(ctx)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
  await page.fill('input[autocomplete="current-password"]', 'pc49-test-KT-2026')
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 60000 })

  await page.goto(`${BASE}/reports?period=${PERIOD}`, { waitUntil: 'networkidle' })
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('a', { hasText: 'Tải về' }).first().click(),
  ])

  check('the link downloads a file', !!download)
  check('named after the report and the period',
    download.suggestedFilename() === `PC49-bao-cao-${PERIOD}.csv`,
    download.suggestedFilename())

  const bytes = readFileSync(await download.path())
  // Without this Excel reads the file in the system codepage and every accented
  // character arrives as mojibake.
  check('leads with the byte-order mark',
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)

  const text = bytes.toString('utf8')
  check('Vietnamese survives the round trip',
    text.includes('Lãi lỗ') && text.includes(PARTNER))
  check('carries the figure unformatted, so Excel can sum it',
    text.includes(String(AMOUNT)) && !text.includes('791,130.81'))
  check('holds all three reports',
    ['Lãi lỗ', 'Công nợ', 'Tổng tài sản'].every((x) => text.includes(x)))

  // The owner may read reports, so may download them; nobody else gets in.
  const anon = await browser.newContext()
  const stranger = await openPage(anon)
  const res = await stranger.goto(`${BASE}/reports/export?period=${PERIOD}`)
  const landed = res?.url() ?? ''
  const body = await stranger.content()
  // Two things, and the second is the one that matters: it must not merely
  // redirect, it must not have written any figures on the way.
  check('a caller who is not signed in is sent to sign in',
    landed.includes('/login'), landed)
  check('and no report content reaches them',
    !/Lãi lỗ|Chỉ tiêu|Công nợ/.test(body))
  await anon.close()
  await ctx.close()
} finally {
  await browser.close()
  // The client's database is not a scratch pad. Unpost before deleting lines:
  // a posted entry's lines are immutable, which is the road the system forces
  // on everyone else.
  await db.query(`UPDATE pc49.journal_entry SET posted_at = NULL WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_line WHERE entry_id IN (
                    SELECT id FROM pc49.journal_entry WHERE period = $1)`, [PERIOD])
  await db.query(`DELETE FROM pc49.journal_entry WHERE period = $1`, [PERIOD])
  await db.query(`DELETE FROM pc49.audit_log
                   WHERE entity_type = 'journal_entry'
                     AND entity_id NOT IN (SELECT id::text FROM pc49.journal_entry)`)
  await db.query(`DELETE FROM pc49.audit_log
                   WHERE entity_type = 'journal_line'
                     AND entity_id NOT IN (SELECT id::text FROM pc49.journal_line)`)

  // Scoped to what this run made. A whole-table count would fail on whatever
  // another suite left behind, which is somebody else's bug reported here.
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.journal_entry WHERE period = $1) AS entries,
            (SELECT count(*)::int FROM pc49.audit_log a
              WHERE a.entity_type IN ('journal_entry', 'journal_line')
                AND a.entity_id NOT IN (SELECT id::text FROM pc49.journal_entry
                                        UNION SELECT id::text FROM pc49.journal_line)) AS orphans`,
    [PERIOD])
  check('the check cleaned up after itself',
    left.rows[0].entries === 0 && left.rows[0].orphans === 0,
    `${left.rows[0].entries} entries, ${left.rows[0].orphans} orphaned audit rows`)
  await db.end()
}

console.log(failures === 0 ? '\nALL EXPORT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
