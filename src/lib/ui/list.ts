/** Case and accent insensitive matching, including Vietnamese đ. */
export function normalizeSearch(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim()
}

export function matchesSearch(query: string, values: unknown[]): boolean {
  const text = normalizeSearch(values.join(' '))
  return normalizeSearch(query).split(/\s+/).every((word) => text.includes(word))
}

export function pageSlice<T>(rows: readonly T[], requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize))
  const page = Math.max(1, Math.min(requestedPage, Math.ceil(rows.length / size) || 1))
  return { page, rows: rows.slice((page - 1) * size, page * size) }
}
