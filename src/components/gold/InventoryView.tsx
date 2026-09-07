'use client'

import { useLocale } from '@/lib/i18n/provider'
import {
  Page, Section, Empty, Grams, money, weight, ledger, Frame, LoadFailed,
} from '@/components/ledger/Ledger'

/** Opening, in, out and closing for one gold type over one month. */
export type MovementRow = {
  code: string
  opening: number
  receipt: number
  issue: number
  closing: number
  openingValue: number
  closingValue: number
  /** The correction the source makes when a provisional issue value is settled. */
  adjustment: number
}

export type StockRow = {
  code: string
  nameVi: string
  nameEn: string
  uom: string
  book: number
  physical: number
  total: number
}

export function InventoryView({
  rows, period, asOf, movements, stockFailed = false, movementFailed = false,
}: {
  rows: StockRow[]
  period: string
  asOf: string
  movements: MovementRow[]
  /**
   * The holdings query failed. Not the same as holding nothing, and the
   * difference is the whole of PC49-02: an empty table of stock reads as an
   * empty vault.
   */
  stockFailed?: boolean
  /**
   * The month's movement report did not arrive. The stock figures above it may
   * be perfectly good, so the page stays — but an empty movement table under a
   * closing balance would read as "nothing moved this month", which is a claim
   * about the business, not about a query.
   */
  movementFailed?: boolean
}) {
  const { locale, t } = useLocale()
  const shown = rows.filter((r) => r.book !== 0 || r.physical !== 0 || r.total !== 0)
  const sum = (k: 'book' | 'physical' | 'total') => shown.reduce((s, r) => s + r[k], 0)
  const nameOf = (code: string) => {
    const g = rows.find((r) => r.code === code)
    return g ? (locale === 'vi' ? g.nameVi : g.nameEn) : code
  }
  // A gold type that neither moved nor was held is noise on a monthly report.
  const moved = movements.filter(
    (m) => m.opening !== 0 || m.receipt !== 0 || m.issue !== 0 || m.closing !== 0)

  // Said once, at the top, instead of drawing a table of zeros underneath it.
  if (stockFailed) {
    return (
      <Page titleKey="inv.title" noteKey="inv.explain">
        <Section><LoadFailed /></Section>
      </Page>
    )
  }

  return (
    <Page titleKey="inv.title" noteKey="inv.explain">
      <Section>
        {/* The date the figures below are as at. Kept beside them rather than
            in a corner: a stock figure without a date is not an answer. */}
        <form className="pc-month" method="get" action="/inventory">
          <label htmlFor="asOf">{t('inv.asOf')}</label>
          <input id="asOf" name="asOf" type="date" defaultValue={asOf} />
          <input type="hidden" name="period" value={period} />
          <button type="submit">{t('inv.show')}</button>
        </form>
        {shown.length === 0 ? <Empty /> : (
          <Frame>
<table className={ledger.table}>
              <thead>
                <tr>
                  <th>{t('inv.goldType')}</th>
                  <th>{t('inv.native')}</th>
                  <th className={ledger.num}>{t('inv.book')}</th>
                  <th className={ledger.num}>{t('inv.physical')}</th>
                  <th className={ledger.num}>{t('inv.total')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.code}>
                    <td>{locale === 'vi' ? r.nameVi : r.nameEn}</td>
                    <td className={ledger.muted}>{r.uom}</td>
                    <td className={ledger.num}><Grams value={r.book} /></td>
                    <td className={ledger.num}><Grams value={r.physical} /></td>
                    <td className={ledger.num}><Grams value={r.total} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>{t('common.total')} ({t('inv.gram')})</td>
                  <td className={ledger.num}><Grams value={sum('book')} /></td>
                  <td className={ledger.num}><Grams value={sum('physical')} /></td>
                  <td className={ledger.num}><Grams value={sum('total')} /></td>
                </tr>
              </tfoot>
            </table>
          </Frame>
        )}
      </Section>
      <Section titleKey="inv.movement">
        <form className="pc-month" method="get" action="/inventory">
          <label htmlFor="period">{t('common.period')}</label>
          <input id="period" name="period" type="month" defaultValue={period} />
          <button type="submit">{t('inv.show')}</button>
        </form>
        <p className={ledger.note}>{t('inv.movementNote')}</p>
        {movementFailed ? <LoadFailed /> : moved.length === 0 ? <Empty /> : (
          <Frame>
            <table className={ledger.table}>
              <colgroup>
                <col style={{ width: '22%' }} /><col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} /><col style={{ width: '15%' }} />
                <col style={{ width: '15%' }} /><col style={{ width: '18%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('inv.goldType')}</th>
                  <th className={ledger.num}>{t('inv.opening')}</th>
                  <th className={ledger.num}>{t('inv.receipt')}</th>
                  <th className={ledger.num}>{t('inv.issue')}</th>
                  <th className={ledger.num}>{t('inv.closing')}</th>
                  <th className={ledger.num}>{t('inv.adjustment')}</th>
                </tr>
              </thead>
              <tbody>
                {moved.map((m) => (
                  <tr key={m.code}>
                    <td>{nameOf(m.code)} <span className={ledger.muted}>{m.code}</span></td>
                    <td className={ledger.num}>{weight.format(m.opening)}</td>
                    <td className={ledger.num}><Grams value={m.receipt} /></td>
                    <td className={ledger.num}><Grams value={-Math.abs(m.issue)} /></td>
                    <td className={ledger.num}>{weight.format(m.closing)}</td>
                    {/* The source values an issue provisionally and corrects it
                        later. That correction is its own column here rather
                        than folded into cost, because in January 2026 it was
                        70,125.12 against a gross profit of 31,008.27. */}
                    <td className={`${ledger.num} ${m.adjustment === 0 ? ledger.muted : ''}`}>
                      {m.adjustment === 0 ? '—' : money.format(m.adjustment)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Frame>
        )}
      </Section>
    </Page>
  )
}
