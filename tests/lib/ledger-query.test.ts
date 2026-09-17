import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PAGE_SIZE, ledgerSearch, parseLedgerQuery, presetRange, rpcArgs, singleDay,
} from '@/components/gold/ledgerQuery'

const EMPTY = {
  from: null, to: null, type: null, gold: null, staff: null, method: null,
  status: null, q: '', page: 1, size: DEFAULT_PAGE_SIZE,
}

describe('reading the ledger filter from the address', () => {
  it('takes the receipts still owed as a payment filter', () => {
    expect(parseLedgerQuery({ method: 'OWED' }).method).toBe('OWED')
  })

  it('shows everything, newest first, when nothing is asked for', () => {
    expect(parseLedgerQuery({})).toEqual(EMPTY)
  })

  it('opens an old one-day link on that day', () => {
    expect(parseLedgerQuery({ date: '2026-01-08' }))
      .toEqual({ ...EMPTY, from: '2026-01-08', to: '2026-01-08' })
    expect(parseLedgerQuery({ date: '2026-01-08', from: '2026-01-01' }))
      .toEqual({ ...EMPTY, from: '2026-01-01' })
  })

  it('reads every filter it knows', () => {
    expect(parseLedgerQuery({
      from: '2026-01-01', to: '2026-01-31', type: 'SALE', gold: 'RP', staff: 'N.Ý',
      method: 'ZELLE', status: 'locked', q: '  khanh  ', page: '3', size: '100',
    })).toEqual({
      from: '2026-01-01', to: '2026-01-31', type: 'SALE', gold: 'RP', staff: 'N.Ý',
      method: 'ZELLE', status: 'locked', q: 'khanh', page: 3, size: 100,
    })
  })

  it('ignores what it does not understand instead of failing', () => {
    expect(parseLedgerQuery({
      from: '2026-02-30', to: '01-31-2026', type: 'REFUND', method: 'VENMO',
      status: 'maybe', page: '-2', size: '37', gold: '  ',
    })).toEqual(EMPTY)
    expect(parseLedgerQuery({ page: 'abc' }).page).toBe(1)
  })

  it('puts a range typed back to front the right way round', () => {
    expect(parseLedgerQuery({ from: '2026-03-31', to: '2026-03-01' }))
      .toMatchObject({ from: '2026-03-01', to: '2026-03-31' })
  })

  it('takes the first value when a parameter is repeated', () => {
    expect(parseLedgerQuery({ type: ['PO', 'SALE'] }).type).toBe('PO')
  })
})

describe('writing the ledger filter back into the address', () => {
  it('leaves out what is at its default, so a plain ledger has a plain address', () => {
    expect(ledgerSearch(EMPTY)).toBe('')
  })

  it('round-trips through the address', () => {
    const q = { ...EMPTY, from: '2026-01-01', to: '2026-01-31', type: 'PO', q: 'kh', page: 2, size: 20 }
    const search = ledgerSearch(q)
    expect(search).toBe('?from=2026-01-01&to=2026-01-31&type=PO&q=kh&page=2&size=20')
    expect(parseLedgerQuery(Object.fromEntries(new URLSearchParams(search)))).toEqual(q)
  })

  it('goes back to the first page when a filter changes, but not when the page does', () => {
    const on3 = { ...EMPTY, page: 3 }
    expect(ledgerSearch(on3, { gold: 'SG' })).toBe('?gold=SG')
    expect(ledgerSearch(on3, { page: 4 })).toBe('?page=4')
  })
})

describe('the quick ranges', () => {
  it('covers today, the last seven days and all time', () => {
    expect(presetRange('today', '2026-03-01')).toEqual({ from: '2026-03-01', to: '2026-03-01' })
    expect(presetRange('last7', '2026-03-01')).toEqual({ from: '2026-02-23', to: '2026-03-01' })
    expect(presetRange('all', '2026-03-01')).toEqual({ from: null, to: null })
  })

  it('knows where months and years end', () => {
    expect(presetRange('thisMonth', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(presetRange('thisMonth', '2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(presetRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('thisYear', '2026-09-15')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
})

describe('what the screen and the database need from a filter', () => {
  it('knows when exactly one day is being looked at', () => {
    expect(singleDay({ ...EMPTY, from: '2026-01-08', to: '2026-01-08' })).toBe('2026-01-08')
    expect(singleDay({ ...EMPTY, from: '2026-01-08', to: '2026-01-09' })).toBeNull()
    expect(singleDay(EMPTY)).toBeNull()
  })

  it('names the database arguments', () => {
    expect(rpcArgs({ ...EMPTY, from: '2026-01-01', status: 'correctable', q: 'kh' })).toEqual({
      p_from: '2026-01-01', p_to: null, p_type: null, p_gold: null, p_staff: null,
      p_method: null, p_status: 'correctable', p_query: 'kh',
    })
  })
})
