/**
 * The gold ledger's filter, as it lives in the page address.
 *
 * The address is the filter so that a view of the ledger is a place: it
 * survives a reload, it can be sent to somebody, the back button returns to
 * the filter before, and the Excel export asks for exactly the rows on screen.
 *
 * Pure: no React, no Next, no database. The page, the screen and the export
 * route all read the address through this one module.
 */
import { PAYMENT_METHODS } from './types'

/** Every value of pc49.txn_type, in the order the database declares them. */
export const LEDGER_TXN_TYPES = [
  'PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'PICKUP',
  'TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP', 'ON_THE_WAY', 'CANCEL', 'MEMO',
] as const

export const PAGE_SIZES = [20, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 50

export type LedgerStatus = 'correctable' | 'locked'

export type LedgerQuery = {
  from: string | null
  to: string | null
  type: string | null
  gold: string | null
  staff: string | null
  method: string | null
  status: LedgerStatus | null
  q: string
  page: number
  size: number
}

export type Preset = 'today' | 'last7' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'all'

type Params = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

/** A calendar date that really exists, written YYYY-MM-DD, or null. */
function isoDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== raw ? null : raw
}

function code(raw: string | undefined, max: number): string | null {
  const v = (raw ?? '').trim()
  return v === '' || v.length > max ? null : v
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[]): T | null {
  return allowed.includes(raw as T) ? (raw as T) : null
}

/**
 * The filter an address asks for.
 *
 * Anything it does not understand is treated as not asked for: a link with a
 * typo still opens the ledger rather than an error page. An old one-day link,
 * `?date=`, opens on that day unless the address also names a range.
 */
export function parseLedgerQuery(params: Params): LedgerQuery {
  let from = isoDate(first(params.from))
  let to = isoDate(first(params.to))
  if (from === null && to === null) {
    const day = isoDate(first(params.date))
    if (day) { from = day; to = day }
  }
  // A range typed back to front is still a range.
  if (from && to && from > to) [from, to] = [to, from]

  const page = Number(first(params.page))
  const size = Number(first(params.size))

  return {
    from,
    to,
    type: oneOf(first(params.type), LEDGER_TXN_TYPES),
    gold: code(first(params.gold), 40),
    staff: code(first(params.staff), 40),
    method: oneOf(first(params.method), PAYMENT_METHODS),
    status: oneOf(first(params.status), ['correctable', 'locked'] as const),
    q: (first(params.q) ?? '').trim().slice(0, 100),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  }
}

/**
 * The address for a filter, with `patch` applied.
 *
 * Changing anything but the page goes back to page one: page three of a
 * different filter is a page nobody asked for. Defaults are left out so the
 * plain ledger has a plain address.
 */
export function ledgerSearch(query: LedgerQuery, patch: Partial<LedgerQuery> = {}): string {
  const next = { ...query, ...patch }
  if (Object.keys(patch).length > 0 && !('page' in patch)) next.page = 1
  const out = new URLSearchParams()
  const put = (key: string, value: string | number | null) => {
    if (value !== null && value !== '') out.set(key, String(value))
  }
  put('from', next.from)
  put('to', next.to)
  put('type', next.type)
  put('gold', next.gold)
  put('staff', next.staff)
  put('method', next.method)
  put('status', next.status)
  put('q', next.q)
  if (next.page !== 1) put('page', next.page)
  if (next.size !== DEFAULT_PAGE_SIZE) put('size', next.size)
  const s = out.toString()
  return s ? `?${s}` : ''
}

const DAY_MS = 86_400_000
const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (day: string) => new Date(`${day}T00:00:00Z`)

/** The range a quick button stands for, counted from `today` (YYYY-MM-DD). */
export function presetRange(preset: Preset, today: string): { from: string | null; to: string | null } {
  const d = utc(today)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  switch (preset) {
    case 'today': return { from: today, to: today }
    case 'last7': return { from: iso(new Date(d.valueOf() - 6 * DAY_MS)), to: today }
    case 'thisMonth': return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m + 1, 0))) }
    case 'lastMonth': return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
    case 'thisYear': return { from: `${y}-01-01`, to: `${y}-12-31` }
    case 'all': return { from: null, to: null }
  }
}

/** The one day being looked at, when the range is a single day. */
export function singleDay(query: LedgerQuery): string | null {
  return query.from !== null && query.from === query.to ? query.from : null
}

/** The filter as the arguments of pc49.gold_txn_ledger and _totals (0068). */
export function rpcArgs(query: LedgerQuery) {
  return {
    p_from: query.from,
    p_to: query.to,
    p_type: query.type,
    p_gold: query.gold,
    p_staff: query.staff,
    p_method: query.method,
    p_status: query.status,
    p_query: query.q === '' ? null : query.q,
  }
}
