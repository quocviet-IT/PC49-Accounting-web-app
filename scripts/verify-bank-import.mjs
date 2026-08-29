// Imports a bank statement the way the accountant will: choose the file on the
// cash screen, and check the lines landed with the right sign, the right
// account, and the ones that could not be placed held for review rather than
// dropped.
//
// The file is written in the shape Rocket actually exports, taken from the
// client's own workbook. Everything this writes is removed at the end.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { passwordFor } from './support/accounts.mjs'

/** Resolved before anything is launched, so a missing password is
 *  reported as a missing password rather than as a failed sign-in. */
const PASSWORD = {
  KT: passwordFor('KT'),
}

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

// A month far enough from anything real that this run cannot be mistaken for it.
const DAY = '2019-05-02'
const FILE_NAME = 'verify-bank-import.csv'

// The raw block of the client's own export, headers and all. The last row names
// an account nobody has mapped, which is the case that must not be dropped.
const CSV = [
  'Date,Original Date,Account Type,Account Name,Account Number,Institution Name,'
    + 'Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible',
  `${DAY},${DAY},Cash,USD account,6086,Wise (US),Interest (Received),,`
    + '-6.81,Interest (Received),Income,,,',
  `${DAY},${DAY},Cash,PERFBUS CHK,9530,Chase,SERVICE CHARGES,,`
    + '32.5,SERVICE CHARGES FOR THE MONTH,Fees,,,',
  `${DAY},${DAY},Cash,Business Adv Relationship,3388,Bank of America,WIRE OUT,,`
    + '"85,562.85","WIRE TYPE:INTL OUT, BNF:LOTUS STAR LTD",Internal Transfers,,,',
  `${DAY},${DAY},Cash,Some Other Bank,9999,Nowhere,MYSTERY,,`
    + '10,MYSTERY LINE,Fees,,,',
].join('\r\n')

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

try {
  const dir = mkdtempSync(join(tmpdir(), 'pc49-'))
  const path = join(dir, FILE_NAME)
  writeFileSync(path, `﻿${CSV}`, 'utf8')

  const page = await openPage(browser)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', 'kt@pc49.test')
  await page.fill('input[autocomplete="current-password"]', PASSWORD.KT)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 60000 })

  await page.goto(`${BASE}/cash`, { waitUntil: 'networkidle' })
  check('the cash screen offers a way in for a statement',
    (await page.locator('text=Nhập sao kê').count()) > 0)

  await page.locator('input[type="file"]').setInputFiles(path)
  await page.waitForTimeout(4000)

  const said = (await page.locator('body').textContent()) ?? ''
  check('it says what it recorded and what it could not place',
    said.includes('3 dòng đã ghi') && said.includes('1 dòng chờ xếp tài khoản'),
    said.match(/\d+ dòng[^,]*/g)?.join(' · ') ?? '(nothing said)')

  // Rocket is inverted: a negative Amount is money IN.
  const interest = await db.query(
    `SELECT direction::text AS d, amount::text AS a, cash_account_code AS acct
       FROM pc49.cash_txn WHERE txn_date = $1 AND description = 'Interest (Received)'`, [DAY])
  check('a negative amount is read as money in, at its absolute value',
    interest.rows[0]?.d === 'IN' && Number(interest.rows[0]?.a) === 6.81
      && interest.rows[0]?.acct === '1121-6086',
    `${interest.rows[0]?.d} ${interest.rows[0]?.a} ${interest.rows[0]?.acct}`)

  const charge = await db.query(
    `SELECT direction::text AS d, amount::text AS a, cash_account_code AS acct
       FROM pc49.cash_txn WHERE txn_date = $1 AND description LIKE 'SERVICE CHARGES%'`, [DAY])
  check('a positive amount is read as money out',
    charge.rows[0]?.d === 'OUT' && Number(charge.rows[0]?.a) === 32.5
      && charge.rows[0]?.acct === '1121-9530',
    `${charge.rows[0]?.d} ${charge.rows[0]?.a} ${charge.rows[0]?.acct}`)

  // The description holds a comma inside quotes, and the amount a thousands
  // separator: the two things that break a naive reader.
  const wire = await db.query(
    `SELECT amount::text AS a, description AS d FROM pc49.cash_txn
      WHERE txn_date = $1 AND cash_account_code = '1121-3388'`, [DAY])
  check('a quoted description and a separated figure both survive',
    Number(wire.rows[0]?.a) === 85562.85 && (wire.rows[0]?.d ?? '').includes('BNF:LOTUS STAR'),
    `${wire.rows[0]?.a}`)

  // Importing and then not being able to see what came in is half a feature.
  // The movements table reads one month, so it is opened at the month imported
  // — the unplaced queue is not period-filtered, because a line nobody can
  // place has no month yet.
  await page.goto(`${BASE}/cash?period=${DAY.slice(0, 7)}`, { waitUntil: 'networkidle' })
  const listed = (await page.locator('body').textContent()) ?? ''
  check('the movements are listed, with direction carrying the sign',
    listed.includes('Interest (Received)') && listed.includes('6.81')
      && listed.includes('SERVICE CHARGES'))
  check('the unplaced line is readable, not just counted',
    listed.includes('no account mapped for 9999') && listed.includes('MYSTERY'))

  const held = await db.query(
    `SELECT raw_account_no AS no, reason FROM pc49.bank_import_row r
       JOIN pc49.bank_import_batch b ON b.id = r.batch_id
      WHERE b.file_name = $1`, [FILE_NAME])
  check('a line nobody can place is held, with the reason on it',
    held.rows.length === 1 && held.rows[0].no === '9999'
      && /no account mapped/.test(held.rows[0].reason),
    held.rows[0]?.reason ?? '(nothing held)')

  const counts = await db.query(
    `SELECT row_count, matched_count, unmatched_count FROM pc49.bank_import_batch
      WHERE file_name = $1`, [FILE_NAME])
  check('the batch counts what it did',
    counts.rows[0]?.row_count === 4 && counts.rows[0]?.matched_count === 3
      && counts.rows[0]?.unmatched_count === 1,
    `${counts.rows[0]?.row_count}/${counts.rows[0]?.matched_count}/${counts.rows[0]?.unmatched_count}`)

  // A file exported from the wrong sheet is the usual mistake, and the message
  // has to say which sheet rather than "invalid format".
  const wrong = join(dir, 'working-sheet.csv')
  writeFileSync(wrong, 'DATA,Note\n121 - PC49 BoA CK 3388,something\n', 'utf8')
  await page.locator('input[type="file"]').setInputFiles(wrong)
  await page.waitForTimeout(2500)
  const refused = (await page.locator('body').textContent()) ?? ''
  check('the wrong sheet is refused by name, not as "invalid format"',
    refused.includes('Date') && refused.includes('working sheet'))
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await db.query(`DELETE FROM pc49.cash_txn WHERE import_batch_id IN (
                    SELECT id FROM pc49.bank_import_batch WHERE file_name IN ($1, 'working-sheet.csv'))`,
                 [FILE_NAME])
  await db.query(`DELETE FROM pc49.bank_import_row WHERE batch_id IN (
                    SELECT id FROM pc49.bank_import_batch WHERE file_name IN ($1, 'working-sheet.csv'))`,
                 [FILE_NAME])
  await db.query(`DELETE FROM pc49.bank_import_batch WHERE file_name IN ($1, 'working-sheet.csv')`,
                 [FILE_NAME])
  await db.query(`DELETE FROM pc49.cash_txn WHERE txn_date = $1`, [DAY])

  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.cash_txn WHERE txn_date = $1) AS txns,
            (SELECT count(*)::int FROM pc49.bank_import_batch) AS batches`, [DAY])
  check('the check cleaned up after itself',
    left.rows[0].txns === 0 && left.rows[0].batches === 0,
    `${left.rows[0].txns} transactions, ${left.rows[0].batches} batches`)
  await db.end()
}

console.log(failures === 0 ? '\nALL BANK IMPORT CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
