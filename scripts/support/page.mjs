/**
 * Opening a page for a check, with timeouts that suit what it is driving.
 *
 * These run against a development server that compiles each route the first
 * time it is asked for, and that gets slower as a machine gets busier — a cold
 * navigation measured at eighteen seconds on this laptop while other checks
 * were running. Playwright's defaults are thirty seconds for a navigation and
 * five for an action, which is right for a built application and too tight for
 * this one.
 *
 * Generous on purpose. A check that goes red because a machine was busy teaches
 * people to rerun it rather than read it, and then a real failure gets rerun
 * too.
 */

/** How long a navigation may take before something is genuinely wrong. */
export const NAVIGATION_TIMEOUT = 60000

/** How long to wait for an element, which does not involve compiling a route. */
export const ACTION_TIMEOUT = 20000

/** A page with those timeouts already set. Takes a browser or a context. */
export async function openPage(target) {
  const page = await target.newPage()
  page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT)
  page.setDefaultTimeout(ACTION_TIMEOUT)
  return page
}

/**
 * Signs in and waits to land on the dashboard.
 *
 * Every check starts this way, and every one of them was carrying its own copy
 * of the four lines and its own opinion about the timeout.
 */
export async function signIn(page, base, email, password) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[autocomplete="email"]', email)
  await page.fill('input[autocomplete="current-password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${base}/`, { timeout: NAVIGATION_TIMEOUT })
}

/**
 * Clicks until the thing the click was for has happened.
 *
 * A button whose only behaviour is an onClick handler does nothing at all until
 * React has hydrated, and a click that lands in that window is silently lost —
 * no error, no effect, and a check that fails one run in six with no
 * explanation. Waiting for the page to look ready does not help: the markup is
 * already there, server-rendered, before any of it is wired up.
 *
 * So the click is repeated until `done()` says it worked. `done` is usually a
 * database read, because that is the fact the click was for.
 */
export async function clickUntil(locator, done, { timeout = 30000, every = 2000 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    await locator.click()
    const start = Date.now()
    // Give this attempt a moment to land before deciding it did not.
    while (Date.now() - start < every) {
      if (await done()) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    if (Date.now() >= deadline) return false
  }
}
