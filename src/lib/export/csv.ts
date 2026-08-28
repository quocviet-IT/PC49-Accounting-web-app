/**
 * Writing a report out as a file the accountant can open in Excel.
 *
 * CSV, not xlsx, and that was a decision rather than a shortcut. A real
 * workbook needs a library, and the maintained one pulls a `uuid` with a known
 * advisory; a financial system does not take a known-vulnerable transitive
 * dependency to save somebody a paste. CSV opens in Excel, keeps Vietnamese
 * intact given the byte-order mark below, and has nothing in it that can rot.
 *
 * Pure: no React, no filesystem, no Response. What sends it lives in the route.
 */

/** A value as it should appear in a cell. Null and undefined are simply empty. */
export type Cell = string | number | null | undefined

/**
 * Quotes a field the way the CSV convention requires.
 *
 * Excel decides a field's type from its content, so a code like `0912` or a
 * date-looking string arrives mangled unless it is quoted — and a comma, a
 * quote or a newline inside a field breaks the row outright. Quoting every
 * text field costs nothing and removes the whole class of problem.
 */
function field(value: Cell): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    // Not a locale format: a thousands separator makes Excel read the number
    // as text, which is exactly what nobody wants in a column they will sum.
    return Number.isFinite(value) ? String(value) : ''
  }
  return `"${value.replace(/"/g, '""')}"`
}

export type Sheet = {
  /** Printed above the block, so one file can carry several tables. */
  title?: string
  header: string[]
  rows: Cell[][]
}

/**
 * One file, one or more blocks.
 *
 * A CSV has no notion of sheets, so blocks are separated by a blank line with
 * their own heading — which is how the source spreadsheets lay several tables
 * on one page anyway.
 */
export function toCsv(sheets: Sheet[]): string {
  const lines: string[] = []
  for (const [i, sheet] of sheets.entries()) {
    if (i > 0) lines.push('')
    if (sheet.title) lines.push(field(sheet.title))
    lines.push(sheet.header.map(field).join(','))
    for (const row of sheet.rows) lines.push(row.map(field).join(','))
  }
  // CRLF, because that is what Excel expects from a CSV and what every
  // spreadsheet on Windows writes.
  return lines.join('\r\n')
}

/**
 * The bytes to send.
 *
 * The byte-order mark is the whole reason Vietnamese survives: without it Excel
 * reads a UTF-8 CSV in the system codepage and every accented character arrives
 * as mojibake. It is three bytes and it is not optional here.
 */
export function csvBytes(csv: string): Uint8Array {
  return new TextEncoder().encode(`﻿${csv}`)
}

/** A file name that says what the file is and which period it covers. */
export function reportFileName(report: string, period: string): string {
  return `PC49-${report}-${period}.csv`
}
