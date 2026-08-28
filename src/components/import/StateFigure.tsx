'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { setExpectedFigure } from '@/app/(app)/import/actions'
import styles from './ImportView.module.css'

const METRICS = ['INVENTORY_GRAM', 'CASH_BALANCE', 'LEDGER_DEBIT', 'LEDGER_CREDIT'] as const

/**
 * Saying what the spreadsheet closed at.
 *
 * This is the half of the reconciliation nothing can work out for itself, and
 * it is stated before the detail is loaded — that ordering is the whole point.
 * A figure worked out after the fact from the data it is meant to check proves
 * nothing.
 */
export function StateFigure({ asOf }: { asOf: string }) {
  const { t } = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [metric, setMetric] = useState<(typeof METRICS)[number]>('INVENTORY_GRAM')
  const [key, setKey] = useState('')
  const [expected, setExpected] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await setExpectedFigure({
        asOf, metric, metricKey: key.trim(), expected: Number(expected),
        sourceNote: note || null,
      })
      if (!result.ok) { setError(result.message); return }
      setKey(''); setExpected(''); setNote('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" className={styles.quiet} onClick={() => setOpen(true)}>
        {t('imp.stateFigure')}
      </button>
    )
  }

  return (
    <span className={styles.stage}>
      <select className={styles.select} aria-label={t('imp.metric')} value={metric}
              onChange={(e) => setMetric(e.target.value as (typeof METRICS)[number])}>
        {METRICS.map((m) => (
          <option key={m} value={m}>{t(`imp.metric.${m}` as const)}</option>
        ))}
      </select>
      {/* A gold type for a stock figure, an account code for a balance, and
          ALL for a ledger total: the same box because it is the same idea —
          which one of these does this figure belong to. */}
      <input className={styles.select} aria-label={t('imp.key')}
             placeholder={metric === 'INVENTORY_GRAM' ? 'GRAIN'
               : metric === 'CASH_BALANCE' ? '1111' : 'ALL'}
             value={key} onChange={(e) => setKey(e.target.value)} />
      <input className={styles.select} inputMode="decimal" aria-label={t('imp.expected')}
             placeholder={t('imp.expected')} value={expected}
             onChange={(e) => setExpected(e.target.value)} />
      <input className={styles.select} aria-label={t('imp.whichSheet')}
             placeholder={t('imp.whichSheet')} value={note}
             onChange={(e) => setNote(e.target.value)} />
      <button type="button" className={styles.button} disabled={pending} onClick={submit}>
        {t('imp.saveFigure')}
      </button>
      <button type="button" className={styles.quiet} disabled={pending}
              onClick={() => { setOpen(false); setError(null) }}>
        {t('imp.close')}
      </button>
      {error && <span className={styles.failed}>{error}</span>}
    </span>
  )
}
