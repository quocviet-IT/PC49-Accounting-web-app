import { describe, it, expect } from 'vitest'
import { readState, combine } from '@/lib/data/result'

/**
 * The fault these guard against is PC49-02: Supabase does not reject a failed
 * query, it returns an object carrying an error. Every loader in this system
 * read that as `data ?? 0`, so a balance nobody could read was drawn as a
 * balance of zero, beside figures that were real, with nothing to tell them
 * apart.
 */
describe('reading one figure', () => {
  it('is ready when the query worked', () => {
    const r = readState({ data: [{ n: 3 }, { n: 4 }], error: null },
      (rows: { n: number }[]) => rows.reduce((s, x) => s + x.n, 0), () => 0)
    expect(r.state).toBe('ready')
    if (r.state === 'ready') expect(r.value).toBe(7)
  })

  it('is ready with a real zero when the query worked and found nothing', () => {
    // A count over an empty table is zero, and that zero is a fact.
    const r = readState({ data: [], error: null },
      (rows: number[]) => rows.length, () => 0)
    expect(r.state).toBe('ready')
    if (r.state === 'ready') expect(r.value).toBe(0)
  })

  it('is an error when the query failed, and never a zero', () => {
    const r = readState({ data: null, error: { message: 'connection reset' } },
      () => 999, () => 0)
    expect(r.state).toBe('error')
    // The value is not merely wrong, it does not exist — there is nothing on
    // this object a screen could mistake for a figure.
    expect('value' in r).toBe(false)
  })

  it('keeps the database sentence for whoever has to diagnose it', () => {
    const r = readState({ data: null, error: { message: 'permission denied' } },
      () => 0, () => 0)
    if (r.state === 'error') {
      expect(r.detail).toBe('permission denied')
      // But the message shown is a stable key, not raw Postgres.
      expect(r.messageKey).toBe('common.loadFailed')
    }
  })
})

describe('a total that depends on two figures', () => {
  const ready = (v: number) =>
    ({ state: 'ready', value: v, fetchedAt: '2026-09-07T00:00:00Z' }) as const

  it('multiplies them when both are known', () => {
    const r = combine(ready(10), ready(150), (g, p) => g * p)
    expect(r.state).toBe('ready')
    if (r.state === 'ready') expect(r.value).toBe(1500)
  })

  it('refuses to add across a hole', () => {
    // The handoff's own example: an inventory that could not be read became a
    // weight of zero and was then multiplied by a price, producing a valuation
    // of nothing that looked exactly like a valuation.
    const failed = { state: 'error', messageKey: 'common.loadFailed' } as const
    const r = combine(failed, ready(150), (g: number, p) => g * p)
    expect(r.state).toBe('error')
  })

  it('reports the business reason ahead of computing anything', () => {
    // No spot price is not a failure to read; it is a figure that does not
    // exist yet, and somebody can go and enter one.
    const noPrice = { state: 'unavailable', reasonKey: 'home.noSpot' } as const
    const r = combine(ready(10), noPrice, (g, p: number) => g * p)
    expect(r.state).toBe('unavailable')
    if (r.state === 'unavailable') expect(r.reasonKey).toBe('home.noSpot')
  })
})
