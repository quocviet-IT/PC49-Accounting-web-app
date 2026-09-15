/**
 * Make counter searches forgiving of Vietnamese accents, punctuation in phone
 * numbers, and differences in case. This remains deliberately locale-neutral:
 * the same normalized value is used for both languages offered by the app.
 *
 * The ledger's own filtering moved to the database (0068, pc49.fold_search),
 * which applies the same rule; this is still what the entry form's customer
 * suggestions match with.
 */
export function normalizeTransactionSearch(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, (letter) => (letter === 'Đ' ? 'D' : 'd'))
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}
