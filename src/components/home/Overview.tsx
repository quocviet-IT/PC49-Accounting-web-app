'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import type { MessageKey } from '@/lib/i18n'
import { Page, Stats, Stat, Section, Frame, money, weight } from '@/components/ledger/Ledger'
import ledger from '@/components/ledger/Ledger.module.css'
import type { DataState } from '@/lib/data/result'
import styles from './Overview.module.css'

export type AttentionItem = {
  key: string
  count: DataState<number>
  href: string
  titleKey: MessageKey
  /** The month or day this count covers, or null when it covers everything. */
  scope: string | null
}

export type RecentRow = {
  id: string
  txnDate: string
  txnType: string
  partnerCode: string | null
  goldTypeCode: string
  qty: number
  uom: string
  amount: number
  posted: boolean
}

type Links = {
  inventory: boolean
  cash: boolean
  deposits: boolean
  refining: boolean
  newTxn: boolean
  prices: boolean
  bankImport: boolean
  reports: boolean
}

/**
 * One figure, or an honest account of why there isn't one.
 *
 * A zero here means zero. Before this, a balance that could not be read was
 * drawn as `0.00` beside three figures that were real, and nothing on the
 * screen distinguished them — which is the worst way for a set of books to be
 * wrong, because it looks exactly like being right.
 */
function StatState({
  labelKey, data, format, note, tone, href, onRetry,
}: {
  labelKey: MessageKey
  data: DataState<number>
  format: (v: number) => string
  note?: string
  tone?: (v: number) => 'in' | 'out' | undefined
  href?: string
  onRetry: () => void
}) {
  const { t } = useLocale()

  if (data.state === 'error') {
    return (
      <div className={styles.failed}>
        <Stat labelKey={labelKey} value="—" note={t('common.loadFailed')} />
        <button type="button" className={styles.retry} onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    )
  }

  if (data.state === 'unavailable') {
    return <Stat labelKey={labelKey} value="—" note={t(data.reasonKey)} />
  }

  const stat = (
    <Stat labelKey={labelKey} value={format(data.value)} note={note} tone={tone?.(data.value)} />
  )
  // A KPI without a page somebody may open stays a figure. It does not become
  // a link that turns out to be a wall.
  return href ? <Link href={href} className={styles.kpiLink}>{stat}</Link> : stat
}

export function Overview({
  inventoryValue, inventoryGram, cashTotal, openDeposits, atRefineryGram,
  priceDate, asOf, period, attention, recent, links,
}: {
  inventoryValue: DataState<number>
  inventoryGram: DataState<number>
  cashTotal: DataState<number>
  openDeposits: DataState<number>
  atRefineryGram: DataState<number>
  priceDate: string | null
  asOf: string
  period: string
  attention: AttentionItem[]
  recent: DataState<RecentRow[]>
  links: Links
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Refreshing the route re-runs the loader with the same day and the same
  // filters, which is what "try again" has to mean: retrying must not quietly
  // move you to a different set of figures.
  const retry = () => startTransition(() => router.refresh())

  const actions: { key: string; href: string; labelKey: MessageKey; show: boolean }[] = [
    { key: 'txn', href: '/gold-transactions', labelKey: 'home.do.newTxn', show: links.newTxn },
    { key: 'price', href: '/prices', labelKey: 'home.do.prices', show: links.prices },
    { key: 'bank', href: '/cash', labelKey: 'home.do.bankImport', show: links.bankImport },
    { key: 'rep', href: '/reports', labelKey: 'home.do.reports', show: links.reports },
  ]

  return (
    <Page titleKey="home.title">
      <div className={styles.bar}>
        <span className={styles.meta}>{t('common.asOf')} {asOf}</span>
        {/* The day the valuation is priced at, which is not the same fact as
            the day the page was loaded. Saying which is which is the
            difference between a stale figure somebody can allow for and one
            they cannot. */}
        {priceDate && priceDate !== asOf && (
          <span className={styles.meta}>{t('home.priceDate')}: {priceDate}</span>
        )}
        <button type="button" className={styles.retry} disabled={pending} onClick={retry}>
          {pending ? t('common.reloading') : t('common.refresh')}
        </button>
      </div>

      <Stats>
        <StatState labelKey="home.goldValue" data={inventoryValue}
                   format={(v) => `${money.format(v)} USD`}
                   note={inventoryGram.state === 'ready'
                     ? `${weight.format(inventoryGram.value)} g` : undefined}
                   href={links.inventory ? `/inventory?asOf=${asOf}` : undefined}
                   onRetry={retry} />
        <StatState labelKey="home.cash" data={cashTotal}
                   format={(v) => `${money.format(v)} USD`}
                   note={t('home.cashNote')}
                   tone={(v) => (v < 0 ? 'out' : undefined)}
                   href={links.cash ? `/cash?period=${period}` : undefined}
                   onRetry={retry} />
        <StatState labelKey="home.openDeposits" data={openDeposits}
                   format={(v) => String(v)} note={t('home.depositsNote')}
                   href={links.deposits
                     ? `/reports?report=deposits&date=${asOf}` : undefined}
                   onRetry={retry} />
        <StatState labelKey="home.atRefinery" data={atRefineryGram}
                   format={(v) => `${weight.format(v)} g`} note={t('home.refineryNote')}
                   href={links.refining ? '/refining' : undefined}
                   onRetry={retry} />
      </Stats>

      {actions.some((a) => a.show) && (
        <div className={styles.quick}>
          {actions.filter((a) => a.show).map((a) => (
            <Link key={a.key} href={a.href} className={styles.quickAction}>
              {t(a.labelKey)}
            </Link>
          ))}
        </div>
      )}

      <div className={styles.columns}>
        {/* Attention comes first in the markup so a phone reads it before a
            list of ten rows it would otherwise have to scroll past. */}
        <Section titleKey="home.attention">
          {attention.length === 0 ? (
            <p className={ledger.note}>{t('home.attn.none')}</p>
          ) : (
            <ul className={styles.attention}>
              {attention.map((item) => (
                <li key={item.key} className={styles.attentionRow}>
                  <Link href={item.href} className={styles.attentionLink}>
                    {t(item.titleKey)}
                  </Link>
                  <span className={styles.attentionCount}>
                    {item.count.state === 'error'
                      ? <span className={styles.failedText}>{t('home.attn.failed')}</span>
                      : item.count.state === 'ready' ? item.count.value : '—'}
                  </span>
                  {item.scope && <span className={styles.meta}>{item.scope}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section titleKey="home.recent">
          {recent.state === 'error' ? (
            <div className={styles.failed}>
              <p className={styles.failedText}>{t('common.loadFailed')}</p>
              <button type="button" className={styles.retry} onClick={retry}>
                {t('common.retry')}
              </button>
            </div>
          ) : recent.state !== 'ready' || recent.value.length === 0 ? (
            <p className={ledger.note}>{t('home.recentNone')}</p>
          ) : (
            <Frame>
              <table className={ledger.table}>
                <thead>
                  <tr>
                    <th>{t('journal.date')}</th>
                    <th>{t('txn.col.type')}</th>
                    <th>{t('txn.col.partner')}</th>
                    <th>{t('txn.col.gold')}</th>
                    <th className={ledger.num}>{t('txn.col.qty')}</th>
                    <th className={ledger.num}>{t('txn.col.amount')}</th>
                    <th>{t('users.state')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.value.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {links.newTxn ? (
                          <Link href={`/gold-transactions?date=${r.txnDate}`}>{r.txnDate}</Link>
                        ) : r.txnDate}
                      </td>
                      <td>{r.txnType}</td>
                      <td>{r.partnerCode}</td>
                      <td>{r.goldTypeCode}</td>
                      <td className={ledger.num}>{weight.format(r.qty)} {r.uom}</td>
                      <td className={ledger.num}>{money.format(r.amount)}</td>
                      <td>
                        <span className={ledger.badge}>
                          {t(r.posted ? 'home.posted' : 'journal.unposted')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}
        </Section>
      </div>
    </Page>
  )
}
