/**
 * Waiting for something to become true, rather than for a stopwatch.
 *
 * These checks drive a browser against a development server that compiles on
 * demand, so the same click takes 200ms on a warm route and eight seconds on a
 * cold one. Sleeping a fixed time either wastes the difference or fails on it,
 * and a check that goes red depending on machine load is a check people learn
 * to ignore.
 *
 * The condition is usually a database read: the screen has done its job when
 * the row is there, and that is a fact rather than a guess about rendering.
 */

/**
 * Polls `condition` until it returns something truthy, or gives up.
 *
 * Returns whatever the condition returned, so a caller can wait for a row and
 * use it in one step. On timeout it returns null rather than throwing — the
 * caller's own check then reports the failure with its own words, which reads
 * better than a stack trace from inside a helper.
 */
export async function until(condition, { timeout = 20000, every = 250 } = {}) {
  const deadline = Date.now() + timeout
  for (;;) {
    const answer = await condition()
    if (answer) return answer
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, every))
  }
}

/** Waits for a query to return at least one row, and hands back the first. */
export async function untilRow(db, sql, params = [], options) {
  return until(async () => {
    const r = await db.query(sql, params)
    return r.rows[0] ?? null
  }, options)
}

/** Waits for a query's first row to satisfy `ok`. */
export async function untilRowIs(db, sql, params, ok, options) {
  return until(async () => {
    const r = await db.query(sql, params)
    const row = r.rows[0]
    return row && ok(row) ? row : null
  }, options)
}

/** Waits for a query to return no rows at all. */
export async function untilGone(db, sql, params = [], options) {
  return until(async () => {
    const r = await db.query(sql, params)
    return r.rows.length === 0 ? true : null
  }, options)
}
