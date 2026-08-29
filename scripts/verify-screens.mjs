// Signs in and opens every screen, checking each renders its own content and
// that a role without permission is refused. Run with the dev server up.
import { chromium } from 'playwright'
import { openPage } from './support/page.mjs'
import { passwordFor } from './support/accounts.mjs'

/** Resolved before anything is launched, so a missing password is
 *  reported as a missing password rather than as a failed sign-in. */
const PASSWORD = {
  KT: passwordFor('KT'),
  OC: passwordFor('OC'),
}

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(50)}${detail}`)
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[autocomplete="email"]', email)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 60000 })
}

const browser = await chromium.launch()

// The accountant sees every working screen.
{
  const ctx = await browser.newContext()
  const page = await openPage(ctx)
  await signIn(page, 'kt@pc49.test', PASSWORD.KT)

  for (const [path, heading] of [
    ['/', 'Tổng quan'],
    ['/inventory', 'Tồn kho'],
    ['/cash', 'Tiền mặt & Ngân hàng'],
    ['/refining', 'Phân kim'],
    ['/journal', 'Sổ nhật ký'],
    ['/gold-transactions', 'Giao dịch vàng'],
    ['/bank-conversion', 'Quy đổi giao dịch ngân hàng ra vàng'],
    ['/reports', 'Trung tâm báo cáo'],
    ['/import', 'Nạp dữ liệu từ bảng tính'],
    ['/prices', 'Giá vàng theo ngày'],
  ]) {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    const ok = res?.status() === 200
    const h1 = (await page.locator('h1').first().textContent())?.trim() ?? ''
    check(`KT opens ${path}`, ok && h1.startsWith(heading), `${res?.status()} "${h1}"`)
  }
  await page.screenshot({ path: 'screens-inventory.png', fullPage: true })
  await ctx.close()
}

// The owner is read-only: the entry grid must refuse.
{
  const ctx = await browser.newContext()
  const page = await openPage(ctx)
  await signIn(page, 'oc@pc49.test', PASSWORD.OC)

  await page.goto(`${BASE}/inventory`, { waitUntil: 'networkidle' })
  const invOk = ((await page.locator('h1').first().textContent()) ?? '').includes('Tồn kho')
  check('OC may read inventory', invOk)

  await page.goto(`${BASE}/gold-transactions`, { waitUntil: 'networkidle' })
  const body = (await page.locator('body').textContent()) ?? ''
  check('OC is refused the entry grid', body.includes('không có quyền'),
    body.slice(0, 60).replace(/\s+/g, ' '))

  // Loading history rewrites the books, so it is not an owner's screen.
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' })
  const imp = (await page.locator('body').textContent()) ?? ''
  check('OC is refused the data import', imp.includes('không có quyền'),
    imp.slice(0, 60).replace(/\s+/g, ' '))
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL SCREEN CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
