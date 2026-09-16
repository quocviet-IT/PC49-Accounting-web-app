/**
 * Why a server action never answered.
 *
 *   STALE    the page was built by an earlier deployment, so the server no
 *            longer has the action it is calling. Reloading fixes it.
 *   NETWORK  the request did not get there.
 *   SERVER   anything else the call threw.
 */
export type ActionThrew = {
  ok: false
  reason: 'STALE' | 'NETWORK' | 'SERVER'
  message: string
}

const STALE = /Server Action .* was not found|failed-to-find-server-action/i
const NETWORK = /Failed to fetch|NetworkError|Load failed/i

/**
 * Calls a server action and always comes back with an answer.
 *
 * An action that refuses returns its refusal, and that is handed back
 * untouched. An action that throws — because Production was redeployed while
 * the page was open, or the connection dropped, or the server fell over — used
 * to leave the screen waiting for an answer that never came: on 16-09 both
 * Save buttons on a gold transaction spun for ever, nothing was written and
 * nothing was said. A throw is now an answer too, with its reason named.
 */
export async function settleAction<T>(call: () => Promise<T>): Promise<T | ActionThrew> {
  try {
    return await call()
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    if (STALE.test(message)) return { ok: false, reason: 'STALE', message }
    if (thrown instanceof TypeError && NETWORK.test(message)) {
      return { ok: false, reason: 'NETWORK', message }
    }
    return { ok: false, reason: 'SERVER', message }
  }
}
