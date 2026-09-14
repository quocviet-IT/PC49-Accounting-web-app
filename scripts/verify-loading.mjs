// A click on the menu answers at once: the skeleton or the destination is on
// screen within 200 ms.
//
//   PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:loading
//
// Run it against a built deployment. The development server compiles each
// route the first time it is asked for and does not prefetch, so a number from
// there says nothing about what a person clicking the menu sees.
import { chromium } from 'playwright'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const TARGET_MS = 200
const ATTEMPTS = 3

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)}${detail}`)
}

const browser = await chromium.launch()
const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 900 } }))
const admin = accountFor('ADMIN')
await signIn(page, BASE, admin.email, admin.password)

/** Milliseconds from the click until the skeleton or the destination shows. */
async function clickToFeedback(label, path) {
  const link = page.locator('.pc-shell__nav').getByRole('link', { name: label, exact: true }).first()
  // The time a person takes to read the menu, in which the router prefetches
  // the loading boundary of the links on screen.
  await page.waitForTimeout(1500)
  const before = await page.locator('h1').first().textContent()
  const start = Date.now()
  await link.click()
  await page.waitForFunction(([previous, target]) =>
    Boolean(document.querySelector('[data-pc-skeleton]'))
      || (location.pathname === target && document.querySelector('h1')?.textContent !== previous),
  [before, path], { polling: 'raf', timeout: 15000 })
  const elapsed = Date.now() - start
  await page.waitForURL((url) => new URL(url).pathname === path)
  await page.waitForLoadState('networkidle')
  return elapsed
}

for (const [from, label, path] of [['/', 'Báo lỗi', '/feedback'], ['/feedback', 'Tổng quan', '/']]) {
  const times = []
  for (let i = 0; i < ATTEMPTS; i += 1) {
    await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle' })
    times.push(await clickToFeedback(label, path))
  }
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
  check(`clicking "${label}" answers within ${TARGET_MS} ms`, median <= TARGET_MS, `${times.join(', ')} ms`)
}

await browser.close()
console.log(failures === 0 ? '\nALL LOADING CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
