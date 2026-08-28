'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { toGrams, type Uom } from '@/lib/domain/units'
import {
  saveTransaction, voidTransaction, type SaveResult,
} from '@/app/(app)/gold-transactions/actions'
import styles from './TxnGrid.module.css'

export type GoldTypeOption = {
  code: string
  name_vi: string
  name_en: string
  native_uom: Uom
}

export type SavedRow = {
  id: string
  txn_type: string
  partner_code: string | null
  sales_person_code: string | null
  gold_type_code: string
  scrap_detail: string | null
  uom: Uom
  qty: number
  unit_price: number | null
  amount: number
  remarks: string | null
}

type Draft = {
  key: number
  txnType: string
  salesPersonCode: string
  partnerCode: string
  goldTypeCode: string
  scrapDetail: string
  uom: Uom | ''
  qty: string
  unitPrice: string
  pay1: string
  method1: string
  pay2: string
  method2: string
  remarks: string
  error?: string
  savedId?: string
}

const TXN_TYPES = ['PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'PICKUP', 'MEMO', 'ON_THE_WAY'] as const
const METHODS = ['CASH', 'BANKWIRE', 'ZELLE', 'CHECK'] as const

function blankDraft(key: number): Draft {
  return {
    key, txnType: 'PO', salesPersonCode: '', partnerCode: '', goldTypeCode: '',
    scrapDetail: '', uom: '', qty: '', unitPrice: '', pay1: '', method1: 'CASH',
    pay2: '', method2: '', remarks: '',
  }
}

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const weight = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Amount follows the sign convention the whole system rests on: a purchase is a
 * positive quantity and a negative amount, a sale the other way round. The
 * accountant types the quantity with its sign, exactly as in the spreadsheet,
 * and never types the amount at all.
 */
function amountOf(qty: number, price: number): number {
  return Math.round(-qty * price * 100) / 100
}

export function TxnGrid({
  txnDate,
  goldTypes,
  salesPeople,
  existing,
}: {
  txnDate: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  existing: SavedRow[]
}) {
  const { locale, t } = useLocale()
  const router = useRouter()
  const [drafts, setDrafts] = useState<Draft[]>([blankDraft(0)])
  const [voiding, setVoiding] = useState<string | null>(null)
  const [voidError, setVoidError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [nextKey, setNextKey] = useState(1)
  // Enter commits the row, and so does leaving the last field. Without a guard
  // both fire and the transaction is written twice, which silently doubles the
  // day. Held in a ref because the guard has to be set before React re-renders.
  const inFlight = useRef<Set<number>>(new Set())

  const goldName = (g: GoldTypeOption) => (locale === 'vi' ? g.name_vi : g.name_en)
  const uomOf = (code: string) => goldTypes.find((g) => g.code === code)?.native_uom ?? ''

  function patch(key: number, change: Partial<Draft>) {
    setDrafts((rows) => rows.map((r) => {
      if (r.key !== key) return r
      const next = { ...r, ...change, error: undefined }
      if (change.goldTypeCode !== undefined) next.uom = uomOf(change.goldTypeCode)
      return next
    }))
  }

  function addRow() {
    setDrafts((rows) => [...rows, blankDraft(nextKey)])
    setNextKey((k) => k + 1)
  }

  function commit(row: Draft) {
    const qty = Number(row.qty)
    const price = Number(row.unitPrice)
    if (!row.goldTypeCode || !qty || !price) return
    if (row.savedId || inFlight.current.has(row.key)) return
    inFlight.current.add(row.key)

    const amount = amountOf(qty, price)
    const payments = [
      { amount: Number(row.pay1), method: row.method1 },
      { amount: Number(row.pay2), method: row.method2 },
    ].filter((p) => p.amount > 0 && p.method)

    startTransition(async () => {
      const result: SaveResult = await saveTransaction({
        txnDate,
        txnType: row.txnType,
        goldTypeCode: row.goldTypeCode,
        uom: row.uom || uomOf(row.goldTypeCode),
        qty,
        unitPrice: price,
        amount,
        partnerCode: row.partnerCode || null,
        salesPersonCode: row.salesPersonCode || null,
        scrapDetail: row.scrapDetail || null,
        remarks: row.remarks || null,
        payments,
      })

      if (result.ok) {
        setDrafts((rows) => {
          const cleared = rows.map((r) => (r.key === row.key ? { ...r, savedId: result.id } : r))
          return cleared.some((r) => !r.savedId) ? cleared : [...cleared, blankDraft(nextKey)]
        })
        setNextKey((k) => k + 1)
      } else {
        setDrafts((rows) => rows.map((r) => (r.key === row.key ? { ...r, error: result.message } : r)))
      }
      inFlight.current.delete(row.key)
    })
  }

  // Once a row is saved, revalidation brings it back from the server in
  // `existing` while the draft still carries its id. Counting both shows the day
  // at twice its real value, which makes the running total - the one thing on
  // this screen the accountant is meant to trust - lie.
  const settled = useMemo(() => new Set(existing.map((r) => r.id)), [existing])
  const liveDrafts = useMemo(
    () => drafts.filter((d) => !d.savedId || !settled.has(d.savedId)),
    [drafts, settled],
  )

  const totals = useMemo(() => {
    const rows = [
      ...existing.map((r) => ({ type: r.txn_type, amount: r.amount, gold: r.gold_type_code,
                                grams: toGrams(r.qty, r.uom) })),
      ...liveDrafts.filter((d) => d.savedId && d.goldTypeCode && d.qty && d.unitPrice)
        .map((d) => ({
          type: d.txnType,
          amount: amountOf(Number(d.qty), Number(d.unitPrice)),
          gold: d.goldTypeCode,
          grams: toGrams(Number(d.qty), (d.uom || uomOf(d.goldTypeCode)) as Uom),
        })),
    ]
    const purchases = rows.filter((r) => r.type === 'PO' || r.type === 'PO_VENDOR')
      .reduce((s, r) => s - r.amount, 0)
    const sales = rows.filter((r) => r.type === 'SALE' || r.type === 'PICKUP')
      .reduce((s, r) => s + r.amount, 0)
    const movement = new Map<string, number>()
    for (const r of rows) movement.set(r.gold, (movement.get(r.gold) ?? 0) + r.grams)
    return { purchases, sales, movement: [...movement].filter(([, g]) => g !== 0) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing, liveDrafts])

  const savedCount = existing.length + liveDrafts.filter((d) => d.savedId).length

  /**
   * Cancels a saved row.
   *
   * The reason is asked for because the database demands one, and because a
   * cancellation nobody explained is the row somebody re-types next month.
   */
  async function cancelRow(id: string) {
    const reason = window.prompt(t('txn.voidWhy'))
    if (reason === null) return
    setVoiding(id)
    setVoidError(null)
    const result = await voidTransaction({ id, reason })
    setVoiding(null)
    if (!result.ok) { setVoidError(result.message); return }
    router.refresh()
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('txn.title')} · {txnDate}</h1>
        <button type="button" onClick={addRow} className={styles.select}
                style={{ width: 'auto', border: '1px solid var(--rule-strong)' }}>
          {t('txn.addRow')}
        </button>
        <span className={styles.hint}>{t('txn.hint')}</span>
      </div>

      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th aria-label="status" />
              <th>{t('txn.col.type')}</th>
              <th>{t('txn.col.sales')}</th>
              <th>{t('txn.col.partner')}</th>
              <th>{t('txn.col.gold')}</th>
              <th>{t('txn.col.scrap')}</th>
              <th className={styles.num}>{t('txn.col.qty')}</th>
              <th className={styles.num}>{t('txn.col.price')}</th>
              <th className={styles.num}>{t('txn.col.amount')}</th>
              <th className={styles.num}>{t('txn.col.pay1')}</th>
              <th>{t('txn.col.method')}</th>
              <th>{t('txn.col.remarks')}</th>
            </tr>
          </thead>
          <tbody>
            {existing.map((r) => (
              <tr key={r.id}>
                <td className={styles.status}>✓</td>
                <td>{r.txn_type}</td>
                <td>{r.sales_person_code}</td>
                <td>{r.partner_code}</td>
                <td>{goldTypes.find((g) => g.code === r.gold_type_code)
                      ? goldName(goldTypes.find((g) => g.code === r.gold_type_code)!)
                      : r.gold_type_code}</td>
                <td>{r.scrap_detail}</td>
                <td className={styles.num}>
                  {weight.format(r.qty)}
                  <span className={`${styles.grams} ${r.qty > 0 ? styles.in : styles.out}`}>
                    {weight.format(toGrams(r.qty, r.uom))} g
                  </span>
                </td>
                <td className={styles.num}>{r.unit_price ? money.format(r.unit_price) : ''}</td>
                <td className={styles.num}>{money.format(r.amount)}</td>
                <td colSpan={2} />
                {/* A saved row is not editable — correcting it means cancelling
                    it and typing the right one, which is what the ledger can
                    actually represent. */}
                <td>
                  <button
                    type="button"
                    className={styles.voidButton}
                    disabled={voiding === r.id}
                    onClick={() => void cancelRow(r.id)}
                  >
                    {t('txn.void')}
                  </button>
                </td>
              </tr>
            ))}

            {liveDrafts.map((row) => {
              const qty = Number(row.qty)
              const price = Number(row.unitPrice)
              const uom = (row.uom || uomOf(row.goldTypeCode)) as Uom | ''
              const grams = qty && uom ? toGrams(qty, uom) : null
              const amount = qty && price ? amountOf(qty, price) : null
              return (
                <tr key={row.key} className={row.savedId ? styles.saved : undefined}>
                  <td className={styles.status}>{row.savedId ? '✓' : ''}</td>
                  <td>
                    <select className={`${styles.select} ${styles.typeSelect}`}
                            value={row.txnType} disabled={!!row.savedId}
                            aria-label={t('txn.col.type')}
                            onChange={(e) => patch(row.key, { txnType: e.target.value })}>
                      {TXN_TYPES.map((tt) => <option key={tt} value={tt}>{tt}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className={styles.cell} list="sales-people" value={row.salesPersonCode}
                           disabled={!!row.savedId} aria-label={t('txn.col.sales')}
                           onChange={(e) => patch(row.key, { salesPersonCode: e.target.value })} />
                  </td>
                  <td>
                    <input className={styles.cell} value={row.partnerCode} disabled={!!row.savedId}
                           aria-label={t('txn.col.partner')}
                           onChange={(e) => patch(row.key, { partnerCode: e.target.value })} />
                  </td>
                  <td>
                    <select className={styles.select} value={row.goldTypeCode} disabled={!!row.savedId}
                            aria-label={t('txn.col.gold')}
                            onChange={(e) => patch(row.key, { goldTypeCode: e.target.value })}>
                      <option value="" />
                      {goldTypes.map((g) => (
                        <option key={g.code} value={g.code}>{goldName(g)}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className={styles.cell} value={row.scrapDetail} disabled={!!row.savedId}
                           aria-label={t('txn.col.scrap')}
                           onChange={(e) => patch(row.key, { scrapDetail: e.target.value })} />
                  </td>
                  <td className={styles.num}>
                    <input className={`${styles.cell} ${styles.num}`} inputMode="decimal"
                           value={row.qty} disabled={!!row.savedId} aria-label={t('txn.col.qty')}
                           onChange={(e) => patch(row.key, { qty: e.target.value })} />
                    {grams !== null && (
                      <span className={`${styles.grams} ${grams > 0 ? styles.in : styles.out}`}>
                        {weight.format(grams)} g
                      </span>
                    )}
                  </td>
                  <td className={styles.num}>
                    <input className={`${styles.cell} ${styles.num}`} inputMode="decimal"
                           value={row.unitPrice} disabled={!!row.savedId}
                           aria-label={t('txn.col.price')}
                           onChange={(e) => patch(row.key, { unitPrice: e.target.value })} />
                  </td>
                  <td className={`${styles.num}`} style={{ padding: '6px 8px' }}>
                    {amount !== null ? money.format(amount) : ''}
                  </td>
                  <td className={styles.num}>
                    <input className={`${styles.cell} ${styles.num}`} inputMode="decimal"
                           value={row.pay1} disabled={!!row.savedId} aria-label={t('txn.col.pay1')}
                           onChange={(e) => patch(row.key, { pay1: e.target.value })} />
                  </td>
                  <td>
                    <select className={styles.select} value={row.method1} disabled={!!row.savedId}
                            aria-label={t('txn.col.method')}
                            onChange={(e) => patch(row.key, { method1: e.target.value })}>
                      {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className={styles.cell} value={row.remarks} disabled={!!row.savedId}
                           aria-label={t('txn.col.remarks')}
                           onChange={(e) => patch(row.key, { remarks: e.target.value })}
                           onBlur={() => !row.savedId && commit(row)}
                           onKeyDown={(e) => {
                             if (e.key === 'Enter') { e.preventDefault(); commit(row) }
                           }} />
                    {row.error && (
                      <div className={styles.rowError}>{t('txn.rowError')}: {row.error}</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {savedCount === 0 && <p className={styles.empty}>{t('txn.empty')}</p>}

        <datalist id="sales-people">
          {salesPeople.map((s) => <option key={s} value={s} />)}
        </datalist>
      </div>

      {/* Nothing has a direction. A zero painted red says money went out on a
          day when nothing happened, which is the same lie as printing -0.00. */}
      <div className={styles.totals}>
        <span className={styles.totalItem}>
          <span className={styles.totalLabel}>{t('txn.total.purchases')}</span>
          <span
            className={`${styles.totalValue} ${totals.purchases === 0 ? '' : styles.out}`}
            data-testid="total-purchases"
          >
            {money.format(totals.purchases)}
          </span>
        </span>
        <span className={styles.totalItem}>
          <span className={styles.totalLabel}>{t('txn.total.sales')}</span>
          <span
            className={`${styles.totalValue} ${totals.sales === 0 ? '' : styles.in}`}
            data-testid="total-sales"
          >
            {money.format(totals.sales)}
          </span>
        </span>
        <span className={styles.movement} data-testid="total-movement">
          <span className={styles.totalLabel}>{t('txn.total.movement')}</span>
          {totals.movement.map(([code, grams]) => (
            <span key={code} className={grams === 0 ? '' : grams > 0 ? styles.in : styles.out}>
              {code} {grams > 0 ? '+' : ''}{weight.format(grams)} g
            </span>
          ))}
        </span>
        {pending && <span className={styles.totalLabel}>{t('txn.saving')}…</span>}
        {voidError && <span className={styles.rowError}>{voidError}</span>}
      </div>
    </div>
  )
}
