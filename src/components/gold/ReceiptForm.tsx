'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, AutoComplete, Button, Col, Form, Input, InputNumber, Modal,
  Row, Select, Typography,
} from 'antd'
import { Check, ListPlus, Plus, Trash2, X } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { toGrams, type Uom } from '@/lib/domain/units'
import {
  correctReceipt, saveReceipt, type SaveResult,
} from '@/app/(app)/gold-transactions/actions'
import {
  MAX_PAYMENTS, MAX_SALES_ON_ORDER, PAYMENT_METHODS, SALES_SPLIT,
  SCRAP_BANDS, SCRAP_TYPES, TXN_TYPES,
  type GoldTypeOption, type ReceiptRow,
} from './types'
import {
  MAX_RECEIPT_LINES, SINGLE_LINE_TYPES, fineGrams, lineFromSaved, linePayload,
  paymentGap, pricedByFine, receiptTotal, relate,
  type LineField, type Typed,
} from './receiptLine'
import { describeRefusal } from './receiptErrors'
import { normalizeTransactionSearch } from './transactionFilters'
import styles from './Txn.module.css'

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const fineFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 4,
})

type PaymentField = { amount: number | null; method: string | null }

type Values = {
  /** The day the receipt belongs to. */
  txnDate: string
  txnType: string
  partnerCode: string
  partnerPhone: string
  remarks: string
  /** In order: the first name is the lead and takes the larger share. */
  salesPeople: string[]
  /** The items, in the order they are written on the paper. */
  lines: LineField[]
  payments: PaymentField[]
  reason: string
}

const EMPTY_LINE: LineField = {
  itemDesc: '', goldTypeCode: '', scrapDetail: null, qty: null, goldPct: null,
  finePrice: null, unitPrice: null, total: null,
}

/** The figures of an item that follow one another when one is typed. */
const FIGURES: Typed[] = ['qty', 'goldPct', 'finePrice', 'unitPrice', 'total']

/** The types the books will not post without a payment (post_gold_txn, 0015). */
const NEEDS_PAYMENT = new Set(['PO', 'PO_VENDOR', 'DEPOSIT'])

/** The shares an order divides into, by how many people are on it (B6). */
function sharesFor(people: string[]): { code: string; sharePct: number }[] {
  const split = SALES_SPLIT[people.length] ?? []
  return people.map((code, i) => ({ code, sharePct: split[i] ?? 0 }))
}

const asNumber = (value: number | string | null | undefined): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value)

/**
 * One receipt, entered as it is written: a customer, how it was paid, and the
 * items on it (spec 2026-09-17). It replaces the one-gold-type form, which made
 * a customer selling six pieces into six transactions typed six times.
 *
 * Shaped by the accountant's answers of 10/09, which still hold per item:
 *
 *   B2  the document number is minted by the database, once per receipt
 *   B3  the paper sometimes carries the amount and sometimes the price, so
 *       either may be typed and the other follows; for gold weighed in grams
 *       with a purity, the price is per fine gram, as on the paper
 *   B5  scrap has exactly two bags, chosen not typed
 *   B6  up to three people on an order, shares fixed by count and position
 *   B12 correcting is one click: the reason is filled in and may be left
 *
 * Correcting reuses this form with every item of the receipt. Nothing is
 * written when it opens: the original stays posted until this is saved, and
 * the reversal and the replacement happen in one database transaction.
 */
export function ReceiptForm({
  open, onClose, onSaved, txnDate, goldTypes, salesPeople, partners, correcting,
}: {
  open: boolean
  onClose: () => void
  /** Called with the number the receipt was given, and whether the form stays open. */
  onSaved: (docNo: string | null, stayOpen: boolean) => void
  txnDate: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
  /** The receipt being replaced, or null when this is a fresh one. */
  correcting: ReceiptRow | null
}) {
  const { locale, t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState(false)
  /**
   * Whether anything has been typed since the form opened or last saved: a
   * form that threw its input away on Esc is somebody believing they entered a
   * receipt that never reached the books.
   */
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  function requestClose() {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  // Reloading or closing the tab loses the same input.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // A refusal is shown at the top of the form and brought into view.
  useEffect(() => {
    if (error) topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  /**
   * Stable for the life of one receipt on this form, so pressing Save twice, or
   * trying again after an answer went missing, is the same receipt rather than
   * a second one. Renewed only once a save has succeeded.
   */
  const requestKey = useRef<string>(crypto.randomUUID())

  const goldName = (g: GoldTypeOption) => (locale === 'vi' ? g.name_vi : g.name_en)
  const uomOf = (code: string): Uom | '' =>
    goldTypes.find((g) => g.code === code)?.native_uom ?? ''
  const phoneOf = (code: string) =>
    partners.find((p) => p.code === code.trim())?.phone ?? ''
  const itemLabel = (n: number) => t('receipt.item').replace('{0}', String(n))

  const initial: Values = useMemo(() => (correcting
    ? {
        txnDate,
        txnType: correcting.txn_type,
        partnerCode: correcting.partner_code ?? '',
        partnerPhone: correcting.partner_phone ?? phoneOf(correcting.partner_code ?? ''),
        remarks: correcting.remarks ?? '',
        salesPeople: correcting.soldBy.map((p) => p.code),
        lines: correcting.lines.map((l) => lineFromSaved(correcting.txn_type, l)),
        payments: correcting.payments.length
          ? correcting.payments.map((p) => ({ amount: p.amount, method: p.method }))
          : [{ amount: null, method: 'CASH' }],
        // Filled in so correcting is one click (B12). Still editable.
        reason: t('txn.correctReason'),
      }
    : {
        txnDate,
        txnType: 'PO',
        partnerCode: '',
        partnerPhone: '',
        remarks: '',
        salesPeople: [],
        lines: [{ ...EMPTY_LINE }],
        payments: [{ amount: null, method: 'CASH' }],
        reason: '',
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [correcting])

  const txnType = (Form.useWatch('txnType', form) ?? initial.txnType) as string
  const lines = (Form.useWatch('lines', form) ?? []) as (LineField | undefined)[]
  const payments = (Form.useWatch('payments', form) ?? []) as (PaymentField | undefined)[]
  const people = (Form.useWatch('salesPeople', form) ?? []) as string[]
  const shares = sharesFor(people)
  const single = SINGLE_LINE_TYPES.has(txnType)
  const total = receiptTotal(lines)
  const gap = paymentGap(total, payments)
  const grams = lines.reduce((sum, l) => {
    const uom = uomOf(l?.goldTypeCode ?? '')
    return uom && l?.qty ? sum + toGrams(Math.abs(Number(l.qty)), uom) : sum
  }, 0)

  /**
   * One figure of item `index` typed: the others follow (B3). Only the figures
   * that follow are written back; the one being typed is left alone, so the
   * cursor stays where it is.
   */
  function typedOn(index: number, typed: Typed, value: number | string | null) {
    const line = {
      ...(form.getFieldValue(['lines', index]) as LineField),
      [typed]: asNumber(value),
    }
    const next = relate(uomOf(line.goldTypeCode), line, typed)
    for (const key of FIGURES) {
      if (key !== typed && next[key] !== line[key]) {
        form.setFieldValue(['lines', index, key], next[key])
      }
    }
  }

  /** A gold type chosen: the unit may have changed, and with it how the item is priced. */
  function goldTyped(index: number, code: string) {
    if (uomOf(code) !== 'GRAM') form.setFieldValue(['lines', index, 'goldPct'], null)
    const line = form.getFieldValue(['lines', index]) as LineField
    typedOn(index, 'qty', line.qty)
  }

  async function submit(stayOpen: boolean) {
    setError(null)
    setWarning(null)
    setLastSaved(null)
    try {
      await form.validateFields()
    } catch {
      // The fields already say what is wrong; scrollToFirstError brings the
      // first of them into view.
      setValidationError(true)
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    // The whole store, not only the fields on screen: an item priced per fine
    // gram keeps its unit price with no field drawn for it.
    const v = form.getFieldsValue(true) as Values

    const body = {
      requestKey: requestKey.current,
      txnDate: v.txnDate,
      txnType: v.txnType,
      partnerCode: v.partnerCode?.trim() || null,
      partnerPhone: v.partnerPhone?.trim() || null,
      salesPeople: sharesFor(v.salesPeople ?? []),
      remarks: v.remarks?.trim() || null,
      payments: (v.payments ?? [])
        .map((p) => ({ amount: Number(p?.amount ?? 0), method: String(p?.method ?? '') }))
        .filter((p) => p.amount > 0 && p.method),
      lines: (v.lines ?? []).map((l) => linePayload(v.txnType, uomOf(l.goldTypeCode) as Uom, l)),
    }

    setSaving(true)
    // Settled rather than awaited bare: a page older than the server, or a lost
    // connection, must stop the spinner and say so (16-09).
    const result = await settleAction((): Promise<SaveResult> => (correcting
      ? correctReceipt({
          ...body,
          original: correcting.key,
          expectedRevision: correcting.revision,
          reason: v.reason,
        })
      : saveReceipt(body)))
    setSaving(false)

    if (!result.ok) {
      setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }
    // The money is on the books; filing the customer beside it may not be.
    if (result.warning) setWarning(result.warning)

    if (stayOpen && !correcting) {
      // The next receipt: the same day, everything else fresh, and a fresh key
      // so it cannot be mistaken for a retry of this one.
      requestKey.current = crypto.randomUUID()
      form.resetFields()
      form.setFieldValue('txnDate', v.txnDate)
      setDirty(false)
      setLastSaved(result.docNo)
      onSaved(result.docNo, true)
      return
    }
    setDirty(false)
    onSaved(result.docNo, false)
  }

  return (
    <Modal
      open={open}
      width={1040}
      title={t(correcting ? 'txn.form.correctTitle' : 'txn.form.newTitle')}
      onCancel={requestClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" icon={<X size={16} aria-hidden />} onClick={requestClose}>
          {t('txn.form.close')}
        </Button>,
        !correcting && (
          <Button key="more" icon={<ListPlus size={16} aria-hidden />} loading={saving}
                  onClick={() => submit(true)}>
            {t('txn.form.saveMore')}
          </Button>
        ),
        <Button key="save" type="primary" icon={<Check size={16} aria-hidden />} loading={saving}
                onClick={() => submit(false)}>
          {t('txn.save')}
        </Button>,
      ]}
    >
      <Form<Values> form={form} layout="vertical" initialValues={initial}
                    className={styles.form} scrollToFirstError
                    onValuesChange={() => { setDirty(true); setValidationError(false) }}>
        <div ref={topRef} />
        {validationError && (
          <Alert type="error" showIcon role="alert" title={t('txn.form.checkFields')} />
        )}
        {error && (
          <Alert type="error" showIcon title={t('txn.rowError')} description={error}
                 style={{ marginBottom: 12 }} />
        )}
        {warning && (
          <Alert type="warning" showIcon title={t('txn.savedWithWarning')} description={warning}
                 style={{ marginBottom: 12 }} />
        )}
        {lastSaved && (
          <Alert type="success" showIcon style={{ marginBottom: 12 }}
                 title={`${t('txn.form.savedAs')} ${lastSaved}`} />
        )}

        {correcting && (
          <section className={styles.section} aria-labelledby="txn-correction-heading">
            <h3 id="txn-correction-heading" className={styles.sectionHeading}>
              {t('txn.form.correction')}
            </h3>
            <Form.Item
              name="reason"
              label={t('txn.form.reason')}
              extra={t('txn.form.reasonHint')}
              rules={[{ required: true, min: 3, message: t('txn.form.required') }]}
            >
              <Input />
            </Form.Item>
          </section>
        )}

        <section className={styles.section} aria-labelledby="txn-details-heading">
          <h3 id="txn-details-heading" className={styles.sectionHeading}>
            {t('txn.form.details')}
          </h3>
          <Row gutter={12}>
            <Col xs={24} sm={8}>
              {/* A correction keeps the day of the receipt it replaces. */}
              <Form.Item name="txnDate" label={t('txn.date')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <Input type="date" disabled={Boolean(correcting)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item name="txnType" label={t('txn.col.type')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <Select options={TXN_TYPES.map((v) => ({ value: v, label: v }))} />
              </Form.Item>
            </Col>
          </Row>
        </section>

        <section className={styles.section} aria-labelledby="txn-who-heading">
          <h3 id="txn-who-heading" className={styles.sectionHeading}>{t('txn.form.who')}</h3>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="partnerCode" label={t('txn.col.partner')}>
                <AutoComplete
                  options={partners.map((p) => ({ value: p.code }))}
                  filterOption={(input, option) =>
                    normalizeTransactionSearch(option?.value)
                      .includes(normalizeTransactionSearch(input))}
                  onChange={(value) => {
                    // Naming a customer we know brings their number up.
                    const phone = phoneOf(String(value ?? ''))
                    if (phone) form.setFieldValue('partnerPhone', phone)
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="partnerPhone" label={t('txn.col.phone')}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="salesPeople" label={t('txn.col.sales')} extra={t('txn.form.split')}>
            <Select
              mode="multiple"
              maxCount={MAX_SALES_ON_ORDER}
              options={salesPeople.map((c) => ({ value: c, label: c }))}
            />
          </Form.Item>
          {shares.length > 1 && (
            <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>
              {shares.map((s) => `${s.code} ${s.sharePct}%`).join(' · ')}
            </Typography.Paragraph>
          )}
        </section>

        <section className={styles.section} aria-labelledby="txn-lines-heading">
          <h3 id="txn-lines-heading" className={styles.sectionHeading}>{t('receipt.lines')}</h3>
          <span className={styles.sectionDescription}>
            {t('receipt.linesHint')} {t('receipt.signHint')}
          </span>
          <Form.List
            name="lines"
            rules={[{
              validator: async (_, list: LineField[] | undefined) => {
                const n = (list ?? []).length
                if (n < 1 || n > MAX_RECEIPT_LINES) throw new Error(t('receipt.err.size'))
                if (SINGLE_LINE_TYPES.has(form.getFieldValue('txnType')) && n > 1) {
                  throw new Error(t('receipt.err.single'))
                }
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field, index) => {
                  const line = lines[index]
                  const code = line?.goldTypeCode ?? ''
                  const uom = uomOf(code)
                  const byFine = pricedByFine(uom, line?.goldPct)
                  const fine = fineGrams(uom, line?.qty, line?.goldPct)
                  return (
                    <div key={field.key} className={styles.line} role="group"
                         aria-label={itemLabel(index + 1)}>
                      <div className={styles.lineHead}>
                        <span className={styles.lineNo}>{itemLabel(index + 1)}</span>
                        <Button type="text" danger size="small"
                                icon={<Trash2 size={16} aria-hidden />}
                                aria-label={t('receipt.removeItem')}
                                disabled={fields.length === 1}
                                onClick={() => remove(field.name)} />
                      </div>
                      <Row gutter={12}>
                        <Col xs={24} sm={10}>
                          <Form.Item name={[field.name, 'itemDesc']} label={t('receipt.itemDesc')}>
                            <Input maxLength={120} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={7}>
                          <Form.Item name={[field.name, 'goldTypeCode']} label={t('txn.col.gold')}
                                     rules={[{ required: true, message: t('txn.form.required') }]}>
                            <Select
                              showSearch
                              optionFilterProp="label"
                              options={goldTypes.map((g) => ({ value: g.code, label: goldName(g) }))}
                              onChange={(value: string) => goldTyped(index, value)}
                            />
                          </Form.Item>
                        </Col>
                        {/* The bag is a choice of two, only for scrap (B5). */}
                        {SCRAP_TYPES.has(code) && (
                          <Col xs={24} sm={7}>
                            <Form.Item name={[field.name, 'scrapDetail']} label={t('txn.form.band')}
                                       preserve={false}>
                              <Select allowClear
                                      options={SCRAP_BANDS.map((b) => ({ value: b, label: b }))} />
                            </Form.Item>
                          </Col>
                        )}
                      </Row>
                      <Row gutter={12}>
                        <Col xs={12} sm={5}>
                          <Form.Item
                            name={[field.name, 'qty']}
                            label={t('txn.col.qty')}
                            rules={[
                              { required: true, message: t('txn.form.required') },
                              {
                                validator: (_, value) => (Number(value) === 0
                                  ? Promise.reject(new Error(t('txn.form.qtyZero')))
                                  : Promise.resolve()),
                              },
                            ]}
                          >
                            <InputNumber style={{ width: '100%' }} step={0.01} controls={false}
                                         suffix={uom || undefined}
                                         onChange={(value) => typedOn(index, 'qty', value)} />
                          </Form.Item>
                        </Col>
                        {uom === 'GRAM' && (
                          <>
                            <Col xs={12} sm={4}>
                              <Form.Item
                                name={[field.name, 'goldPct']}
                                label={t('txn.col.purity')}
                                rules={[{ type: 'number', min: 0, max: 1, message: t('txn.col.purity') }]}
                              >
                                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.001}
                                             controls={false}
                                             onChange={(value) => typedOn(index, 'goldPct', value)} />
                              </Form.Item>
                            </Col>
                            <Col xs={12} sm={4}>
                              <Form.Item label={t('receipt.fine')}>
                                <output className={styles.fine} aria-live="polite">
                                  {fine === null ? '—' : fineFormat.format(fine)}
                                </output>
                              </Form.Item>
                            </Col>
                          </>
                        )}
                        <Col xs={12} sm={uom === 'GRAM' ? 5 : 9}>
                          {byFine ? (
                            <Form.Item name={[field.name, 'finePrice']} label={t('receipt.finePrice')}>
                              <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false}
                                           onChange={(value) => typedOn(index, 'finePrice', value)} />
                            </Form.Item>
                          ) : (
                            <Form.Item name={[field.name, 'unitPrice']} label={t('txn.col.price')}>
                              <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false}
                                           onChange={(value) => typedOn(index, 'unitPrice', value)} />
                            </Form.Item>
                          )}
                        </Col>
                        <Col xs={12} sm={uom === 'GRAM' ? 6 : 10}>
                          <Form.Item name={[field.name, 'total']} label={t('txn.col.amount')}>
                            <InputNumber style={{ width: '100%' }} min={0} step={1} controls={false}
                                         onChange={(value) => typedOn(index, 'total', value)} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </div>
                  )
                })}
                <Form.ErrorList errors={errors} />
                {/* A deposit and a pickup are one item each (0074). */}
                {!single && fields.length < MAX_RECEIPT_LINES && (
                  <Button type="dashed" block className={styles.addLine}
                          icon={<Plus size={16} aria-hidden />}
                          onClick={() => add({ ...EMPTY_LINE })}>
                    {t('receipt.addItem')}
                  </Button>
                )}
              </>
            )}
          </Form.List>

          <div className={styles.calculatedAmount} aria-live="polite">
            <span>{t('receipt.weight')}: {fineFormat.format(grams)} g</span>
            <strong>{t('receipt.total')}: {money.format(total)}</strong>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="txn-settle-heading">
          <h3 id="txn-settle-heading" className={styles.sectionHeading}>{t('txn.form.settle')}</h3>
          <Form.List
            name="payments"
            rules={[{
              // The books refuse a purchase or a deposit with no payment on it.
              validator: async (_, list: PaymentField[] | undefined) => {
                if (!NEEDS_PAYMENT.has(form.getFieldValue('txnType'))) return
                const complete = (list ?? []).some((p) => Number(p?.amount ?? 0) > 0 && p?.method)
                if (!complete) throw new Error(t('txn.form.paymentRequired'))
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={12} key={field.key} align="middle" className={styles.paymentRow}>
                    <Col xs={24} sm={10}>
                      <Form.Item name={[field.name, 'amount']} label={t('txn.form.payAmount')}>
                        <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
                      </Form.Item>
                    </Col>
                    <Col xs={16} sm={10}>
                      <Form.Item
                        name={[field.name, 'method']}
                        label={t('txn.col.method')}
                        dependencies={[['payments', field.name, 'amount']]}
                        rules={[({ getFieldValue }) => ({
                          // An amount with no method used to be dropped on save.
                          validator: (_, method) => (
                            Number(getFieldValue(['payments', field.name, 'amount']) ?? 0) > 0 && !method
                              ? Promise.reject(new Error(t('txn.form.methodMissing')))
                              : Promise.resolve()),
                        })]}
                      >
                        <Select allowClear
                                options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={8} sm={4}>
                      <Button type="text" danger icon={<Trash2 size={16} aria-hidden />}
                              aria-label={t('txn.form.remove')}
                              disabled={fields.length === 1}
                              onClick={() => remove(field.name)} />
                    </Col>
                  </Row>
                ))}
                <Form.ErrorList errors={errors} />
                {fields.length < MAX_PAYMENTS && (
                  <Button type="dashed" block icon={<Plus size={16} aria-hidden />}
                          onClick={() => add({ amount: null, method: null })}>
                    {t('txn.form.addPayment')}
                  </Button>
                )}
              </>
            )}
          </Form.List>

          {/* Said while typing, not refused: a purchase paid over or under is
              recorded as it happened (spec 2026-09-17). */}
          {total > 0 && Math.abs(gap) >= 0.005 && (
            <Alert type="warning" showIcon role="status" className={styles.gap}
                   title={gap > 0
                     ? t('receipt.gap.over').replace('{0}', money.format(gap))
                     : t('receipt.gap.under').replace('{0}', money.format(-gap))} />
          )}

          <Form.Item name="remarks" label={t('txn.col.remarks')} style={{ marginTop: 16 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </section>
      </Form>

      <Modal
        open={confirmClose}
        title={t('txn.form.unsavedTitle')}
        okText={t('txn.form.discard')}
        okButtonProps={{ danger: true }}
        cancelText={t('txn.form.keepEditing')}
        onOk={() => { setConfirmClose(false); setDirty(false); onClose() }}
        onCancel={() => setConfirmClose(false)}
      >
        {t('txn.form.unsavedBody')}
      </Modal>
    </Modal>
  )
}
