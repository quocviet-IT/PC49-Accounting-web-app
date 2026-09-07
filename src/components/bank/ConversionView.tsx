'use client'

import { useMemo, useState, useTransition } from 'react'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Stat, money, ledger, Section, LoadFailed } from '@/components/ledger/Ledger'
import { saveAllocation, suggestAllocation } from '@/app/(app)/bank-conversion/actions'
import styles from './ConversionView.module.css'

export type BankTxn = {
  id: string
  txnDate: string
  amount: number
  description: string | null
  allocatedValue: number
  residualCash: number
  lines: number
}

export type GoldOption = { code: string; nameVi: string; nameEn: string; uom: string }

type Line = {
  key: number
  goldTypeCode: string
  uom: string
  qty: string
  unitPrice: string
  refPrice: number | null
  desc: string
  confirmed: boolean
}

function blank(key: number): Line {
  return { key, goldTypeCode: '', uom: '', qty: '', unitPrice: '', refPrice: null,
           desc: '', confirmed: false }
}

export function ConversionView({
  transactions, goldTypes, tolerance, loadFailed = false,
}: {
  transactions: BankTxn[]
  goldTypes: GoldOption[]
  tolerance: number
  /**
   * The bank lines, the gold catalogue, or the tolerance did not arrive.
   *
   * The tolerance matters as much as the rows: it is the figure that decides
   * whether a conversion is accepted, and falling back to a default when the
   * real one could not be read would apply a rule nobody set.
   */
  loadFailed?: boolean
}) {
  const { locale, t } = useLocale()
  const [selectedId, setSelectedId] = useState<string | null>(transactions[0]?.id ?? null)
  const [lines, setLines] = useState<Line[]>([blank(0)])
  const [nextKey, setNextKey] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const selected = transactions.find((x) => x.id === selectedId) ?? null
  const goldName = (g: GoldOption) => (locale === 'vi' ? g.nameVi : g.nameEn)
  const uomOf = (code: string) => goldTypes.find((g) => g.code === code)?.uom ?? ''

  function pick(id: string) {
    setSelectedId(id)
    setLines([blank(nextKey)])
    setNextKey((k) => k + 1)
    setError(null)
  }

  function patch(key: number, change: Partial<Line>) {
    setLines((rows) => rows.map((r) => {
      if (r.key !== key) return r
      const next = { ...r, ...change }
      if (change.goldTypeCode !== undefined) {
        next.uom = uomOf(change.goldTypeCode)
        next.refPrice = null
        next.confirmed = false
      }
      return next
    }))
    setError(null)
  }

  function suggest(row: Line) {
    if (!selected || !row.goldTypeCode) return
    startTransition(async () => {
      const s = await suggestAllocation(selected.amount, row.goldTypeCode, selected.txnDate)
      if (!s) { setError(t('conv.noPrice')); return }
      patch(row.key, {
        qty: String(s.qty),
        unitPrice: s.unitPrice.toFixed(6),
        refPrice: s.refPrice,
      })
    })
  }

  const allocated = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0),
    [lines],
  )
  const residual = selected ? Math.round((selected.amount - allocated) * 100) / 100 : 0

  function outOfBand(row: Line): boolean {
    if (row.refPrice === null || !row.unitPrice) return false
    return Math.abs(Number(row.unitPrice) - row.refPrice) > tolerance
  }

  const blocked = lines.some((l) => outOfBand(l) && !l.confirmed)
  const complete = lines.some((l) => l.goldTypeCode && Number(l.qty) && Number(l.unitPrice))

  function save() {
    if (!selected) return
    startTransition(async () => {
      const result = await saveAllocation({
        cashTxnId: selected.id,
        lines: lines
          .filter((l) => l.goldTypeCode && Number(l.qty) && Number(l.unitPrice))
          .map((l) => ({
            goldTypeCode: l.goldTypeCode,
            uom: (l.uom || uomOf(l.goldTypeCode)) as 'GRAM' | 'OZ' | 'LUONG',
            qty: Number(l.qty),
            unitPrice: Number(l.unitPrice),
            refPrice: l.refPrice,
            productDesc: l.desc || null,
            confirmed: l.confirmed,
          })),
      })
      if (!result.ok) setError(result.message)
      else setError(null)
    })
  }

  if (loadFailed) {
    return (
      <Page titleKey="conv.title" noteKey="conv.note">
        <Section><LoadFailed /></Section>
      </Page>
    )
  }

  return (
    <Page titleKey="conv.title" noteKey="conv.note">
      <div className={styles.split}>
        <section>
          <h2 className={ledger.sectionTitle}>{t('conv.pending')}</h2>
          <div className={styles.list}>
            {transactions.map((x) => (
              <button key={x.id} type="button" className={styles.item}
                      aria-current={x.id === selectedId}
                      onClick={() => pick(x.id)}>
                <span className={styles.itemDate}>{x.txnDate}</span>
                <span className={styles.itemAmount}>{money.format(x.amount)}</span>
                <span className={styles.itemDesc}>{x.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className={styles.editor}>
          {!selected ? <p className={ledger.empty}>{t('conv.pick')}</p> : (
            <>
              <table className={styles.lineGrid}>
                <thead>
                  <tr>
                    <th>{t('inv.goldType')}</th>
                    <th className={styles.numField}>{t('txn.col.qty')}</th>
                    <th className={styles.numField}>{t('txn.col.price')}</th>
                    <th className={styles.numField}>{t('conv.refPrice')}</th>
                    <th className={styles.numField}>{t('conv.variance')}</th>
                    <th>{t('txn.col.remarks')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row) => {
                    const variance = row.refPrice === null || !row.unitPrice
                      ? null : Number(row.unitPrice) - row.refPrice
                    return (
                      <tr key={row.key}>
                        <td>
                          <select className={styles.field} value={row.goldTypeCode}
                                  aria-label={t('inv.goldType')}
                                  onChange={(e) => patch(row.key, { goldTypeCode: e.target.value })}>
                            <option value="" />
                            {goldTypes.map((g) => (
                              <option key={g.code} value={g.code}>{goldName(g)}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input className={`${styles.field} ${styles.numField}`} inputMode="decimal"
                                 aria-label={t('txn.col.qty')} value={row.qty}
                                 onChange={(e) => patch(row.key, { qty: e.target.value })} />
                        </td>
                        <td>
                          <input className={`${styles.field} ${styles.numField}`} inputMode="decimal"
                                 aria-label={t('txn.col.price')} value={row.unitPrice}
                                 onChange={(e) => patch(row.key, { unitPrice: e.target.value, confirmed: false })} />
                        </td>
                        <td className={`${styles.numField} ${ledger.muted}`}>
                          {row.refPrice === null ? '' : money.format(row.refPrice)}
                        </td>
                        <td className={styles.numField}>
                          {variance === null ? ''
                            : <span className={Math.abs(variance) > tolerance ? ledger.out : ledger.muted}>
                                {money.format(variance)}
                              </span>}
                        </td>
                        <td>
                          <input className={styles.field} aria-label={t('txn.col.remarks')}
                                 value={row.desc}
                                 onChange={(e) => patch(row.key, { desc: e.target.value })} />
                        </td>
                        <td>
                          <button type="button" className={styles.button}
                                  disabled={!row.goldTypeCode || pending}
                                  onClick={() => suggest(row)}>
                            {t('conv.suggest')}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {lines.filter(outOfBand).map((row) => (
                <div key={`warn-${row.key}`} className={styles.warn}>
                  <span className={styles.warnLabel}>{t('conv.outOfBand')}</span>
                  <label className={styles.warnLabel}>
                    <input type="checkbox" checked={row.confirmed}
                           onChange={(e) => patch(row.key, { confirmed: e.target.checked })} />
                    {t('conv.confirm')}
                  </label>
                </div>
              ))}

              <div className={styles.actions}>
                <button type="button" className={styles.button}
                        onClick={() => { setLines((r) => [...r, blank(nextKey)]); setNextKey((k) => k + 1) }}>
                  {t('conv.addLine')}
                </button>
                <button type="button" className={styles.button}
                        disabled={!complete || blocked || pending} onClick={save}>
                  {pending ? t('txn.saving') : t('conv.save')}
                </button>
                {error && <span className={styles.error} data-testid="conv-error">{error}</span>}
              </div>

              <div className={styles.summary}>
                <Stat labelKey="txn.col.amount" value={money.format(selected.amount)} />
                <Stat labelKey="conv.allocated" value={money.format(allocated)} />
                <Stat labelKey="conv.residual" value={money.format(residual)}
                      tone={residual === 0 ? undefined : 'out'} />
              </div>
            </>
          )}
        </section>
      </div>
    </Page>
  )
}
