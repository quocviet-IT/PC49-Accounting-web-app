import { describe, it, expect } from 'vitest'
import { csvBytes, reportFileName, toCsv } from '@/lib/export/csv'

describe('writing a report out', () => {
  it('quotes text and leaves numbers bare', () => {
    // A number wrapped in quotes arrives in Excel as text, and a column of text
    // cannot be summed — which is the first thing anybody does to it.
    const csv = toCsv([{ header: ['Chỉ tiêu', 'Số tiền'], rows: [['Doanh thu', 791130.81]] }])
    expect(csv).toContain('"Doanh thu",791130.81')
    expect(csv).not.toContain('"791130.81"')
  })

  it('writes no thousands separator', () => {
    const csv = toCsv([{ header: ['a'], rows: [[1234567.5]] }])
    expect(csv).toContain('1234567.5')
    expect(csv).not.toContain('1,234,567')
  })

  it('survives a comma, a quote and a newline inside a field', () => {
    const csv = toCsv([{
      header: ['note'],
      rows: [['Mua "vàng vụn", 14k'], ['hai\ndòng']],
    }])
    expect(csv).toContain('"Mua ""vàng vụn"", 14k"')
    expect(csv).toContain('"hai\ndòng"')
    // The embedded newline sits inside quotes, so the row count is still right.
    expect(csv.split('\r\n')).toHaveLength(3)
  })

  it('leaves an empty cell empty rather than writing the word null', () => {
    const csv = toCsv([{ header: ['a', 'b'], rows: [[null, undefined]] }])
    expect(csv.endsWith('\r\n,')).toBe(true)
  })

  it('separates blocks with a blank line and its own heading', () => {
    const csv = toCsv([
      { title: 'Lãi lỗ', header: ['a'], rows: [[1]] },
      { title: 'Công nợ', header: ['b'], rows: [[2]] },
    ])
    expect(csv.split('\r\n')).toEqual(['"Lãi lỗ"', '"a"', '1', '', '"Công nợ"', '"b"', '2'])
  })

  it('leads with the byte-order mark, which is what saves Vietnamese', () => {
    // Without it Excel reads a UTF-8 file in the system codepage and every
    // accented character arrives as mojibake.
    const bytes = csvBytes(toCsv([{ header: ['Kỳ'], rows: [] }]))
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('names the file after the report and the period it covers', () => {
    expect(reportFileName('lai-lo', '2026-01')).toBe('PC49-lai-lo-2026-01.csv')
  })
})
