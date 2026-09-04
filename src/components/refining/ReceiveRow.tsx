'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { weight } from '@/components/ledger/Ledger'
import { recordReceipt } from '@/app/(app)/refining/actions'
import styles from './Refining.module.css'

type SettleKind = 'METAL' | 'CASH'

/**
 * Settling with one owner of one lot.
 *
 * Two shapes, because the source sheet has two: column S of `3.3 MH SCRAP
 * GOLD` is headed `Lấy tiền / Lấy vàng`, and a pooling partner chooses. Metal
 * is the common one and stays the default; the quantity is offered pre-filled
 * with what is still owed, because that is the figure in nine deliveries out
 * of ten and retyping it is how a digit gets dropped. It stays editable: metal
 * comes back in instalments.
 *
 * Only one figure is ever on screen. Showing a weight box and an amount box
 * together invites both being filled, and a settlement that is half metal and
 * half money is not a thing the books can hold.
 */
export function ReceiveRow({
  lotId, ownerCode, owed,
}: { lotId: string; ownerCode: string; owed: number }) {
  const { t } = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<SettleKind>('METAL')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [qty, setQty] = useState(() => (owed > 0 ? String(owed) : ''))
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await recordReceipt({
        lotId,
        ownerCode,
        date,
        settleKind: kind,
        qtyGram: kind === 'METAL' ? Number(qty) : null,
        amountUsd: kind === 'CASH' ? Number(amount) : null,
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
      <select
        aria-label={t('refining.settleKind')}
        className={styles.field}
        value={kind}
        onChange={(e) => setKind(e.target.value as SettleKind)}
      >
        <option value="METAL">{t('refining.takeMetal')}</option>
        <option value="CASH">{t('refining.takeCash')}</option>
      </select>
      {kind === 'METAL' ? (
        <input
          inputMode="decimal"
          aria-label={`${t('refining.receive')} ${ownerCode}`}
          className={`${styles.field} ${styles.qty}`}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder={owed > 0 ? weight.format(owed) : ''}
        />
      ) : (
        <input
          inputMode="decimal"
          aria-label={`${t('refining.takeCash')} ${ownerCode}`}
          className={`${styles.field} ${styles.qty}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
      )}
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
