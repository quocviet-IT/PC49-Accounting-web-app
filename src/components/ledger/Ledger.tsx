'use client'

import { useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import type { MessageKey } from '@/lib/i18n'
import { PageHeader } from '@/components/PageHeader'
import styles from './Ledger.module.css'

export const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
export const weight = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

export function Page({
  titleKey, noteKey, actions, children,
}: {
  titleKey: MessageKey
  noteKey?: MessageKey
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      <PageHeader titleKey={titleKey} descriptionKey={noteKey} actions={actions} />
      {children}
    </div>
  )
}

export function Section({
  titleKey, children,
}: { titleKey?: MessageKey; children: ReactNode }) {
  const { t } = useLocale()
  return (
    <section className={styles.section}>
      {titleKey && <h2 className={styles.sectionTitle}>{t(titleKey)}</h2>}
      {children}
    </section>
  )
}

/**
 * The card a table sits on.
 *
 * Wide content scrolls inside this rather than the page body, which is the
 * difference between a table you can read on a laptop and one that pushes the
 * whole layout sideways.
 */
export function Frame({ children }: { children: ReactNode }) {
  return <div className={styles.frame}>{children}</div>
}

export function Stat({
  labelKey, value, note, tone,
}: { labelKey: MessageKey; value: string; note?: string; tone?: 'in' | 'out' }) {
  const { t } = useLocale()
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{t(labelKey)}</span>
      <span className={`${styles.statValue} ${tone ? styles[tone] : ''}`}>{value}</span>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  )
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className={styles.stats}>{children}</div>
}

/**
 * What a screen shows instead of figures it could not read.
 *
 * Supabase does not reject a failed query — it hands back an object carrying
 * an error — so a loader that reads `data ?? []` turns a failure into an empty
 * table, and an empty table of holdings reads as "we hold nothing". This is
 * the alternative: say the read failed, and offer the one action that helps.
 *
 * Retrying refreshes the route, so it comes back with the same day and the
 * same filters. A retry that quietly moved somebody to different figures would
 * be worse than none.
 */
export function LoadFailed() {
  const { t } = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <div className={styles.loadFailed} role="alert">
      <p className={styles.loadFailedText}>{t('common.loadFailed')}</p>
      <button
        type="button"
        className={styles.loadFailedRetry}
        disabled={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {pending ? t('common.reloading') : t('common.retry')}
      </button>
    </div>
  )
}

export function Empty() {
  const { t } = useLocale()
  return <p className={styles.empty}>{t('common.empty')}</p>
}

/**
 * What one section of a page has to show: the read failed, there is genuinely
 * nothing, or here it is.
 *
 * These are three different facts and they must not share a rendering. "No
 * transactions this month" is a claim about the business; a read that never
 * arrived cannot support it, and an empty table underneath a closing balance
 * says two contradictory things on the same screen.
 */
export function Body({ failed, empty, children }: {
  failed?: boolean
  empty: boolean
  children: ReactNode
}) {
  if (failed) return <LoadFailed />
  if (empty) return <Empty />
  return <>{children}</>
}

/**
 * Negative zero prints as -0.00, which on an accounting screen reads like a
 * rounding artefact hiding something. Nothing is ever minus nothing.
 */
function normalise(value: number): number {
  return value === 0 ? 0 : value
}

/** Signed money: the reader should never have to work out the direction twice. */
export function Signed({ value, invert = false }: { value: number; invert?: boolean }) {
  const v = normalise(value)
  const positive = invert ? v < 0 : v > 0
  const cls = v === 0 ? '' : positive ? styles.in : styles.out
  return <span className={cls}>{money.format(v)}</span>
}

export function Grams({ value }: { value: number }) {
  const v = normalise(value)
  const cls = v === 0 ? styles.muted : v > 0 ? styles.in : styles.out
  return <span className={cls}>{weight.format(v)}</span>
}

export { styles as ledger }
