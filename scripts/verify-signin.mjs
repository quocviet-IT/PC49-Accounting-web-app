// Drives a real browser through the sign-in flow and checks that each role
// lands on the home page with the menu its permissions allow.
// Run with the dev server already running: npm run verify:signin
import { chromium } from 'playwright'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const USERS = [
  { email: 'kt@pc49.test',    password: 'pc49-test-KT-2026',    role: 'KT',
    expect: ['Tổng quan', 'Giao dịch vàng', 'Tồn kho', 'Phân kim', 'Tiền mặt & Ngân hàng',
             'Quy đổi giao dịch', 'Sổ nhật ký', 'Báo cáo', 'Nạp dữ liệu'] },
  { email: 'gsus@pc49.test',  password: 'pc49-test-GSUS-2026',  role: 'GS_US',
    expect: ['Tổng quan', 'Tồn kho', 'Phân kim', 'Báo cáo'] },
  { email: 'oc@pc49.test',    password: 'pc49-test-OC-2026',    role: 'OC',
    expect: ['Tổng quan', 'Tồn kho', 'Báo cáo'] },
  { email: 'admin@pc49.test', password: 'pc49-test-ADMIN-2026', role: 'ADMIN',
    expect: ['Tổng quan', 'Giao dịch vàng', 'Tồn kho', 'Phân kim', 'Tiền mặt & Ngân hàng',
             'Quy đổi giao dịch', 'Sổ nhật ký', 'Báo cáo', 'Nạp dữ liệu', 'Cấu hình'] },
]

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(50)}${detail}`)
}

const browser = await chromium.launch()
for (const u of USERS) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', u.email)
  await page.fill('input[autocomplete="current-password"]', u.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 20000 }).catch(() => {})

  check(`${u.role} reaches the home page`, new URL(page.url()).pathname === '/', page.url())

  const items = await page.locator('.ant-menu-horizontal .ant-menu-title-content').allTextContents()
  const got = items.map((s) => s.trim()).filter(Boolean)
  check(`${u.role} sees exactly its permitted menu`,
    JSON.stringify(got) === JSON.stringify(u.expect),
    JSON.stringify(got))

  await ctx.close()
}
await browser.close()

console.log(failures === 0 ? '\nALL SIGN-IN CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
