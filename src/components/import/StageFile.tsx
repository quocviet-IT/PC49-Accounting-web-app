'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { stageFile, type StageResult } from '@/app/(app)/import/actions'
import styles from './ImportView.module.css'

/**
 * The front door of the loader.
 *
 * Choosing what the file holds is deliberate rather than sniffed from its
 * columns: a prices file and an opening-balances file can look alike, and a
 * wrong guess loads real figures into the wrong table. Somebody says what they
 * are loading, once.
 *
 * Nothing reaches the books here. The rows are staged and judged; committing is
 * a separate decision made after looking at what was turned back.
 */
const SOURCES = [
  'GOLD_TXN', 'JOURNAL', 'OPENING_INVENTORY', 'OPENING_CASH',
  'GOLD_PRICE', 'SPOT_PRICE', 'REFINING_LOT',
] as const

export function StageFile() {
  const { t } = useLocale()
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<(typeof SOURCES)[number]>('GOLD_TXN')
  const [result, setResult] = useState<StageResult | null>(null)
  const [pending, startTransition] = useTransition()

  function choose(file: File | undefined) {
    if (!file) return
    setResult(null)
    startTransition(async () => {
      const csv = await file.text()
      const outcome = await stageFile({ source, fileName: file.name, csv })
      setResult(outcome)
      if (outcome.ok) router.refresh()
      if (input.current) input.current.value = ''
    })
  }

  return (
    <div className={styles.stage}>
      <label htmlFor="stage-source">{t('imp.whatIsIt')}</label>
      <select
        id="stage-source"
        className={styles.select}
        value={source}
        disabled={pending}
        onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}
      >
        {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <label className={styles.button}>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className={styles.file}
          disabled={pending}
          onChange={(e) => choose(e.target.files?.[0])}
        />
        {pending ? t('imp.staging') : t('imp.stage')}
      </label>

      <span className="pc-muted">{t('imp.stageHint')}</span>

      {result && !result.ok && <span className={styles.failed}>{result.message}</span>}
      {result?.ok && (
        <span className={styles.said}>
          {result.total} {t('imp.rows')} · {result.valid} {t('imp.valid')}
          {result.rejected > 0 && ` · ${result.rejected} ${t('imp.rejected')}`}
        </span>
      )}
    </div>
  )
}
