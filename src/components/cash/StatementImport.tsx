'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { importBankStatement, type ImportResult } from '@/app/(app)/cash/actions'
import styles from './StatementImport.module.css'

/**
 * Loading the month's bank statement.
 *
 * The file is read in the browser and its text sent on, rather than uploaded:
 * a statement is a few hundred kilobytes of text and this keeps the whole path
 * as one server action with nothing to configure.
 *
 * What comes back is stated in three numbers rather than one, because "412
 * imported" hides the two the accountant has to do something about.
 */
export function StatementImport() {
  const { t } = useLocale()
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [pending, startTransition] = useTransition()

  function choose(file: File | undefined) {
    if (!file) return
    setResult(null)
    startTransition(async () => {
      const csv = await file.text()
      const outcome = await importBankStatement({
        fileName: file.name,
        csv,
      })
      setResult(outcome)
      // The unmatched queue below is server-rendered, so it only moves on a
      // refresh.
      if (outcome.ok) router.refresh()
      // Clearing it means the same file can be chosen again after a correction.
      if (input.current) input.current.value = ''
    })
  }

  return (
    <div className={styles.bar}>
      <label className={styles.button}>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className={styles.file}
          disabled={pending}
          onChange={(e) => choose(e.target.files?.[0])}
        />
        {pending ? t('cash.importing') : t('cash.import')}
      </label>

      <span className={styles.hint}>{t('cash.importHint')}</span>

      {result && !result.ok && <span className={styles.failed}>{result.message}</span>}

      {result?.ok && (
        <span className={styles.outcome}>
          <span className={styles.good}>
            {result.matched} {t('cash.importMatched')}
          </span>
          {result.unmatched > 0 && (
            <span className={styles.warn}>
              {result.unmatched} {t('cash.importUnmatched')}
            </span>
          )}
          {result.unreadable > 0 && (
            <span className={styles.failed}>
              {result.unreadable} {t('cash.importUnreadable')}
            </span>
          )}
        </span>
      )}
    </div>
  )
}
