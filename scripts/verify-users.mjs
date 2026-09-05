// Adding a colleague, and everything that follows from it.
//
// `user.manage` was a capability with no screen since 0001, so this whole
// journey was done by hand in the database: no record of who granted what and
// no rule stopping a mistake. What is checked here is the journey an
// administrator actually takes — add somebody, read them their password once,
// watch them be made to replace it, then close the account when they leave.
//
// Everything this writes is removed at the end, including the sign-in itself:
// a check that left a stranger in the client's list of people every run would
// be worse than no check.
import { chromium } from 'playwright'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'
import { until } from './support/until.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const url = process.env.SUPABASE_DB_URL
const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !apiUrl || !serviceKey) {
  console.error('Missing SUPABASE_DB_URL, NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const NEW_EMAIL = 'verify-newcomer@pc49.test'
const NEW_NAME = 'Verify Newcomer'
const CHOSEN = 'chinh-toi-chon-mat-khau-nay'

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)}${detail}`)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()
const admin = createClient(apiUrl, serviceKey, { auth: { persistSession: false } })
const browser = await chromium.launch()

try {
  const boss = accountFor('ADMIN')
  const page = await openPage(browser)
  await signIn(page, BASE, boss.email, boss.password)

  // ---- The screen exists at all --------------------------------------------
  await page.goto(`${BASE}/settings/users`, { waitUntil: 'networkidle' })
  const heading = (await page.locator('h1').first().textContent()) ?? ''
  check('an administrator reaches the list of people', heading.includes('Người dùng'), heading)

  // ---- Adding somebody ------------------------------------------------------
  await page.locator('button', { hasText: 'Thêm người' }).first().click()
  await page.getByLabel('Email đăng nhập', { exact: true }).fill(NEW_EMAIL)
  await page.getByLabel('Họ tên', { exact: true }).fill(NEW_NAME)
  await page.getByLabel('Vai trò', { exact: true }).first().selectOption('KT')
  await page.locator('button', { hasText: 'Lưu' }).first().click()

  const shown = await until(async () => {
    const el = page.locator('code')
    return (await el.count()) > 0 ? (await el.first().textContent())?.trim() : null
  })
  check('the temporary password is shown, once', (shown ?? '').length >= 10,
    shown ? `${shown.length} characters` : '(never appeared)')

  const made = await db.query(
    `SELECT u.full_name, u.role::text AS role, u.must_change_password AS must
       FROM pc49.app_user u JOIN auth.users a ON a.id = u.id WHERE a.email = $1`, [NEW_EMAIL])
  check('and the person is recorded with the role they were given',
    made.rows[0]?.role === 'KT' && made.rows[0]?.full_name === NEW_NAME,
    `${made.rows[0]?.full_name} / ${made.rows[0]?.role}`)
  check('and is marked as still holding somebody else’s password',
    made.rows[0]?.must === true)

  // ---- What the newcomer meets ---------------------------------------------
  const newcomer = await openPage(browser)
  await newcomer.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await newcomer.fill('input[autocomplete="email"]', NEW_EMAIL)
  await newcomer.fill('input[autocomplete="current-password"]', shown)
  await newcomer.click('button[type="submit"]')
  // Anywhere but the sign-in page. `${BASE}/**` matches /login itself, so
  // waiting for that waits for nothing and the next step runs signed out.
  await newcomer.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })

  // Every door is shut but this one.
  await newcomer.goto(`${BASE}/gold-transactions`, { waitUntil: 'networkidle' })
  check('a temporary password opens nothing else until it is replaced',
    newcomer.url().endsWith('/password'), newcomer.url().replace(BASE, ''))

  await newcomer.getByLabel('Mật khẩu mới', { exact: true }).fill(CHOSEN)
  await newcomer.getByLabel('Gõ lại mật khẩu mới', { exact: true }).fill(CHOSEN)
  await newcomer.locator('button', { hasText: 'Đổi mật khẩu' }).first().click()

  const cleared = await until(async () => {
    const r = await db.query(
      `SELECT u.must_change_password AS must FROM pc49.app_user u
         JOIN auth.users a ON a.id = u.id WHERE a.email = $1`, [NEW_EMAIL])
    return r.rows[0]?.must === false ? true : null
  })
  check('choosing their own password clears the flag', cleared === true)

  await newcomer.goto(`${BASE}/gold-transactions`, { waitUntil: 'networkidle' })
  check('and then the screens their role opens are open',
    ((await newcomer.locator('h1').first().textContent()) ?? '').includes('Giao dịch vàng'))

  // ---- Closing the account --------------------------------------------------
  const id = (await db.query(`SELECT id FROM auth.users WHERE email = $1`, [NEW_EMAIL]))
    .rows[0]?.id

  let noReason = false
  try {
    await db.query(`BEGIN`)
    await db.query(
      `SELECT set_config('request.jwt.claim.sub',
                         (SELECT id::text FROM pc49.app_user WHERE role = 'ADMIN'
                           AND suspended_at IS NULL LIMIT 1), true)`)
    await db.query(`SELECT pc49.suspend_user($1, '  ')`, [id])
  } catch (e) { noReason = /needs a reason/.test(String(e.message)) }
  await db.query(`ROLLBACK`)
  check('closing an account with no reason is refused', noReason)

  page.once('dialog', (d) => d.accept('nghỉ việc từ 30-09'))
  const row = page.locator('tr').filter({ hasText: NEW_EMAIL })
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('tr').filter({ hasText: NEW_EMAIL })
    .locator('button', { hasText: 'Khoá' }).click()

  const closed = await until(async () => {
    const r = await db.query(
      `SELECT u.suspended_at FROM pc49.app_user u JOIN auth.users a ON a.id = u.id
        WHERE a.email = $1`, [NEW_EMAIL])
    return r.rows[0]?.suspended_at ? true : null
  })
  check('and with one, the account closes', closed === true)

  const seen = await db.query(
    `SELECT after ->> 'reason' AS why FROM pc49.audit_log
      WHERE entity_type = 'app_user' AND entity_id = $1::text ORDER BY id DESC LIMIT 1`, [id])
  check('with the reason kept, and who did it', seen.rows[0]?.why === 'nghỉ việc từ 30-09',
    seen.rows[0]?.why ?? '(nothing recorded)')

  // A closed account is not a locked screen, it is no role at all — which is
  // what every policy in the system reads.
  const shut = await openPage(browser)
  await shut.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await shut.fill('input[autocomplete="email"]', NEW_EMAIL)
  await shut.fill('input[autocomplete="current-password"]', CHOSEN)
  await shut.click('button[type="submit"]')
  await shut.waitForTimeout(2500)
  await shut.goto(`${BASE}/gold-transactions`, { waitUntil: 'networkidle' })
  const body = (await shut.locator('body').textContent()) ?? ''
  check('somebody whose account is closed reaches nothing',
    !body.includes('Giao dịch vàng · '), body.slice(0, 50).replace(/\s+/g, ' '))

  void row
  await page.screenshot({ path: 'users.png', fullPage: true })
} finally {
  await browser.close()
  // The client's list of people is not a scratch pad.
  const found = await db.query(`SELECT id FROM auth.users WHERE email = $1`, [NEW_EMAIL])
  for (const r of found.rows) {
    await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'app_user'
                     AND entity_id = $1::text`, [r.id])
    await admin.auth.admin.deleteUser(r.id)
  }
  const left = await db.query(`SELECT count(*)::int AS n FROM auth.users WHERE email = $1`,
    [NEW_EMAIL])
  check('the check cleaned up after itself', left.rows[0].n === 0,
    `${left.rows[0].n} account(s) left`)
  await db.end()
}

console.log(failures === 0 ? '\nALL USER CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
// Set rather than called. This check holds a Supabase client as well as a
// database connection, and tearing the process down under them aborts inside
// libuv — which exits 127 and reports a passing run as a failure. Letting Node
// finish closing what it opened costs a moment and tells the truth.
process.exitCode = failures === 0 ? 0 : 1
