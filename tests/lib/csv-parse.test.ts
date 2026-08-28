import { describe, it, expect } from 'vitest'
import { isoDate, money, parseCsv, parseRecords, value } from '@/lib/import/csv-parse'

describe('reading a bank statement', () => {
  it('keeps a comma that lives inside a quoted description', () => {
    // Bank descriptions contain commas almost every time; splitting on them
    // shifts every later column by one and nothing looks obviously wrong.
    const rows = parseCsv('a,b\n"WIRE TYPE:OUT, REF:20",32.5')
    expect(rows[1]).toEqual(['WIRE TYPE:OUT, REF:20', '32.5'])
  })

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('x\n"he said ""ok"""')[1]).toEqual(['he said "ok"'])
  })

  it('lets a quoted field run over a line break', () => {
    const rows = parseCsv('a,b\n"two\nlines",7')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(['two\nlines', '7'])
  })

  it('handles CRLF, which is what a Windows export writes', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('strips the byte-order mark, which is invisible and matches nothing', () => {
    const { headers } = parseRecords('﻿Account Number,Amount\n3388,10')
    expect(headers[0]).toBe('Account Number')
  })

  it('skips blank lines rather than making empty records of them', () => {
    const { rows } = parseRecords('a,b\n1,2\n\n3,4\n')
    expect(rows).toHaveLength(2)
  })

  it('reads a column whatever case the file used', () => {
    const { rows } = parseRecords('Account Number,Amount\n3388,-6.81')
    expect(value(rows[0], 'ACCOUNT NUMBER')).toBe('3388')
    expect(value(rows[0], 'account number')).toBe('3388')
  })

  it('returns nothing for a column the file does not have', () => {
    const { rows } = parseRecords('a\n1')
    expect(value(rows[0], 'nope')).toBe('')
  })
})

describe('a figure as the bank wrote it', () => {
  it.each([
    ['-6.81', -6.81],
    ['32.5', 32.5],
    ['85,562.85', 85562.85],
    ['$1,234.00', 1234],
    ['(137,289.16)', -137289.16],
    ['0', 0],
  ])('reads %s', (raw, expected) => {
    expect(money(raw)).toBe(expected)
  })

  it('says nothing rather than zero when there is no number', () => {
    // Zero is a real amount. A blank is a row nobody can place, and the two
    // must not arrive looking the same.
    expect(money('')).toBeNull()
    expect(money('   ')).toBeNull()
    expect(money('n/a')).toBeNull()
  })
})

describe('a date as the bank wrote it', () => {
  it('reads what Rocket exports', () => {
    expect(isoDate('2026-01-02')).toBe('2026-01-02')
    expect(isoDate('2026-01-02 00:00:00')).toBe('2026-01-02')
  })

  it('reads what Excel writes back after somebody opens the file', () => {
    expect(isoDate('1/2/2026')).toBe('2026-01-02')
    expect(isoDate('01/02/2026')).toBe('2026-01-02')
  })

  it('refuses anything it cannot read rather than guessing', () => {
    // A date read the wrong way round lands in the wrong month and nothing
    // downstream ever complains.
    expect(isoDate('02.01.2026')).toBeNull()
    expect(isoDate('Jan 2 2026')).toBeNull()
    expect(isoDate('')).toBeNull()
  })
})

describe('the shape Rocket actually exports', () => {
  // Taken from the client's own file: the raw block is Date, Original Date,
  // Account Type, Account Name, Account Number, Institution Name, Name,
  // Custom Name, Amount, Description, Category, Note, Ignored From,
  // Tax Deductible.
  const FILE = [
    'Date,Original Date,Account Type,Account Name,Account Number,Institution Name,'
      + 'Name,Custom Name,Amount,Description,Category,Note,Ignored From,Tax Deductible',
    '2026-01-01,2026-01-01,Cash,USD account,6086,Wise (US),Interest (Received),,'
      + '-6.81,Interest (Received),Income,,,',
    '2026-01-02,2026-01-02,Cash,PERFBUS CHK,9530,Chase,CHECK # 1051 01/02,,'
      + '6105,CHECK # 1051 01/02,Cash & Checks,,,',
  ].join('\r\n')

  it('finds every row and the columns the importer needs', () => {
    const { rows } = parseRecords(FILE)
    expect(rows).toHaveLength(2)
    expect(value(rows[0], 'Account Number')).toBe('6086')
    expect(value(rows[0], 'Account Name')).toBe('USD account')
    expect(money(value(rows[0], 'Amount'))).toBe(-6.81)
    expect(isoDate(value(rows[0], 'Date'))).toBe('2026-01-01')
    expect(value(rows[1], 'Category')).toBe('Cash & Checks')
  })

  it('keeps the sign the bank wrote, for the importer to invert', () => {
    // Rocket is inverted: a negative Amount is money IN. The inversion belongs
    // to the database function, and reading must not quietly do it first.
    const { rows } = parseRecords(FILE)
    expect(money(value(rows[0], 'Amount'))).toBeLessThan(0)
    expect(money(value(rows[1], 'Amount'))).toBeGreaterThan(0)
  })
})
