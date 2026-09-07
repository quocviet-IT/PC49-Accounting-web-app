'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Stats, Stat, money, weight } from '@/components/ledger/Ledger'
import type { DataState } from '@/lib/data/result'
import styles from './Overview.module.css'

/**
 * One figure, or an honest account of why there isn't one.
 *
 * A zero here means zero. Before this, a balance that could not be read was
 * drawn as `0.00` beside three figures that were real, and nothing on the
 * screen distinguished them — which is the worst way for a set of books to be
 * wrong, because it looks exactly like being right.
 */
function StatState({
  labelKey, data, format, tone, onRetry,
}: {
  labelKey: Parameters<typeof Stat>[0]['labelKey']
  data: DataState<number>
  format: (v: number) => string
  tone?: (v: number) => 'in' | 'out' | undefined
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

  return (
    <Stat
      labelKey={labelKey}
      value={format(data.value)}
      tone={tone?.(data.value)}
    />
  )
}

export function Overview({
  inventoryValue, cashTotal, openDeposits, atRefineryGram, priceDate,
}: {
  inventoryValue: DataState<number>
  cashTotal: DataState<number>
  openDeposits: DataState<number>
  atRefineryGram: DataState<number>
  priceDate: string | null
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Refreshing the route re-runs the loader with the same day and the same
  // filters, which is what "try again" has to mean: retrying must not quietly
  // move you to a different set of figures.
  const retry = () => startTransition(() => router.refresh())

  return (
    <Page titleKey="home.title">
      <Stats>
        <StatState labelKey="home.goldValue" data={inventoryValue}
                   format={(v) => money.format(v)} onRetry={retry} />
        <StatState labelKey="home.cash" data={cashTotal}
                   format={(v) => money.format(v)}
                   tone={(v) => (v < 0 ? 'out' : undefined)} onRetry={retry} />
        <StatState labelKey="home.openDeposits" data={openDeposits}
                   format={(v) => String(v)} onRetry={retry} />
        <StatState labelKey="home.atRefinery" data={atRefineryGram}
                   format={(v) => `${weight.format(v)} g`} onRetry={retry} />
      </Stats>

      {/* The day the valuation is priced at, which is not the same fact as the
          day the page was loaded. Saying which is which is the difference
          between a stale figure somebody can allow for and one they cannot. */}
      {priceDate && (
        <p className={styles.meta}>{t('home.priceDate')}: {priceDate}</p>
      )}
      {pending && <p className={styles.meta}>{t('common.reloading')}</p>}
    </Page>
  )
}
