/**
 * Reading a CSV somebody exported from their bank.
 *
 * Written here rather than taken from a package because the whole job is one
 * loop, and a bank statement is the last file to hand to a dependency nobody
 * reads. The awkward parts are real, though, and each has a test: a bank
 * description contains commas and quotes almost every time, a field can span
 * lines, and files arrive with CRLF, a byte-order mark, or both.
 *
 * Pure: no React, no filesystem.
 */

/** One record, keyed by the header above it. */
export type Row = Record<string, string>

/**
 * Splits the text into fields, honouring quotes.
 *
 * A quoted field may contain commas, newlines, and doubled quotes standing for
 * one. Everything outside quotes is taken literally, which is what makes a bare
 * apostrophe in a name harmless.
 */
export function parseCsv(text: string): string[][] {
  // A byte-order mark is invisible and turns the first header into something
  // that matches nothing.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  while (i < source.length) {
    const c = source[i]

    if (quoted) {
      if (c === '"') {
        // A doubled quote is one quote; a single one ends the field.
        if (source[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i += 1; continue
      }
      field += c; i += 1; continue
    }

    if (c === '"') { quoted = true; i += 1; continue }
    if (c === ',') { row.push(field); field = ''; i += 1; continue }
    if (c === '\r') { i += 1; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue }
    field += c; i += 1
  }

  // Whatever is left when the text runs out is the last field of the last row,
  // unless the file simply ended with a newline.
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/**
 * The rows as records, using the first line as the header.
 *
 * Headers are matched case-insensitively and with surrounding space ignored,
 * because a file that has been through Excel usually has picked some up.
 */
export function parseRecords(text: string): { headers: string[]; rows: Row[] } {
  const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''))
  if (table.length === 0) return { headers: [], rows: [] }

  const headers = table[0].map((h) => h.trim())
  const rows = table.slice(1).map((cells) => {
    const row: Row = {}
    headers.forEach((h, i) => { row[h.toLowerCase()] = (cells[i] ?? '').trim() })
    return row
  })
  return { headers, rows }
}

/** Reads a field by name, whatever case the file used. */
export function value(row: Row, name: string): string {
  return row[name.toLowerCase()] ?? ''
}

/**
 * A figure as the bank wrote it.
 *
 * Statements arrive with thousands separators, currency symbols, and negatives
 * in brackets. Returns null when there is no number, which the caller must
 * treat as a row it cannot place rather than as zero.
 */
export function money(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const negative = /^\(.*\)$/.test(trimmed)
  const cleaned = trimmed.replace(/[()$\s,]/g, '')
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/**
 * A date as the bank wrote it, normalised to what the database expects.
 *
 * Rocket exports ISO, but a file that has been opened in Excel and saved again
 * comes back in the machine's local format, which on this team's laptops is
 * US order. Anything else is refused rather than guessed: a date read the wrong
 * way round lands in the wrong month and nothing downstream ever complains.
 */
export function isoDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(trimmed)
  if (us) {
    const [, m, d, y] = us
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}
