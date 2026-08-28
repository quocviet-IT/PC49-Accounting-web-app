'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { weight } from '@/components/ledger/Ledger'
import { recordReceipt } from '@/app/(app)/refining/actions'
import styles from './Refining.module.css'

/**
 * Recording what came back, for one owner of one lot.
 *
 * The quantity is offered pre-filled with what is still owed, because that is
 * the figure in nine deliveries out of ten and retyping it is how a digit gets
 * dropped. It stays editable: metal comes back in instalments.
 */
export function ReceiveRow({
  lotId, ownerCode, owed,
}: { lotId: string; ownerCode: string; owed: number }) {
  const { t } = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [qty, setQty] = useState(() => (owed > 0 ? String(owed) : ''))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await recordReceipt({
        lotId, ownerCode, date, qtyGram: Number(qty),
      })
      if (!result.ok) { setError(result.message); return }
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button type="button" className={styles.quiet} onClick={() => setOpen(true)}>
        {t('refining.receive')}
      </button>
    )
  }

  return (
    <span className={styles.receive}>
      <input
        type="date"
        aria-label={t('refining.receivedOn')}
        className={styles.field}
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <input
        inputMode="decimal"
        aria-label={`${t('refining.receive')} ${ownerCode}`}
        className={`${styles.field} ${styles.qty}`}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder={owed > 0 ? weight.format(owed) : ''}
      />
      <button type="button" className={styles.quiet} disabled={pending} onClick={submit}>
        {t('refining.save')}
      </button>
      <button type="button" className={styles.quiet} disabled={pending}
              onClick={() => { setOpen(false); setError(null) }}>
        {t('refining.cancel')}
      </button>
      {error && <span className={styles.failed}>{error}</span>}
    </span>
  )
}
