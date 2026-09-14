'use client'

import { useId } from 'react'
import { money } from '@/components/ledger/Ledger'
import { useLocale } from '@/lib/i18n/provider'
import type { MessageKey } from '@/lib/i18n'
import type { DataState } from '@/lib/data/result'
import type { DashboardTransactionSummary } from './dashboard-series'
import styles from './Overview.module.css'

const TYPE_LABELS: Record<string, MessageKey> = {
  PO: 'home.txnType.PO',
  PO_VENDOR: 'home.txnType.PO_VENDOR',
  SALE: 'home.txnType.SALE',
  DEPOSIT: 'home.txnType.DEPOSIT',
  PICKUP: 'home.txnType.PICKUP',
  TRANSFER_IN: 'home.txnType.TRANSFER_IN',
  TRANSFER_OUT: 'home.txnType.TRANSFER_OUT',
  RA_RP: 'home.txnType.RA_RP',
  ON_THE_WAY: 'home.txnType.ON_THE_WAY',
  CANCEL: 'home.txnType.CANCEL',
  MEMO: 'home.txnType.MEMO',
}

function compactMoney(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    notation: 'compact', maximumFractionDigits: 1,
  }).format(value)
}

export function TransactionCharts({
  activity,
  start,
  end,
  today,
  onRetry,
}: {
  activity: DataState<DashboardTransactionSummary>
  start: string
  end: string
  today: string
  onRetry: () => void
}) {
  const { t, locale } = useLocale()
  const chartTitleId = useId()
  const chartDescriptionId = useId()

  if (activity.state === 'error') {
    return (
      <div className={styles.chartState} role="alert">
        <p className={styles.failedText}>{t('home.activityFailed')}</p>
        <button type="button" className={styles.retry} onClick={onRetry}>{t('common.retry')}</button>
      </div>
    )
  }

  if (activity.state !== 'ready') return null
  const summary = activity.value
  if (summary.transactionCount === 0) {
    return <p className={styles.chartState}>{t('home.activityNone')}</p>
  }

  const width = 900
  const height = 260
  const margin = { top: 16, right: 12, bottom: 34, left: 56 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const maxValue = Math.max(...summary.daily.flatMap((day) => [day.purchases, day.sales]), 1)
  const groupWidth = plotWidth / summary.daily.length
  const barWidth = Math.max(2, groupWidth * 0.34)
  const ticks = [0, 0.5, 1]
  const scope = t('home.activityScope').replace('{0}', start).replace('{1}', end)
  const transactionLabel = t('home.activityTransactions').replace('{0}', String(summary.transactionCount))
  const maxTypeCount = Math.max(...summary.byType.map((item) => item.count), 1)

  return (
    <>
      <form method="get" className={styles.chartPeriod}>
        <label htmlFor="activityEnd">{t('home.activityEnd')}</label>
        <input id="activityEnd" name="activityEnd" type="date" defaultValue={end} max={today} />
        <button type="submit">{t('home.activityApply')}</button>
        <span className={styles.meta}>{scope}</span>
      </form>
      <div className={styles.charts}>
      <article className={styles.chartPanel}>
        <div className={styles.chartHeader}>
          <div>
            <h3 className={styles.chartTitle}>{t('home.activityValues')}</h3>
            <p className={styles.meta}>{scope}</p>
          </div>
          <div className={styles.legend} aria-hidden="true">
            <span><i className={styles.purchaseSwatch} />{t('home.activityPurchases')}</span>
            <span><i className={styles.saleSwatch} />{t('home.activitySales')}</span>
          </div>
        </div>

        <div className={styles.svgFrame}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img"
               aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}>
            <title id={chartTitleId}>{t('home.activityValues')}</title>
            {/* One string per <title> and <desc>, never several pieces: React
                renders pieces there as nothing on the server and as text in
                the browser, and the mismatch threw the dashboard away. */}
            <desc id={chartDescriptionId}>{`${scope}. ${t('home.activityNote')}`}</desc>
            {ticks.map((tick) => {
              const y = margin.top + plotHeight * (1 - tick)
              return (
                <g key={tick}>
                  <line className={styles.gridLine} x1={margin.left} x2={width - margin.right} y1={y} y2={y} />
                  <text className={styles.axisText} x={margin.left - 8} y={y + 4} textAnchor="end">
                    {compactMoney(maxValue * tick, locale)}
                  </text>
                </g>
              )
            })}
            {summary.daily.map((day, index) => {
              const x = margin.left + index * groupWidth
              const purchaseHeight = (day.purchases / maxValue) * plotHeight
              const saleHeight = (day.sales / maxValue) * plotHeight
              const showLabel = index === 0 || index === summary.daily.length - 1 || index % 7 === 0
              return (
                <g key={day.date}>
                  <rect className={styles.purchaseBar} x={x + groupWidth * 0.12}
                        y={margin.top + plotHeight - purchaseHeight} width={barWidth} height={purchaseHeight}>
                    <title>{`${day.date}: ${t('home.activityPurchases')} ${money.format(day.purchases)} USD`}</title>
                  </rect>
                  <rect className={styles.saleBar} x={x + groupWidth * 0.52}
                        y={margin.top + plotHeight - saleHeight} width={barWidth} height={saleHeight}>
                    <title>{`${day.date}: ${t('home.activitySales')} ${money.format(day.sales)} USD`}</title>
                  </rect>
                  {showLabel && (
                    <text className={styles.axisText} x={x + groupWidth / 2} y={height - 10} textAnchor="middle">
                      {day.date.slice(5)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
        <p className={styles.chartNote}>{t('home.activityNote')}</p>

        <details className={styles.chartDetails}>
          <summary>{t('home.activityShowTable')}</summary>
          <div className={styles.chartTableFrame}>
            <table className={styles.chartTable}>
              <thead><tr>
                <th>{t('home.activityDate')}</th>
                <th>{t('home.activityPurchases')}</th>
                <th>{t('home.activitySales')}</th>
              </tr></thead>
              <tbody>{summary.daily.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{money.format(day.purchases)} USD</td>
                  <td>{money.format(day.sales)} USD</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      </article>

      <article className={styles.chartPanel}>
        <div className={styles.chartHeader}>
          <div>
            <h3 className={styles.chartTitle}>{t('home.activityTypes')}</h3>
            <p className={styles.meta}>{transactionLabel} · {scope}</p>
          </div>
        </div>
        <ol className={styles.typeChart} aria-label={t('home.activityTypes')}>
          {summary.byType.map((item) => (
            <li key={item.txnType} className={styles.typeRow}>
              <div className={styles.typeLine}>
                <span>{TYPE_LABELS[item.txnType] ? t(TYPE_LABELS[item.txnType]) : item.txnType}</span>
                <strong>{item.count}</strong>
              </div>
              <div className={styles.typeMeasure} aria-hidden="true"
                   style={{ width: `${Math.max(2, item.count / maxTypeCount * 100)}%` }} />
            </li>
          ))}
        </ol>
      </article>
      </div>
    </>
  )
}
