'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/provider'
import type { MessageKey } from '@/lib/i18n'
import { Page, Section, Empty, money, weight, ledger, Frame } from '@/components/ledger/Ledger'
import { commitBatch, withdrawBatch } from '@/app/(app)/import/actions'
import { StageFile } from './StageFile'
import styles from './ImportView.module.css'

export type Batch = {
  id: string
  source: string
  fileName: string | null
  rowCount: number
  validCount: number
  rejectedCount: number
  committedCount: number
  committedAt: string | null
}

export type RejectedRow = {
  rowNo: number
  /** The English text the database wrote, kept for the audit trail. */
  reason: string
  reasonCode: string | null
  reasonValue: string | null
  payload: Record<string, unknown>
}

export type ReconLine = {
  metric: string
  metricKey: string
  expected: number
  actual: number
  difference: number
  agrees: boolean
}

/**
 * The database judges a row and says why in a code; the sentence is built here,
 * in the language of whoever has to go back to the spreadsheet and fix it. A
 * code nobody has written a sentence for yet falls back to the English the
 * database wrote, which is worse to read but never blank.
 */
function why(t: (k: MessageKey) => string, row: RejectedRow): string {
  if (!row.reasonCode) return row.reason
  const key = `imp.why.${row.reasonCode}` as MessageKey
  const sentence = t(key)
  if (sentence === key) return row.reason
  return sentence.replace('{0}', row.reasonValue ?? '')
}

/** A weight reads in grams, everything else in money. */
function figure(metric: string, value: number): string {
  return metric === 'INVENTORY_GRAM' ? weight.format(value) : money.format(value)
}

export function ImportView({
  asOf, batches, selected, rejected, recon,
}: {
  asOf: string
  batches: Batch[]
  selected: Batch | null
  rejected: RejectedRow[]
  recon: ReconLine[]
}) {
  const { t } = useLocale()
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      setFailed(!result.ok)
      setMessage(result.message)
    })
  }

  const disagreeing = recon.filter((r) => !r.agrees).length

  return (
    <Page titleKey="imp.title" noteKey="imp.note">
      <StageFile />
      <Section titleKey="imp.batches">
        {batches.length === 0 ? <Empty /> : (
          <Frame>
<table className={ledger.table}>
              <colgroup>
                <col style={{ width: '18%' }} /><col style={{ width: '30%' }} />
                <col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} /><col style={{ width: '19%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('imp.source')}</th>
                  <th>{t('imp.file')}</th>
                  <th className={ledger.num}>{t('imp.rows')}</th>
                  <th className={ledger.num}>{t('imp.valid')}</th>
                  <th className={ledger.num}>{t('imp.rejected')}</th>
                  <th>{t('imp.status')}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr
                    key={b.id}
                    className={b.id === selected?.id ? styles.picked : undefined}
                  >
                    <td>
                      <Link className={styles.pick} href={`/import?asOf=${asOf}&batch=${b.id}`}>
                        {b.source}
                      </Link>
                    </td>
                    <td className={styles.clip}>{b.fileName ?? '—'}</td>
                    <td className={ledger.num}>{b.rowCount}</td>
                    <td className={ledger.num}>{b.validCount + b.committedCount}</td>
                    <td className={`${ledger.num} ${b.rejectedCount > 0 ? ledger.out : ledger.muted}`}>
                      {b.rejectedCount}
                    </td>
                    <td>
                      <span className={ledger.badge}>
                        {b.committedAt
                          ? t(b.rejectedCount > 0 ? 'imp.partial' : 'imp.done')
                          : t('imp.pending')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Frame>
        )}
      </Section>

      {selected && (
        <Section titleKey="imp.rejectedRows">
          {rejected.length === 0 ? (
            <p className={ledger.note}>{t('imp.noRejected')}</p>
          ) : (
            <Frame>
<table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '10%' }} /><col style={{ width: '42%' }} />
                  <col style={{ width: '48%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className={ledger.num}>{t('imp.row')}</th>
                    <th>{t('imp.reason')}</th>
                    <th>{t('imp.file')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rejected.map((r) => (
                    <tr key={r.rowNo}>
                      <td className={ledger.num}>{r.rowNo}</td>
                      <td className={ledger.out}>{why(t, r)}</td>
                      <td className={`${ledger.muted} ${styles.clip}`}>
                        {Object.entries(r.payload)
                          .filter(([, v]) => v !== null && v !== '')
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join('  ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}

          <div className={styles.actions}>
            {!selected.committedAt && (
              <>
                <button
                  type="button"
                  className={styles.button}
                  disabled={pending || selected.validCount === 0}
                  onClick={() => run(() => commitBatch({ batchId: selected.id }))}
                >
                  {t('imp.commit')}
                </button>
                {selected.rejectedCount > 0 && (
                  <button
                    type="button"
                    className={styles.quiet}
                    disabled={pending}
                    onClick={() =>
                      run(() => commitBatch({ batchId: selected.id, allowPartial: true }))}
                  >
                    {t('imp.commitPartial')}
                  </button>
                )}
              </>
            )}
            {selected.committedAt && (
              <button
                type="button"
                className={styles.quiet}
                disabled={pending}
                onClick={() => run(() => withdrawBatch({ batchId: selected.id }))}
              >
                {t('imp.withdraw')}
              </button>
            )}
            {message && (
              <span className={failed ? styles.failed : styles.said}>{message}</span>
            )}
          </div>
        </Section>
      )}

      <Section titleKey="imp.recon">
        <form className={styles.asOf} method="get" action="/import">
          <label htmlFor="asOf">{t('imp.asOf')}</label>
          <input id="asOf" name="asOf" type="date" defaultValue={asOf} />
          {selected && <input type="hidden" name="batch" value={selected.id} />}
          <button type="submit" className={styles.quiet}>{t('imp.apply')}</button>
        </form>

        {recon.length === 0 ? (
          <p className={ledger.note}>{t('imp.noExpected')}</p>
        ) : (
          <>
            <Frame>
<table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '26%' }} /><col style={{ width: '16%' }} />
                  <col style={{ width: '19%' }} /><col style={{ width: '19%' }} />
                  <col style={{ width: '20%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('imp.metric')}</th>
                    <th>{t('imp.key')}</th>
                    <th className={ledger.num}>{t('imp.expected')}</th>
                    <th className={ledger.num}>{t('imp.actual')}</th>
                    <th className={ledger.num}>{t('imp.difference')}</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.map((r) => (
                    <tr
                      key={`${r.metric}:${r.metricKey}`}
                      className={r.agrees ? undefined : styles.differs}
                    >
                      <td>{t(`imp.metric.${r.metric}` as MessageKey)}</td>
                      <td>{r.metricKey}</td>
                      <td className={ledger.num}>{figure(r.metric, r.expected)}</td>
                      <td className={ledger.num}>{figure(r.metric, r.actual)}</td>
                      {/* The whole load is read from this column, so it is the one
                          thing on the screen allowed to shout. */}
                      <td className={`${ledger.num} ${r.agrees ? ledger.muted : ledger.out}`}>
                        {r.agrees ? '—' : figure(r.metric, r.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
            {disagreeing === 0 && (
              <p className={styles.settled}>{t('imp.allAgree')}</p>
            )}
          </>
        )}
      </Section>
    </Page>
  )
}
