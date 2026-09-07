import type { MessageKey } from '@/lib/i18n'

/**
 * What a page loader knows about one figure.
 *
 * PC49-02 in the interface handoff of 05-09-2026. Every loader in this system
 * read Supabase results as `data ?? 0` or `data ?? []`, and Supabase does not
 * reject a failed query — it returns an object carrying an `error`. So a
 * balance that could not be read became a balance of zero, an inventory that
 * could not be read became no gold at all, and the screen presented both as
 * facts. `Promise.all` does not help: nothing throws.
 *
 * The states are deliberately few, and the distinctions are the ones somebody
 * reading a set of books actually needs:
 *
 *   ready        the query succeeded and this is the figure. Zero belongs here
 *                and only here — a zero on screen must be a real zero.
 *   unavailable  the query succeeded and the figure cannot be worked out, for
 *                a reason from the business rather than the network: no spot
 *                price for the day, so no valuation exists to show.
 *   error        the query failed. Nothing is known, and saying so is the
 *                whole point.
 *
 * `fetchedAt` is when the read succeeded, not when the data is from. The
 * handoff is firm about not labelling it "last updated": those are different
 * facts and conflating them tells somebody their figures are fresher than
 * they are.
 */
export type DataState<T> =
  | { state: 'ready'; value: T; fetchedAt: string }
  | { state: 'unavailable'; reasonKey: MessageKey }
  | { state: 'error'; messageKey: MessageKey; detail?: string }

/** The shape every Supabase read comes back in, success or failure. */
type Read<T> = { data: T | null; error: { message: string } | null }

/**
 * Folds one Supabase result into a state, without inventing a value for a
 * failure.
 *
 * `whenNull` exists because a successful read can legitimately produce
 * nothing: a count over an empty table, a sum over no rows. That is a real
 * zero and belongs in `ready`. A failure never reaches it.
 */
export function readState<T, V>(
  read: Read<T>,
  map: (data: T) => V,
  whenNull: () => V,
): DataState<V> {
  if (read.error) {
    return {
      state: 'error',
      messageKey: 'common.loadFailed',
      // Kept for the person who has to work out why, not shown as the whole
      // message: a Postgres sentence is not an explanation for an accountant.
      detail: read.error.message,
    }
  }
  return {
    state: 'ready',
    value: read.data === null ? whenNull() : map(read.data),
    fetchedAt: new Date().toISOString(),
  }
}

/**
 * Combines two figures into one, and refuses to add across a hole.
 *
 * The handoff's example is the one that matters: a total that depends on a
 * source which failed must say it is missing, not quietly add zero for the
 * part it could not read. A subtotal presented as a total is worse than no
 * total, because nobody can see that it is short.
 */
export function combine<A, B, V>(
  a: DataState<A>,
  b: DataState<B>,
  map: (a: A, b: B) => V,
): DataState<V> {
  if (a.state === 'error') return a
  if (b.state === 'error') return b
  if (a.state === 'unavailable') return a
  if (b.state === 'unavailable') return b
  return { state: 'ready', value: map(a.value, b.value), fetchedAt: a.fetchedAt }
}
