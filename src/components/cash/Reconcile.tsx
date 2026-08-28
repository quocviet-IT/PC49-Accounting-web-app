'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { money, ledger } from '@/components/ledger/Ledger'
import { reconcileAccount } from '@/app/(app)/cash/actions'
import styles from './StatementImport.module.css'

const STATUSES = ['MATCHED', 'DIFF_EXPLAINED', 'NOT_FOUND', 'PENDING'] as const

/**
 * Reconciling one account against the other book.
 *
 * Only the figure from the other side is typed. Ours is read from the ledger
 * when the reconciliation is recorded, and the difference is worked out by the
 * database from the two — a reconciliation where somebody types both sides
 * proves only that they can type, which is the weakness the source sheet has.
 */
export function Reconcile({
  accountCode, accountName, ourClosing, recDate,
}: { accountCode: string; accountName: string; ourClosing: number; recDate: string }) {
  const { t } = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [theirs, setTheirs] = useState('')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('MATCHED')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Shown before saving, so the decision about status is made with the gap in
  // view rather than after it.
  const gap = theirs === '' ? null
    : Math.round((ourClosing - Number(theirs)) * 100) / 100

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await reconcileAccount({
        recDate, cashAccountCode: accountCode,
        usClosing: Number(theirs), status, reason: reason || null,
      })
      if (!result.ok) { setError(result.message); return }
      setOpen(false); setTheirs(''); setReason('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" className={styles.button} onClick={() => setOpen(true)}>
        {t('cash.reconcile')}
      </button>
    )
  }

  return (
    <span className={styles.bar}>
      <span className={ledger.muted}>{accountName}</span>
      <input
        className={styles.field}
        inputMode="decimal"
        aria-label={`${t('cash.theirClosing')} ${accountCode}`}
        placeholder={t('cash.theirClosing')}
        value={theirs}
        onChange={(e) => setTheirs(e.target.value)}
      />
      {gap !== null && (
        <span className={gap === 0 ? styles.good : styles.warn}>
          {t('cash.difference')}: {money.format(gap)}
        </span>
      )}
      <select
        className={styles.field}
        aria-label={t('cash.recStatus')}
        value={status}
        onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{t(`cash.rec.${s}` as const)}</option>
        ))}
      </select>
      {/* Calling a difference explained without an explanation is refused by the
          database. Offering the box only when it is needed says so first. */}
      {status === 'DIFF_EXPLAINED' && (
        <input
          className={styles.field}
          aria-label={t('cash.recReason')}
          placeholder={t('cash.recReason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <button type="button" className={styles.button} disabled={pending} onClick={submit}>
        {t('refining.save')}
      </button>
      <button type="button" className={styles.button} disabled={pending}
              onClick={() => { setOpen(false); setError(null) }}>
        {t('refining.cancel')}
      </button>
      {error && <span className={styles.failed}>{error}</span>}
    </span>
  )
}
