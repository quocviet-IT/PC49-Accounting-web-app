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
  gold_pct: number | null
  uom: Uom
  qty: number
  unit_price: number | null
  amount: number
  remarks: string | null
  /** How it was settled, in the order it was entered. */
  payments: { seq: number; amount: number; method: string }[]
  /** Who is credited with it, largest share first. */
  soldBy: { code: string; sharePct: number }[]
}

/** One way a row was settled, as typed. */
type DraftPayment = {
  amount: string
  method: string
}

/** One member of staff on the order, and their part of it, as typed. */
type DraftShare = {
  code: string
  sharePct: string
}

type Draft = {
  key: number
  txnType: string
  /** Whoever worked the order. Always ends in an empty line. */
  salesPeople: DraftShare[]
  partnerCode: string
  /** The customer's number. Stored against the customer, not on the row. */
  partnerPhone: string
  goldTypeCode: string
  scrapDetail: string
  goldPct: string
  uom: Uom | ''
  qty: string
  unitPrice: string
  /** As many lines as the settlement took. Always ends in an empty one. */
  payments: DraftPayment[]
  remarks: string
  error?: string
  savedId?: string
}

const TXN_TYPES = ['PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'PICKUP', 'MEMO', 'ON_THE_WAY'] as const
const METHODS = ['CASH', 'BANKWIRE', 'ZELLE', 'CHECK'] as const

/**
 * A ceiling on the payment lines one row may carry.
 *
 * Not a business rule — an order settled twenty ways does not happen at this
 * counter. It is a bound on what a runaway client can ask the database to
 * insert in one go, set far enough above real use that nobody meets it.
 */
const MAX_PAYMENTS = 20

/** The same kind of bound, on how many people may share one order. */
const MAX_SALES_PEOPLE = 10

function blankDraft(key: number): Draft {
  return {
    key, txnType: 'PO', salesPeople: [{ code: '', sharePct: '100' }],
    partnerCode: '', partnerPhone: '', goldTypeCode: '',
    scrapDetail: '', goldPct: '', uom: '', qty: '', unitPrice: '',
    payments: [{ amount: '', method: 'CASH' }], remarks: '',
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
  partners,
  existing,
}: {
  txnDate: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
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

  /** The number already on file for a customer, if this is one we know. */
  const phoneOf = (code: string) =>
    partners.find((p) => p.code === code.trim())?.phone ?? ''

  function patch(key: number, change: Partial<Draft>) {
    setDrafts((rows) => rows.map((r) => {
      if (r.key !== key) return r
      const next = { ...r, ...change, error: undefined }
      if (change.goldTypeCode !== undefined) next.uom = uomOf(change.goldTypeCode)
      // Naming a customer we know brings their number up rather than making
      // somebody go and look it up. Typing over it changes it for that
      // customer, which is the only thing a telephone number can mean.
      if (change.partnerCode !== undefined) next.partnerPhone = phoneOf(change.partnerCode)
      return next
    }))
  }

  /**
   * Changes one payment line, and offers another once the last has a figure.
   *
   * The lines grow one at a time instead of being asked for up front, so the
   * common row — settled one way — still shows a single line, and the counter
   * never runs out of them. Half in cash, half by transfer and the rest by
   * check is an ordinary morning; until migration 0046 the table refused the
   * third outright, so it went into the remarks as prose no report can add up.
   */
  function patchPayment(key: number, index: number, change: Partial<DraftPayment>) {
    setDrafts((rows) => rows.map((r) => {
      if (r.key !== key) return r
      const payments = r.payments.map((p, i) => (i === index ? { ...p, ...change } : p))
      const last = payments[payments.length - 1]
      // Blank rather than assumed: an empty method means there is no further
      // payment, not a payment of nothing.
      if (Number(last.amount) > 0 && payments.length < MAX_PAYMENTS) {
        payments.push({ amount: '', method: '' })
      }
      return { ...r, payments, error: undefined }
    }))
  }

  /**
   * Changes one line of the split, and offers another once the last has a name.
   *
   * The shares are typed rather than worked out. Two people on an order did
   * not necessarily do half each, and a system that assumes they did pays the
   * wrong commission quietly. So the percent stays out of the way while one
   * person has the order — the single line is the whole of it — and appears
   * for every line the moment a second name arrives.
   */
  function patchShare(key: number, index: number, change: Partial<DraftShare>) {
    setDrafts((rows) => rows.map((r) => {
      if (r.key !== key) return r
      const salesPeople = r.salesPeople.map((p, i) => (i === index ? { ...p, ...change } : p))
      const last = salesPeople[salesPeople.length - 1]
      if (last.code.trim() && salesPeople.length < MAX_SALES_PEOPLE) {
        // Blank rather than a guess at the split, which is the whole point.
        salesPeople.push({ code: '', sharePct: '' })
      }
      return { ...r, salesPeople, error: undefined }
    }))
  }

  function addRow() {
    setDrafts((rows) => [...rows, blankDraft(nextKey)])
    setNextKey((k) => k + 1)
  }

  /**
   * Opens another day.
   *
   * The date goes in the address so the day is a place: it survives a reload,
   * it can be linked to from a report or a problem report, and the back button
   * returns to the day before. Clearing the field leaves the day alone rather
   * than navigating to nothing.
   */
  function goToDate(next: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next === txnDate) return
    router.push(`/gold-transactions?date=${next}`)
  }

  function commit(row: Draft) {
    const qty = Number(row.qty)
    const price = Number(row.unitPrice)
    if (!row.goldTypeCode || !qty || !price) return
    if (row.savedId || inFlight.current.has(row.key)) return
    inFlight.current.add(row.key)

    const amount = amountOf(qty, price)
    const payments = row.payments
      .map((p) => ({ amount: Number(p.amount), method: p.method }))
      .filter((p) => p.amount > 0 && p.method)

    // One person holds the whole order without having to type a hundred; two
    // or more have to say how it divides, because nothing else can know.
    const named = row.salesPeople.filter((p) => p.code.trim())
    const soldBy = named.length === 1
      ? [{ code: named[0].code.trim(), sharePct: 100 }]
      : named.map((p) => ({ code: p.code.trim(), sharePct: Number(p.sharePct) }))

    // Caught here so the accountant reads it beside the row they are typing,
    // rather than getting a constraint name back from the database.
    if (soldBy.length > 1) {
      const total = Math.round(soldBy.reduce((sum, p) => sum + (p.sharePct || 0), 0) * 100) / 100
      if (soldBy.some((p) => !(p.sharePct > 0)) || total !== 100) {
        inFlight.current.delete(row.key)
        setDrafts((rows) => rows.map((r) => (r.key === row.key
          ? { ...r, error: t('txn.shareBad') }
          : r)))
        return
      }
    }

    startTransition(async () => {
      const result: SaveResult = await saveTransaction({
        txnDate,
        txnType: row.txnType,
        goldTypeCode: row.goldTypeCode,
        uom: row.uom || uomOf(row.goldTypeCode),
        qty,
        unitPrice: price,
        amount,
        partnerCode: row.partnerCode.trim() || null,
        partnerPhone: row.partnerPhone.trim() || null,
        salesPeople: soldBy,
        scrapDetail: row.scrapDetail || null,
        goldPct: row.goldPct ? Number(row.goldPct) : null,
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

  /**
   * Correct a row: cancel it and open a fresh one holding its values.
   *
   * There is no other honest shape for this. The row has posted to the ledger
   * and moved stock, so the figures cannot be edited where they sit — the
   * ledger's answer to a wrong entry is a reversing one. What was missing was
   * not the ability to change the books, it was being spared retyping eleven
   * fields to fix one of them.
   *
   * The draft is opened first and the cancellation only committed if that
   * worked, so a failure leaves the original standing rather than deleting a
   * transaction and losing what it said.
   */
  async function correctRow(r: SavedRow) {
    const reason = window.prompt(t('txn.correctWhy'), t('txn.correctReason'))
    if (reason === null) return

    setVoiding(r.id)
    setVoidError(null)
    const result = await voidTransaction({ id: r.id, reason })
    setVoiding(null)
    if (!result.ok) { setVoidError(result.message); return }

    // Everything the old row said, including how it was settled, waiting to be
    // corrected rather than retyped.
    setDrafts((rows) => [...rows, {
      key: nextKey,
      txnType: r.txn_type,
      salesPeople: [
        ...r.soldBy.map((p) => ({ code: p.code, sharePct: String(p.sharePct) })),
        { code: '', sharePct: r.soldBy.length === 0 ? '100' : '' },
      ],
      partnerCode: r.partner_code ?? '',
      partnerPhone: phoneOf(r.partner_code ?? ''),
      goldTypeCode: r.gold_type_code,
      scrapDetail: r.scrap_detail ?? '',
      goldPct: r.gold_pct === null ? '' : String(r.gold_pct),
      uom: r.uom,
      qty: String(r.qty),
      unitPrice: r.unit_price === null ? '' : String(r.unit_price),
      payments: [
        ...r.payments.map((p) => ({ amount: String(p.amount), method: p.method })),
        // One more line, so a correction can add a way it was settled as
        // easily as it can change one.
        { amount: '', method: r.payments.length === 0 ? 'CASH' : '' },
      ],
      remarks: r.remarks ?? '',
    }])
    setNextKey((k) => k + 1)
    router.refresh()
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h1 className={styles.title}>{t('txn.title')} · {txnDate}</h1>
        {/* The day being entered, and the only way to reach any other one.
            Without it the grid always opened on today and loaded only today's
            rows, so a day entered under a different date became unreachable —
            which is what somebody meant when they reported that two
            transactions had gone missing. Nothing had; there was no way back
            to the day they were on. */}
        <label className={styles.dateField}>
          <span className={styles.dateLabel}>{t('txn.date')}</span>
          <input
            type="date"
            className={styles.dateInput}
            value={txnDate}
            aria-label={t('txn.date')}
            onChange={(e) => goToDate(e.target.value)}
          />
        </label>
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
              <th>{t('txn.col.phone')}</th>
              <th>{t('txn.col.gold')}</th>
              <th>{t('txn.col.scrap')}</th>
              <th className={styles.num}>{t('txn.col.purity')}</th>
              <th className={styles.num}>{t('txn.col.qty')}</th>
              <th className={styles.num}>{t('txn.col.price')}</th>
              <th className={styles.num}>{t('txn.col.amount')}</th>
              <th className={styles.num}>{t('txn.col.pay')}</th>
              <th>{t('txn.col.method')}</th>
              <th>{t('txn.col.remarks')}</th>
            </tr>
          </thead>
          <tbody>
            {existing.map((r) => (
              <tr key={r.id}>
                <td className={styles.status}>✓</td>
                <td>{r.txn_type}</td>
                <td>
                  {/* Everybody on it, not just the leading name. A share of
                      the whole order needs no percent beside it. */}
                  {r.soldBy.length > 1
                    ? r.soldBy.map((p) => (
                        <div key={p.code}>{p.code} {p.sharePct}%</div>
                      ))
                    : r.sales_person_code}
                </td>
                <td>{r.partner_code}</td>
                {/* Read off the customer, not off the row — one number per
                    person, so it is the same on every order they appear on. */}
                <td>{phoneOf(r.partner_code ?? '')}</td>
                <td>{goldTypes.find((g) => g.code === r.gold_type_code)
                      ? goldName(goldTypes.find((g) => g.code === r.gold_type_code)!)
                      : r.gold_type_code}</td>
                <td>{r.scrap_detail}</td>
                <td className={styles.num}>{r.gold_pct ?? ''}</td>
                <td className={styles.num}>
                  {weight.format(r.qty)}
                  <span className={`${styles.grams} ${r.qty > 0 ? styles.in : styles.out}`}>
                    {weight.format(toGrams(r.qty, r.uom))} g
                  </span>
                </td>
                <td className={styles.num}>{r.unit_price ? money.format(r.unit_price) : ''}</td>
                <td className={styles.num}>{money.format(r.amount)}</td>
                {/* What was recorded, not two blank cells. These were drawn
                    empty, so somebody who had just typed "4,300 CASH" watched it
                    disappear on save with no way to tell whether it had been
                    stored — it had. */}
                <td className={styles.num}>
                  {r.payments.map((p) => (
                    <div key={p.seq}>{money.format(p.amount)}</div>
                  ))}
                </td>
                <td>
                  {r.payments.map((p) => (
                    <div key={p.seq}>{p.method}</div>
                  ))}
                </td>
                {/* A saved row is not editable — correcting it means cancelling
                    it and typing the right one, which is what the ledger can
                    actually represent. */}
                <td>
                  {/* Correcting comes first: it is what somebody who spotted a
                      typo actually wants, and cancelling outright is the rarer
                      thing. Both leave the original row in the ledger with a
                      reversing entry against it. */}
                  <button
                    type="button"
                    className={styles.select}
                    style={{ width: 'auto', marginRight: 6 }}
                    disabled={voiding === r.id}
                    onClick={() => void correctRow(r)}
                  >
                    {t('txn.correct')}
                  </button>
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
              // A saved row shows what was settled and nothing else. The
              // trailing empty line is an invitation to type, and there is
              // nothing left to type into it.
              const payLines = row.savedId
                ? row.payments.filter((p) => Number(p.amount) > 0)
                : row.payments
              const shareLines = row.savedId
                ? row.salesPeople.filter((p) => p.code.trim())
                : row.salesPeople
              const named = row.salesPeople.filter((p) => p.code.trim())
              const manyPeople = named.length > 1
              const shareTotal = Math.round(
                named.reduce((sum, p) => sum + (Number(p.sharePct) || 0), 0) * 100) / 100
              // A blank share on a named line is not a share of nothing, it is
              // a share nobody has stated. Saying so beats letting the total
              // read a plausible hundred while one person holds all of it.
              const shareMissing = named.some((p) => !(Number(p.sharePct) > 0))
              const sharesValid = !manyPeople || (!shareMissing && shareTotal === 100)
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
                  {/* One name is the ordinary case and stays a single box.
                      A second name brings out the percents, because from then
                      on the order divides and only the person typing knows
                      how. The shares have to come to a hundred; the row says
                      so rather than letting a commission run find out. */}
                  <td>
                    {shareLines.map((p, i) => (
                      <div key={i} className={styles.shareLine}>
                        <input className={styles.cell} list="sales-people" value={p.code}
                               disabled={!!row.savedId}
                               aria-label={i === 0
                                 ? t('txn.col.sales')
                                 : `${t('txn.col.sales')} ${i + 1}`}
                               onChange={(e) => patchShare(row.key, i, { code: e.target.value })} />
                        {manyPeople && (
                          <input className={`${styles.cell} ${styles.num} ${styles.sharePct}`}
                                 inputMode="decimal" value={p.sharePct} disabled={!!row.savedId}
                                 aria-label={`${t('txn.col.share')} ${i + 1}`} placeholder="%"
                                 onChange={(e) =>
                                   patchShare(row.key, i, { sharePct: e.target.value })} />
                        )}
                      </div>
                    ))}
                    {manyPeople && !sharesValid && !row.savedId && (
                      <div className={styles.rowError}>
                        {shareMissing
                          ? t('txn.shareMissing')
                          : `${t('txn.shareTotal')} ${shareTotal}%`}
                      </div>
                    )}
                  </td>
                  <td>
                    <input className={styles.cell} list="partners" value={row.partnerCode}
                           disabled={!!row.savedId}
                           aria-label={t('txn.col.partner')}
                           onChange={(e) => patch(row.key, { partnerCode: e.target.value })} />
                  </td>
                  {/* Typed here because here is where the customer is standing,
                      but written against the customer rather than the row. */}
                  <td>
                    <input className={styles.cell} inputMode="tel" value={row.partnerPhone}
                           disabled={!!row.savedId}
                           aria-label={t('txn.col.phone')}
                           onChange={(e) => patch(row.key, { partnerPhone: e.target.value })} />
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
                  {/* The note beside it says "14k/grs", which reads well and
                      adds up to nothing. This is the same fact as a number, so
                      a report can weigh what was bought against what came back
                      from refining. A fraction, as everywhere else: 14k is
                      0.583, and 58.3 is refused rather than valuing the row at
                      a hundred times what it is worth. */}
                  <td className={styles.num}>
                    <input className={`${styles.cell} ${styles.num}`} inputMode="decimal"
                           value={row.goldPct} disabled={!!row.savedId}
                           aria-label={t('txn.col.purity')} placeholder="0.583"
                           onChange={(e) => patch(row.key, { goldPct: e.target.value })} />
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
                  {/* One line per way the row was settled, and always one
                      spare. The books have never had a limit here — the
                      posting function loops over every payment row it finds —
                      so the screen no longer imposes one either. */}
                  <td className={styles.num}>
                    {payLines.map((p, i) => (
                      <input key={i} className={`${styles.cell} ${styles.num}`} inputMode="decimal"
                             value={p.amount} disabled={!!row.savedId}
                             aria-label={`${t('txn.col.pay')} ${i + 1}`}
                             placeholder={i === 0 ? undefined : `${t('txn.col.pay')} ${i + 1}`}
                             onChange={(e) => patchPayment(row.key, i, { amount: e.target.value })} />
                    ))}
                  </td>
                  <td>
                    {payLines.map((p, i) => (
                      <select key={i} className={styles.select} value={p.method}
                              disabled={!!row.savedId}
                              aria-label={i === 0
                                ? t('txn.col.method')
                                : `${t('txn.col.method')} ${i + 1}`}
                              onChange={(e) => patchPayment(row.key, i, { method: e.target.value })}>
                        {/* Every line after the first starts blank: a further
                            method is offered, not assumed, and an empty one
                            means there is no further payment rather than a
                            payment of nothing. */}
                        {i > 0 && <option value="" />}
                        {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ))}
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

        <datalist id="partners">
          {partners.map((p) => <option key={p.code} value={p.code} />)}
        </datalist>

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
