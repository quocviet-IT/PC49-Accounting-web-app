'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { money, weight } from '@/components/ledger/Ledger'
import {
  linesFromPicked, pickPurchases, unpickPurchase,
} from '@/app/(app)/refining/actions'
import styles from './Refining.module.css'

export type AvailablePurchase = {
  id: string
  txnDate: string
  partnerCode: string | null
  scrapDetail: string | null
  goldPct: number | null
  gradeBand: string | null
  qtyGram: number
  amount: number
}

export type PickedBand = {
  gradeBand: string | null
  purchaseCount: number
  grossWeightGram: number
  pureWeightGram: number
  avgGoldPct: number | null
  totalCost: number
}

/** A four-figure line, as the spreadsheet's batch tab has it. */
function Band({ band, label }: { band: PickedBand; label: string }) {
  const { t } = useLocale()
  return (
    <tr>
      <td>{label}</td>
      <td className={styles.num}>{band.purchaseCount}</td>
      <td className={styles.num}>{weight.format(band.grossWeightGram)}</td>
      <td className={styles.num}>{weight.format(band.pureWeightGram)}</td>
      <td className={styles.num}>
        {band.avgGoldPct === null ? '—' : band.avgGoldPct.toFixed(4)}
      </td>
      <td className={styles.num}>{money.format(band.totalCost)}</td>
      <td>{band.gradeBand === null ? t('refining.noBand') : ''}</td>
    </tr>
  )
}

/**
 * Assembling a lot out of the purchases going into it.
 *
 * This is the half of the process the system did not have. In the source
 * workbook the accountant does not retype what is in the bag: sheet
 * `1.Scrap Gold` lists the scrap bought over the counter and column P is a
 * checkbox, and ticking the rows that are physically going to the refinery is
 * what produces the batch. The totals underneath are the same four the
 * spreadsheet's batch tab computes, in the same two grade bands the scrap is
 * sent in.
 *
 * The running total is of what is *already picked*, read back from the
 * database, rather than of the boxes currently ticked on screen. A figure that
 * moves as you tick is pleasant and is not the one that will be sent; this is
 * the number the lot actually holds.
 */
export function PurchasePicker({
  lotId, available, picked, pickedTotals,
}: {
  lotId: string
  available: AvailablePurchase[]
  picked: AvailablePurchase[]
  pickedTotals: PickedBand[]
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const bandLabel = (b: string | null) => b ?? t('refining.noBand')

  const totals = useMemo(() => {
    const rows = [...pickedTotals].sort((a, b) =>
      String(a.gradeBand ?? '￿').localeCompare(String(b.gradeBand ?? '￿')))
    return rows
  }, [pickedTotals])

  function toggle(id: string) {
    setChosen((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function commit() {
    if (chosen.size === 0) return
    setError(null)
    startTransition(async () => {
      const result = await pickPurchases({ lotId, txnIds: [...chosen] })
      if (!result.ok) { setError(result.message); return }
      setChosen(new Set())
      router.refresh()
    })
  }

  /**
   * Turns the bands into the lines that get sent.
   *
   * The last step of the spreadsheet's batch tab: the totals stop being a
   * calculation and become the rows that leave the vault, one per band, which
   * is exactly how the journal records a send.
   */
  function toLines() {
    setError(null)
    startTransition(async () => {
      const result = await linesFromPicked({ lotId })
      if (!result.ok) { setError(result.message); return }
      router.refresh()
    })
  }

  function drop(txnId: string) {
    setError(null)
    startTransition(async () => {
      const result = await unpickPurchase({ lotId, txnId })
      if (!result.ok) { setError(result.message); return }
      router.refresh()
    })
  }

  return (
    <div className={styles.picker}>
      {picked.length > 0 && (
        <>
          <h3 className={styles.pickerTitle}>{t('refining.inThisLot')}</h3>
          <table className={styles.pickTable}>
            <thead>
              <tr>
                <th>{t('refining.band')}</th>
                <th className={styles.num}>{t('refining.pickCount')}</th>
                <th className={styles.num}>{t('refining.grossGram')}</th>
                <th className={styles.num}>{t('refining.pureGram')}</th>
                <th className={styles.num}>{t('refining.avgPct')}</th>
                <th className={styles.num}>{t('refining.cost')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {totals.map((b) => (
                <Band key={String(b.gradeBand)} band={b} label={bandLabel(b.gradeBand)} />
              ))}
            </tbody>
          </table>

          <table className={styles.pickTable}>
            <tbody>
              {picked.map((p) => (
                <tr key={p.id}>
                  <td>{p.txnDate}</td>
                  <td>{p.partnerCode}</td>
                  <td>{p.scrapDetail}</td>
                  <td className={styles.num}>{p.goldPct === null ? '—' : p.goldPct.toFixed(4)}</td>
                  <td className={styles.num}>{weight.format(p.qtyGram)}</td>
                  <td>
                    <button type="button" className={styles.quiet} disabled={pending}
                            onClick={() => drop(p.id)}>
                      {t('refining.unpick')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.actions}>
            <button type="button" className={styles.quiet} disabled={pending} onClick={toLines}>
              {t('refining.makeLines')}
            </button>
          </div>
        </>
      )}

      <h3 className={styles.pickerTitle}>{t('refining.available')}</h3>
      {available.length === 0 ? (
        <p className={styles.none}>{t('refining.nothingToPick')}</p>
      ) : (
        <>
          <table className={styles.pickTable}>
            <thead>
              <tr>
                <th />
                <th>{t('refining.boughtOn')}</th>
                <th>{t('refining.from')}</th>
                <th>{t('refining.detail')}</th>
                <th className={styles.num}>{t('refining.pct')}</th>
                <th>{t('refining.band')}</th>
                <th className={styles.num}>{t('refining.grossGram')}</th>
                <th className={styles.num}>{t('refining.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {available.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${t('refining.pick')} ${p.txnDate} ${p.partnerCode ?? ''}`}
                      checked={chosen.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                  <td>{p.txnDate}</td>
                  <td>{p.partnerCode}</td>
                  <td>{p.scrapDetail}</td>
                  <td className={styles.num}>
                    {p.goldPct === null ? '—' : p.goldPct.toFixed(4)}
                  </td>
                  <td>{bandLabel(p.gradeBand)}</td>
                  <td className={styles.num}>{weight.format(p.qtyGram)}</td>
                  <td className={styles.num}>{money.format(-p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.actions}>
            <button type="button" className={styles.quiet} disabled={pending || chosen.size === 0}
                    onClick={commit}>
              {t('refining.pickInto')} ({chosen.size})
            </button>
            {error && <span className={styles.failed}>{error}</span>}
          </div>
        </>
      )}
    </div>
  )
}
