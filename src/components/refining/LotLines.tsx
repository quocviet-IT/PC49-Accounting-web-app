'use client'

import { useLocale } from '@/lib/i18n/provider'
import { money, weight } from '@/components/ledger/Ledger'
import styles from './Refining.module.css'

export type LotLineValue = {
  lotId: string
  seq: number
  ownerCode: string
  sourceDesc: string | null
  grossWeightGram: number | null
  goldPct: number | null
  pureWeightGram: number | null
  estimatedValue: number | null
  assayPct: number | null
  assayWeightGram: number | null
  assayPureWeightGram: number | null
  assayValue: number | null
  purityVariance: number | null
  weightVariance: number | null
  valueVariance: number | null
}

function Num({ value, digits = 2 }: { value: number | null; digits?: number }) {
  if (value === null || Number.isNaN(value)) return <>—</>
  return <>{value.toFixed(digits)}</>
}

/** Red when it went against us, green when it went our way, plain at zero. */
function Signed({ value, digits = 2 }: { value: number | null; digits?: number }) {
  if (value === null || Number.isNaN(value)) return <>—</>
  const cls = value === 0 ? '' : value > 0 ? styles.up : styles.down
  return <span className={cls}>{value > 0 ? '+' : ''}{value.toFixed(digits)}</span>
}

/**
 * A lot read the way sheet `3.3 MH SCRAP GOLD` reads it, left to right.
 *
 * What was sent and what it was estimated at, then what the refinery weighed
 * and assayed and what that settles at, then the three things the assay
 * changed. The last group is the reason the sheet has a variance block at all:
 * scrap judged over the counter and scrap measured by a refinery are rarely
 * the same number, and the difference is somebody's money.
 *
 * Nothing here is posted. Which moment the definitive valuation is taken at is
 * still an open question with the US team, so these are figures to read, not
 * journal entries — the same stance the lot summary already takes.
 */
export function LotLines({ lines }: { lines: LotLineValue[] }) {
  const { t } = useLocale()
  if (lines.length === 0) return null

  return (
    <>
      <h3 className={styles.pickerTitle}>{t('refining.lines')}</h3>
      <div className={styles.scrollX}>
        <table className={styles.pickTable}>
          <thead>
            <tr>
              <th>{t('refining.owner')}</th>
              <th>{t('refining.detail')}</th>
              <th className={styles.num}>{t('refining.sentGram')}</th>
              <th className={styles.num}>{t('refining.pct')}</th>
              <th className={styles.num}>{t('refining.pureGram')}</th>
              <th className={styles.num}>{t('refining.estimated')}</th>
              <th className={styles.num}>{t('refining.assayGram')}</th>
              <th className={styles.num}>{t('refining.assayPct')}</th>
              <th className={styles.num}>{t('refining.assayPure')}</th>
              <th className={styles.num}>{t('refining.settled')}</th>
              <th className={styles.num}>{t('refining.varPurity')}</th>
              <th className={styles.num}>{t('refining.varWeight')}</th>
              <th className={styles.num}>{t('refining.varValue')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={`${l.lotId}-${l.seq}`}>
                <td>{l.ownerCode}</td>
                <td>{l.sourceDesc}</td>
                <td className={styles.num}>
                  {l.grossWeightGram === null ? '—' : weight.format(l.grossWeightGram)}
                </td>
                <td className={styles.num}><Num value={l.goldPct} digits={4} /></td>
                <td className={styles.num}>
                  {l.pureWeightGram === null ? '—' : weight.format(l.pureWeightGram)}
                </td>
                <td className={styles.num}>
                  {l.estimatedValue === null ? '—' : money.format(l.estimatedValue)}
                </td>
                <td className={styles.num}>
                  {l.assayWeightGram === null ? '—' : weight.format(l.assayWeightGram)}
                </td>
                <td className={styles.num}><Num value={l.assayPct} digits={4} /></td>
                <td className={styles.num}>
                  {l.assayPureWeightGram === null ? '—' : weight.format(l.assayPureWeightGram)}
                </td>
                {/* The figure the lot is actually settled at. */}
                <td className={styles.num}>
                  {l.assayValue === null ? '—' : money.format(l.assayValue)}
                </td>
                <td className={styles.num}><Signed value={l.purityVariance} digits={4} /></td>
                <td className={styles.num}><Signed value={l.weightVariance} digits={4} /></td>
                <td className={styles.num}><Signed value={l.valueVariance} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.none}>{t('refining.linesNote')}</p>
    </>
  )
}
