'use client'

import type { ReactNode } from 'react'
import { useLocale } from '@/lib/i18n/provider'
import type { MessageKey } from '@/lib/i18n'
import styles from './Ledger.module.css'

export const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
export const weight = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

export function Page({
  titleKey, noteKey, children,
}: { titleKey: MessageKey; noteKey?: MessageKey; children: ReactNode }) {
  const { t } = useLocale()
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t(titleKey)}</h1>
        {noteKey && <p className={styles.note}>{t(noteKey)}</p>}
      </div>
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

export function Empty() {
  const { t } = useLocale()
  return <p className={styles.empty}>{t('common.empty')}</p>
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
