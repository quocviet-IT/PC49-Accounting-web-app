'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, money, weight, ledger, Frame, LoadFailed } from '@/components/ledger/Ledger'
import { saveGoldPrice, saveSpotPrice, carryPricesForward } from '@/app/(app)/settings/actions'
import styles from './PriceGrid.module.css'

export type PriceRow = {
  code: string
  nameVi: string
  nameEn: string
  uom: string
  marketPrice: number | null
  avgPurchasePrice: number | null
  variance: number | null
  tradedQty: number
  soldQty: number
}

export type SpotRow = { metal: 'GOLD' | 'PLATINUM'; perOz: number | null; perGram: number | null }

export type Uncosted = { date: string; code: string; sales: number; revenue: number }

/** A blank cell means no price, which is not the same as a price of zero. */
function toNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function show(value: number | null): string {
  return value === null ? '' : String(value)
}

export function PriceGrid({
  date, previous, rows, spot, uncosted, failed = {},
}: {
  date: string
  previous: string
  rows: PriceRow[]
  spot: SpotRow[]
  uncosted: Uncosted[]
  /**
   * Which reads did not arrive. An empty "sales with no cost price" table is
   * the statement that every sale has one — the exact thing this screen exists
   * to disprove — so it must not be what a failed query looks like.
   */
  failed?: { grid?: boolean; spot?: boolean; uncosted?: boolean }
}) {
  const { locale, t } = useLocale()
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const name = (r: PriceRow) => (locale === 'vi' ? r.nameVi : r.nameEn)
  const key = (code: string, field: string) => `${code}:${field}`
  const value = (code: string, field: string, saved: number | null) =>
    draft[key(code, field)] ?? show(saved)

  function edit(code: string, field: string, raw: string) {
    setDraft((d) => ({ ...d, [key(code, field)]: raw }))
  }

  async function commitGold(row: PriceRow) {
    const market = toNumber(value(row.code, 'market', row.marketPrice))
    const avg = toNumber(value(row.code, 'avg', row.avgPurchasePrice))
    if (market === row.marketPrice && avg === row.avgPurchasePrice) return

    setSaving(row.code)
    setError(null)
    const result = await saveGoldPrice({
      priceDate: date, goldTypeCode: row.code,
      marketPrice: market, avgPurchasePrice: avg,
    })
    setSaving(null)
    if (!result.ok) { setError(`${row.code}: ${result.message}`); return }
    setDraft((d) => {
      const next = { ...d }
      delete next[key(row.code, 'market')]
      delete next[key(row.code, 'avg')]
      return next
    })
    router.refresh()
  }

  async function commitSpot(row: SpotRow) {
    const perOz = toNumber(value(row.metal, 'spot', row.perOz))
    if (perOz === row.perOz) return

    setSaving(row.metal)
    setError(null)
    const result = await saveSpotPrice({ priceDate: date, metal: row.metal, spotPerOz: perOz })
    setSaving(null)
    if (!result.ok) { setError(`${row.metal}: ${result.message}`); return }
    setDraft((d) => {
      const next = { ...d }
      delete next[key(row.metal, 'spot')]
      return next
    })
    router.refresh()
  }

  function carry() {
    setError(null); setSaid(null)
    startTransition(async () => {
      const result = await carryPricesForward({ from: previous, to: date })
      if (result.ok) { setSaid(result.message ?? null); router.refresh() }
      else setError(result.message)
    })
  }

  const priced = rows.filter((r) => r.marketPrice !== null).length
  // A gold type that was sold today with no price set is the one thing on this
  // screen that will silently cost the month money.
  const soldUnpriced = rows.filter((r) => r.soldQty > 0 && r.marketPrice === null)

  return (
    <Page titleKey="price.title" noteKey="price.note">
      <form className={styles.bar} method="get" action="/prices">
        <label htmlFor="date">{t('price.date')}</label>
        <input id="date" name="date" type="date" defaultValue={date} />
        <button type="submit" className={styles.quiet}>{t('price.show')}</button>
        <button
          type="button"
          className={styles.quiet}
          disabled={pending}
          onClick={carry}
          title={previous}
        >
          {t('price.carry')}
        </button>
        <span className={ledger.muted}>
          {priced}/{rows.length} {t('price.priced')}
        </span>
        {said && <span className={styles.said}>{said}</span>}
        {error && <span className={styles.failed}>{error}</span>}
      </form>

      {soldUnpriced.length > 0 && (
        <p className={styles.alarm}>
          {t('price.soldUnpriced')}: {soldUnpriced.map((r) => r.code).join(', ')}
        </p>
      )}

      <Section titleKey="price.gold">
        {failed.grid ? <LoadFailed /> : (
        <Frame>
<table className={ledger.table}>
            <colgroup>
              <col style={{ width: '26%' }} /><col style={{ width: '8%' }} />
              <col style={{ width: '17%' }} /><col style={{ width: '17%' }} />
              <col style={{ width: '14%' }} /><col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('price.goldType')}</th>
                <th>{t('price.uom')}</th>
                <th className={ledger.num}>{t('price.market')}</th>
                <th className={ledger.num}>{t('price.avgPurchase')}</th>
                <th className={ledger.num}>{t('price.variance')}</th>
                <th className={ledger.num}>{t('price.traded')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const needed = r.soldQty > 0 && r.marketPrice === null
                return (
                  <tr key={r.code} className={needed ? styles.needed : undefined}>
                    <td>{name(r)} <span className={ledger.muted}>{r.code}</span></td>
                    <td className={ledger.muted}>{r.uom}</td>
                    <td className={ledger.num}>
                      <input
                        className={styles.cell}
                        inputMode="decimal"
                        aria-label={`${t('price.market')} ${r.code}`}
                        value={value(r.code, 'market', r.marketPrice)}
                        onChange={(e) => edit(r.code, 'market', e.target.value)}
                        onBlur={() => commitGold(r)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        disabled={saving === r.code}
                      />
                    </td>
                    <td className={ledger.num}>
                      <input
                        className={styles.cell}
                        inputMode="decimal"
                        aria-label={`${t('price.avgPurchase')} ${r.code}`}
                        value={value(r.code, 'avg', r.avgPurchasePrice)}
                        onChange={(e) => edit(r.code, 'avg', e.target.value)}
                        onBlur={() => commitGold(r)}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        disabled={saving === r.code}
                      />
                    </td>
                    {/* Which figure costing will use, so nobody has to remember
                        that the purchase price wins when both are set. */}
                    <td className={`${ledger.num} ${ledger.muted}`}>
                      {r.variance === null ? '—' : money.format(r.variance)}
                    </td>
                    <td className={`${ledger.num} ${r.tradedQty > 0 ? '' : ledger.muted}`}>
                      {r.tradedQty > 0 ? weight.format(r.tradedQty) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Frame>
        )}
      </Section>

      <Section titleKey="price.spot">
        {/* A dash here already means "no price". If the read failed it would
            mean that too, and somebody would go and set a price that is
            already set. */}
        {failed.spot ? <LoadFailed /> : (
        <Frame>
<table className={ledger.table}>
            <colgroup>
              <col style={{ width: '34%' }} /><col style={{ width: '33%' }} />
              <col style={{ width: '33%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('price.metal')}</th>
                <th className={ledger.num}>{t('price.perOz')}</th>
                <th className={ledger.num}>{t('price.perGram')}</th>
              </tr>
            </thead>
            <tbody>
              {spot.map((s) => (
                <tr key={s.metal}>
                  <td>{t(s.metal === 'GOLD' ? 'price.gold1' : 'price.platinum')}</td>
                  <td className={ledger.num}>
                    <input
                      className={styles.cell}
                      inputMode="decimal"
                      aria-label={`${t('price.perOz')} ${s.metal}`}
                      value={value(s.metal, 'spot', s.perOz)}
                      onChange={(e) => edit(s.metal, 'spot', e.target.value)}
                      onBlur={() => commitSpot(s)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      disabled={saving === s.metal}
                    />
                  </td>
                  {/* Derived, never typed: the divisor here is 31.1, the valuation
                      figure, not the 31.105 that converts weight. */}
                  <td className={`${ledger.num} ${ledger.muted}`}>
                    {s.perGram === null ? '—' : s.perGram.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
        )}
      </Section>

      {(uncosted.length > 0 || failed.uncosted) && (
        <Section titleKey="price.uncosted">
          <p className={ledger.note}>{t('price.uncostedNote')}</p>
          {failed.uncosted ? <LoadFailed /> : (
          <Frame>
<table className={ledger.table}>
              <colgroup>
                <col style={{ width: '25%' }} /><col style={{ width: '25%' }} />
                <col style={{ width: '20%' }} /><col style={{ width: '30%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('price.date')}</th>
                  <th>{t('price.goldType')}</th>
                  <th className={ledger.num}>{t('price.sales')}</th>
                  <th className={ledger.num}>{t('price.revenueNoCost')}</th>
                </tr>
              </thead>
              <tbody>
                {uncosted.map((u) => (
                  <tr key={`${u.date}:${u.code}`}>
                    <td>
                      <a className={styles.jump} href={`/prices?date=${u.date}`}>{u.date}</a>
                    </td>
                    <td>{u.code}</td>
                    <td className={ledger.num}>{u.sales}</td>
                    <td className={`${ledger.num} ${ledger.out}`}>{money.format(u.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Frame>
          )}
        </Section>
      )}
    </Page>
  )
}
