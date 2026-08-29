// Drives a real browser through the sign-in flow and checks that each role
// lands on the home page with the menu its permissions allow.
// Run with the dev server already running: npm run verify:signin
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import { passwordFor } from './support/accounts.mjs'

/** Resolved before anything is launched, so a missing password is
 *  reported as a missing password rather than as a failed sign-in. */
const PASSWORD = {
  ADMIN: passwordFor('ADMIN'),
  GS_US: passwordFor('GS_US'),
  KT: passwordFor('KT'),
  OC: passwordFor('OC'),
}

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const USERS = [
  { email: 'kt@pc49.test',    password: PASSWORD.KT,    role: 'KT',
    expect: ['Tổng quan', 'Vàng', 'Dòng tiền', 'Sổ sách', 'Báo lỗi', 'Cấu hình'] },
  { email: 'gsus@pc49.test',  password: PASSWORD.GS_US,  role: 'GS_US',
    // No money group: the supervisor reads reports and closes periods, and
    // neither the cash book nor the conversion screen is theirs.
    expect: ['Tổng quan', 'Vàng', 'Sổ sách', 'Báo lỗi', 'Cấu hình'] },
  { email: 'oc@pc49.test',    password: PASSWORD.OC,    role: 'OC',
    // Two groups, each holding the one read-only screen the owner may open —
    // and reporting a problem, which every role gets.
    expect: ['Tổng quan', 'Vàng', 'Sổ sách', 'Báo lỗi'] },
  { email: 'admin@pc49.test', password: PASSWORD.ADMIN, role: 'ADMIN',
    expect: ['Tổng quan', 'Vàng', 'Dòng tiền', 'Sổ sách', 'Báo lỗi', 'Cấu hình'] },
]

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(50)}${detail}`)
}

const browser = await chromium.launch()
for (const u of USERS) {
  const ctx = await browser.newContext()
  const page = await openPage(ctx)
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', u.email)
  await page.fill('input[autocomplete="current-password"]', u.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 60000 }).catch(() => {})

  check(`${u.role} reaches the home page`, new URL(page.url()).pathname === '/', page.url())

  // The menu is a vertical sidebar now. Top-level entries only: a collapsed
  // group's children are not on screen, and asserting on them would pass or
  // fail depending on which group happened to be open.
  const items = await page
    .locator('aside .ant-menu-root > li > .ant-menu-title-content, '
           + 'aside .ant-menu-root > li > .ant-menu-submenu-title .ant-menu-title-content')
    .allTextContents()
  const got = items.map((s) => s.trim()).filter(Boolean)
  check(`${u.role} sees exactly its permitted menu`,
    JSON.stringify(got) === JSON.stringify(u.expect),
    JSON.stringify(got))

  await ctx.close()
}
await browser.close()

console.log(failures === 0 ? '\nALL SIGN-IN CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
