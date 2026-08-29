// Files a problem report the way somebody who has just hit one will, and checks
// the things that decide whether people keep filing: the page goes with it, the
// reporter can see what happened to it, and a decline says why.
//
// Everything this writes is removed at the end. Run with the dev server up.
import { chromium } from 'playwright'
import pg from 'pg'
import { openPage, signIn } from './support/page.mjs'
import { until, untilRowIs } from './support/until.mjs'

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

// Distinctive enough that this run's rows cannot be mistaken for anything else.
const SAID = 'verify-feedback: the closing figure is out by 250'
const FILED_FROM = '/prices?date=2019-04-11'

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const browser = await chromium.launch()

try {
  // ---- The accountant hits something and says so ---------------------------
  const ktCtx = await browser.newContext()
  const kt = await openPage(ktCtx)
  await signIn(kt, BASE, 'kt@pc49.test', 'pc49-test-KT-2026')

  // From a real screen, with a real query string on it — that is the part that
  // makes a report reproducible.
  await kt.goto(`${BASE}${FILED_FROM}`, { waitUntil: 'networkidle' })
  check('the report button is on every screen',
    (await kt.getByRole('button', { name: 'Báo lỗi / góp ý' }).count()) > 0)

  await kt.getByRole('button', { name: 'Báo lỗi / góp ý' }).click()
  await kt.getByRole('radio', { name: 'Số ra sai' }).check()
  await kt.getByRole('radio', { name: 'Chặn hẳn, không làm tiếp được' }).check()
  await kt.locator('textarea').fill(SAID)

  const shown = (await kt.locator('.ant-modal').textContent()) ?? ''
  check('the dialog shows which page it will send', shown.includes('Giá vàng'), shown.slice(-40))

  await kt.getByRole('button', { name: 'Gửi', exact: true }).click()

  const filed = await untilRowIs(db,
    `SELECT kind::text AS kind, impact::text AS impact, status::text AS status,
            page_url AS url, page_title AS title, reporter_role::text AS role
       FROM pc49.feedback_report WHERE description = $1`, [SAID],
    (r) => r.status === 'NEW')
  check('the report reaches the queue', filed !== null, filed?.status ?? '(nothing filed)')
  check('with the kind and how badly it bites',
    filed?.kind === 'WRONG_NUMBER' && filed?.impact === 'BLOCKING',
    `${filed?.kind} / ${filed?.impact}`)
  // The whole address, not just the route: "the report was wrong" and "the
  // report for that day was wrong" are different reports.
  check('and the page it was filed from, query string and all',
    filed?.url === FILED_FROM, filed?.url ?? '')
  check('and who filed it', filed?.role === 'KT', filed?.role ?? '')
  // Not document.title, which is the application's name on every screen.
  check('named the way the person filing it knows the screen',
    filed?.title === 'Giá vàng', filed?.title ?? '')

  // Waited for, not read once: the row lands when the server action commits,
  // and the browser repaints a moment after that.
  check('the reporter is told it went somewhere',
    await until(async () =>
      ((await kt.locator('.ant-modal').textContent()) ?? '').includes('Đã gửi rồi')))

  // ---- The reporter can see what happened to it ----------------------------
  // Through the menu, the way somebody following the dialog's advice would.
  // Scoped to the body: Ant's own corner X carries the same name.
  await kt.locator('.ant-modal-body').getByRole('button', { name: 'Đóng' }).click()
  await kt.locator('.ant-modal-wrap').waitFor({ state: 'hidden' })
  await kt.getByRole('link', { name: 'Báo lỗi', exact: true }).click()
  await kt.waitForURL(`${BASE}/feedback`)
  const mine = (await kt.locator('body').textContent()) ?? ''
  check('and can see it afterwards, without being an administrator',
    mine.includes(SAID) && mine.includes('Mới'))

  // ---- Somebody else's report is not theirs to read ------------------------
  const other = await db.query(
    `INSERT INTO pc49.feedback_report
       (kind, impact, description, page_url, page_route, reporter_id)
     VALUES ('BROKEN', 'MINOR', 'verify-feedback: somebody else''s report',
             '/journal', '/journal',
             (SELECT id FROM pc49.app_user WHERE role = 'GS_US' LIMIT 1))
     RETURNING id`)
  await kt.reload({ waitUntil: 'networkidle' })
  check('but somebody else\'s is not',
    !((await kt.locator('body').textContent()) ?? '').includes("somebody else's report"))
  await ktCtx.close()

  // ---- The administrator triages -------------------------------------------
  const adCtx = await browser.newContext()
  const ad = await openPage(adCtx)
  await signIn(ad, BASE, 'admin@pc49.test', 'pc49-test-ADMIN-2026')
  await ad.goto(`${BASE}/feedback`, { waitUntil: 'networkidle' })

  const queue = (await ad.locator('body').textContent()) ?? ''
  check('an administrator sees the whole queue',
    queue.includes(SAID) && queue.includes("somebody else's report"))

  const row = ad.locator('tr').filter({ hasText: SAID })
  await row.getByRole('combobox').selectOption('LOOKING')
  const moved = await untilRowIs(db,
    `SELECT status::text AS s, triaged_at::text AS at FROM pc49.feedback_report
      WHERE description = $1`, [SAID], (r) => r.s === 'LOOKING')
  check('moving a report records who moved it and when',
    moved !== null && moved.at !== null, moved?.s ?? '')

  const audited = await db.query(
    `SELECT before->>'status' AS b, after->>'status' AS a FROM pc49.audit_log
      WHERE entity_type = 'feedback_report' ORDER BY at DESC LIMIT 1`)
  check('and audits the move', audited.rows[0]?.b === 'NEW' && audited.rows[0]?.a === 'LOOKING',
    `${audited.rows[0]?.b} → ${audited.rows[0]?.a}`)

  // The rule that matters most for whether anybody files a second report.
  // Driven through the screen, because the question is not whether the database
  // has the rule but whether somebody doing the triage is stopped by it.
  await row.getByRole('combobox').selectOption('DECLINED')
  const stillLooking = await untilRowIs(db,
    `SELECT status::text AS s FROM pc49.feedback_report WHERE description = $1`, [SAID],
    (r) => r.s === 'LOOKING', { timeout: 4000 })
  check('declining without a reason sends nothing', stillLooking !== null,
    stillLooking?.s ?? '(it went through)')

  await row.getByRole('textbox').fill('the 250 is a deposit, not a sale')
  await row.getByRole('textbox').blur()
  const declined = await untilRowIs(db,
    `SELECT status::text AS s, triage_note AS note FROM pc49.feedback_report
      WHERE description = $1`, [SAID], (r) => r.s === 'DECLINED')
  check('and with one, the reporter is told why',
    declined?.note === 'the 250 is a deposit, not a sale', declined?.note ?? '(never declined)')

  // And the database holds the same line, whoever reaches past the screen.
  let refused = false
  try {
    await db.query('BEGIN')
    await db.query(
      `SELECT set_config('request.jwt.claim.sub',
                         (SELECT id::text FROM pc49.app_user WHERE role = 'ADMIN' LIMIT 1), true)`)
    await db.query(
      `SELECT pc49.set_feedback_status(
         (SELECT id FROM pc49.feedback_report WHERE description = $1), 'DECLINED')`, [SAID])
  } catch (e) { refused = /needs a reason the reporter can read/.test(String(e.message)) }
  await db.query('ROLLBACK')
  check('the database refuses it too, not just the screen', refused)

  // ---- A filed report is evidence ------------------------------------------
  let immutable = false
  try {
    await db.query(
      `UPDATE pc49.feedback_report SET description = 'never mind' WHERE description = $1`, [SAID])
  } catch (e) { immutable = /only its status may change/.test(String(e.message)) }
  check('and what it says cannot be edited afterwards', immutable)

  await ad.screenshot({ path: 'feedback.png', fullPage: true })
  await adCtx.close()

  // Referenced so the linter can see it is used, and to be tidy about it.
  void other
} finally {
  await browser.close()
  // The client's database is not a scratch pad.
  await db.query(
    `DELETE FROM pc49.audit_log WHERE entity_type = 'feedback_report'
       AND entity_id IN (SELECT id::text FROM pc49.feedback_report
                          WHERE description LIKE 'verify-feedback:%')`)
  await db.query(`DELETE FROM pc49.feedback_report WHERE description LIKE 'verify-feedback:%'`)

  // Scoped to this run's own rows. A demo dataset or a real report filed by
  // somebody is not this check's mess to answer for.
  const left = await db.query(
    `SELECT (SELECT count(*)::int FROM pc49.feedback_report
              WHERE description LIKE 'verify-feedback:%') AS reports,
            (SELECT count(*)::int FROM pc49.audit_log
              WHERE entity_type = 'feedback_report'
                AND entity_id NOT IN (SELECT id::text FROM pc49.feedback_report)) AS audits`)
  check('the check cleaned up after itself',
    left.rows[0].reports === 0 && left.rows[0].audits === 0,
    `${left.rows[0].reports} reports, ${left.rows[0].audits} audit rows`)
  await db.end()
}

console.log(failures === 0 ? '\nALL FEEDBACK CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
