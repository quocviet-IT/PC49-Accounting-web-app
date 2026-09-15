'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, AutoComplete, Button, Col, Form, Input, InputNumber, Modal,
  Row, Select, Typography,
} from 'antd'
import { Plus, Trash2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import type { Uom } from '@/lib/domain/units'
import {
  correctTransaction, saveTransaction, type SaveResult,
} from '@/app/(app)/gold-transactions/actions'
import {
  amountOf, MAX_PAYMENTS, MAX_SALES_ON_ORDER, PAYMENT_METHODS, SALES_SPLIT,
  SCRAP_BANDS, SCRAP_TYPES, TXN_TYPES,
  type GoldTypeOption, type SavedRow,
} from './types'
import { normalizeTransactionSearch } from './transactionFilters'
import styles from './Txn.module.css'

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

type PaymentField = { amount: number | null; method: string | null }

type Values = {
  /** The day the transaction belongs to. */
  txnDate: string
  txnType: string
  goldTypeCode: string
  qty: number | null
  unitPrice: number | null
  /** What is written on the receipt, unsigned. The sign follows the type. */
  total: number | null
  scrapDetail: string | null
  goldPct: number | null
  partnerCode: string
  partnerPhone: string
  remarks: string
  /** In order: the first name is the lead and takes the larger share. */
  salesPeople: string[]
  payments: PaymentField[]
  reason: string
}

/** The shares an order divides into, by how many people are on it (B6). */
function sharesFor(people: string[]): { code: string; sharePct: number }[] {
  const split = SALES_SPLIT[people.length] ?? []
  return people.map((code, i) => ({ code, sharePct: split[i] ?? 0 }))
}

/**
 * One transaction, entered on a form rather than typed across a row.
 *
 * Shaped by the accountant's answers of 10/09:
 *
 *   B2  the document number is minted by the database (0057); the form
 *       shows it back after saving rather than asking for it
 *   B3  the receipt sometimes carries a total ("34.98g x 18K … 3200") and
 *       sometimes a unit price ("1oz ML 3970"), so either may be typed and
 *       the other follows
 *   B5  scrap has exactly two bags, chosen not typed
 *   B6  up to three people on an order, shares fixed by count and position
 *   B12 correcting is one click — the reason is filled in and may be left
 *
 * Correcting reuses this form. Nothing is written when it opens: the original
 * stays live and posted until this is saved, and the reversal and the
 * replacement happen in the same database transaction.
 */
/** The types the books will not post without a payment (post_gold_txn, 0015). */
const NEEDS_PAYMENT = new Set(['PO', 'PO_VENDOR', 'DEPOSIT'])

export function TxnForm({
  open, onClose, onSaved, txnDate, goldTypes, salesPeople, partners, correcting,
}: {
  open: boolean
  onClose: () => void
  /** Called with the number the row was given, and whether the form stays open. */
  onSaved: (docNo: string | null, stayOpen: boolean) => void
  txnDate: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
  /** The row being replaced, or null when this is a fresh transaction. */
  correcting: SavedRow | null
}) {
  const { locale, t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [validationError, setValidationError] = useState(false)
  /**
   * Whether anything has been typed since the form opened or last saved.
   *
   * A form that threw its input away on Esc, on the X, or on Close is the same
   * loss the grid's draft guard was built against: somebody believes they have
   * entered a transaction that never reached the books.
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

  // A refusal is shown at the top of the form and brought into view. At the foot
  // of a dialog this long it sat below the fold, and pressing Save looked like
  // nothing happening at all.
  useEffect(() => {
    if (error) topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [error])

  /**
   * Stable for the life of one transaction on this form, so pressing Save
   * twice — or trying again after an answer went missing — is recognised as
   * the same intention rather than a second purchase. Renewed only once a
   * save has succeeded and the form is reused for the next one.
   */
  const requestKey = useRef<string>(crypto.randomUUID())

  const goldName = (g: GoldTypeOption) => (locale === 'vi' ? g.name_vi : g.name_en)
  const uomOf = (code: string): Uom | '' =>
    goldTypes.find((g) => g.code === code)?.native_uom ?? ''
  const phoneOf = (code: string) =>
    partners.find((p) => p.code === code.trim())?.phone ?? ''

  /**
   * A refusal from the books, in words the accountant reads.
   *
   * The database words its refusals for whoever wrote the trigger. The two an
   * accountant can meet at this counter are said in Vietnamese; anything else
   * passes through unchanged rather than being guessed at.
   */
  const readable = (message: string) => (
    /no journal lines|no payments recorded/.test(message) ? t('txn.err.noPayments')
      : /is not a valid movement for .*no such flow rule/.test(message) ? t('txn.err.flowRule')
        : message)

  const initial: Values = useMemo(() => (correcting
    ? {
        txnDate,
        txnType: correcting.txn_type,
        goldTypeCode: correcting.gold_type_code,
        qty: correcting.qty,
        unitPrice: correcting.unit_price,
        total: Math.abs(correcting.amount),
        scrapDetail: correcting.scrap_detail,
        goldPct: correcting.gold_pct,
        partnerCode: correcting.partner_code ?? '',
        partnerPhone: phoneOf(correcting.partner_code ?? ''),
        remarks: correcting.remarks ?? '',
        salesPeople: correcting.soldBy.map((p) => p.code),
        payments: correcting.payments.length
          ? correcting.payments.map((p) => ({ amount: p.amount, method: p.method }))
          : [{ amount: null, method: 'CASH' }],
        // Filled in so correcting is one click (B12). Still editable.
        reason: t('txn.correctReason'),
      }
    : {
        txnDate,
        txnType: 'PO',
        goldTypeCode: '',
        qty: null,
        unitPrice: null,
        total: null,
        scrapDetail: null,
        goldPct: null,
        partnerCode: '',
        partnerPhone: '',
        remarks: '',
        salesPeople: [],
        payments: [{ amount: null, method: 'CASH' }],
        reason: '',
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [correcting])

  const goldTypeCode = Form.useWatch('goldTypeCode', form)
  const qty = Form.useWatch('qty', form)
  const unitPrice = Form.useWatch('unitPrice', form)
  const people = Form.useWatch('salesPeople', form) ?? []

  const uom = uomOf(goldTypeCode ?? '')
  const isScrap = SCRAP_TYPES.has(goldTypeCode ?? '')
  const signed = amountOf(Number(qty ?? 0), unitPrice ?? null)
  const shares = sharesFor(people)

  /**
   * Either figure may be typed and the other follows (B3).
   *
   * The price is kept to eight decimals because the database recomputes the
   * amount from quantity and price and refuses one that disagrees by more
   * than half a cent: 3200 over 34.98 g is 91.480846… and rounding it to
   * cents would come back as 3199.99.
   */
  function priceTyped(price: number | null) {
    const q = Math.abs(Number(form.getFieldValue('qty') ?? 0))
    form.setFieldValue('total', price === null || !q ? null : Math.round(q * price * 100) / 100)
  }
  function totalTyped(total: number | null) {
    const q = Math.abs(Number(form.getFieldValue('qty') ?? 0))
    form.setFieldValue('unitPrice',
      total === null || !q ? null : Math.round((total / q) * 1e8) / 1e8)
  }
  function qtyTyped() {
    // A quantity typed after the total keeps the total; the price follows.
    const total = form.getFieldValue('total') as number | null | undefined
    if (total !== null && total !== undefined) totalTyped(total)
  }

  async function submit(stayOpen: boolean) {
    setError(null)
    setWarning(null)
    setLastSaved(null)
    let v: Values
    try {
      v = await form.validateFields()
    } catch {
      // The fields already say what is wrong, and scrollToFirstError brings the
      // first of them into view. Left unhandled, this rejection was logged as an
      // error on every save attempted with a field missing.
      setValidationError(true)
      topRef.current?.scrollIntoView({ block: 'nearest' })
      return
    }

    const payments = (v.payments ?? [])
      .map((p) => ({ amount: Number(p?.amount ?? 0), method: String(p?.method ?? '') }))
      .filter((p) => p.amount > 0 && p.method)

    const body = {
      requestKey: requestKey.current,
      txnDate: v.txnDate,
      txnType: v.txnType,
      goldTypeCode: v.goldTypeCode,
      uom: uomOf(v.goldTypeCode),
      qty: Number(v.qty),
      unitPrice: v.unitPrice ?? null,
      amount: amountOf(Number(v.qty), v.unitPrice ?? null),
      partnerCode: v.partnerCode?.trim() || null,
      partnerPhone: v.partnerPhone?.trim() || null,
      salesPeople: sharesFor(v.salesPeople ?? []),
      scrapDetail: SCRAP_TYPES.has(v.goldTypeCode) ? (v.scrapDetail ?? null) : null,
      goldPct: v.goldPct ?? null,
      remarks: v.remarks?.trim() || null,
      payments,
    }

    setSaving(true)
    const result: SaveResult = correcting
      ? await correctTransaction({
          ...body,
          originalId: correcting.id,
          expectedRevision: correcting.revision,
          reason: v.reason,
        })
      : await saveTransaction(body)
    setSaving(false)

    if (!result.ok) { setError(readable(result.message)); return }
    // The money is on the books. Something beside it — filing the customer —
    // may not be, and that is a different sentence: shown against a
    // transaction that saved, never as a failure to save.
    if (result.warning) { setWarning(result.warning) }

    if (stayOpen && !correcting) {
      // The next transaction on the same day: same date, everything else
      // fresh, and a fresh key so it cannot be mistaken for a retry of this one.
      requestKey.current = crypto.randomUUID()
      form.resetFields()
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
      width={820}
      title={t(correcting ? 'txn.form.correctTitle' : 'txn.form.newTitle')}
      onCancel={requestClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={requestClose}>{t('txn.form.close')}</Button>,
        !correcting && (
          <Button key="more" loading={saving} onClick={() => submit(true)}>
            {t('txn.form.saveMore')}
          </Button>
        ),
        <Button key="save" type="primary" loading={saving} onClick={() => submit(false)}>
          {t('txn.save')}
        </Button>,
      ]}
    >
      {/* Not preserve={false} on the whole form: the form library does not
          apply it to list fields, and in development — where React mounts
          everything twice — it wiped the payment rows' default method, so a
          new form offered no way it was paid. It belongs on the two scrap
          fields that come and go. */}
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
            {/* The ledger shows every day now, so the day is a field. It starts
                on the day being looked at, or today; a correction keeps the
                day of the row it replaces. */}
            <Form.Item name="txnDate" label={t('txn.date')}
                       rules={[{ required: true, message: t('txn.form.required') }]}>
              <Input type="date" disabled={Boolean(correcting)} />
            </Form.Item>
          </Col>
          </Row>
          <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="txnType" label={t('txn.col.type')}
                       rules={[{ required: true, message: t('txn.form.required') }]}>
              <Select options={TXN_TYPES.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="goldTypeCode" label={t('txn.col.gold')}
                       rules={[{ required: true, message: t('txn.form.required') }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={goldTypes.map((g) => ({ value: g.code, label: goldName(g) }))}
              />
            </Form.Item>
          </Col>
          <Col xs={24} sm={6}>
            <Form.Item label={t('txn.col.uom')}>
              {/* Not a field. The unit belongs to the gold type. */}
              <Input value={uom} disabled />
            </Form.Item>
          </Col>
          </Row>

        {/* The bag and the measured content are two different things (H4):
            the first is a choice of two, the second a number nobody has for
            most rows. Both only make sense for scrap. */}
        {isScrap && (
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item name="scrapDetail" label={t('txn.form.band')} preserve={false}
                         extra={t('txn.form.scrapHint')}>
                <Select allowClear
                        options={SCRAP_BANDS.map((b) => ({ value: b, label: b }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="goldPct" label={t('txn.col.purity')} preserve={false}
                         rules={[{ type: 'number', min: 0, max: 1, message: t('txn.col.purity') }]}>
                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.0001}
                             controls={false} placeholder="0.7351" />
              </Form.Item>
            </Col>
          </Row>
        )}
        </section>

        <section className={styles.section} aria-labelledby="txn-money-heading">
          <h3 id="txn-money-heading" className={styles.sectionHeading}>{t('txn.form.money')}</h3>
          <span className={styles.sectionDescription}>{t('txn.hint')}</span>
          <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="qty" label={t('txn.col.qty')}
                       rules={[
                         { required: true, message: t('txn.form.required') },
                         () => ({
                           validator: (_, value) => (Number(value) === 0
                             ? Promise.reject(new Error(t('txn.form.qtyZero')))
                             : Promise.resolve()),
                         }),
                       ]}>
              <InputNumber style={{ width: '100%' }} step={0.01} precision={2}
                           controls={false} onChange={qtyTyped} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="unitPrice" label={t('txn.col.price')}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false}
                           onChange={priceTyped} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="total" label={t('txn.form.total')} extra={t('txn.form.totalHint')}>
              <InputNumber style={{ width: '100%' }} min={0} step={1} controls={false}
                           onChange={totalTyped} />
            </Form.Item>
          </Col>
          </Row>

          <div className={styles.calculatedAmount} aria-live="polite">
            <span>{t('txn.form.amountAuto')}</span>
            <strong>{t('txn.col.amount')}: {money.format(signed)}</strong>
          </div>
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
                  // Naming a customer we know brings their number up rather
                  // than making somebody go and look it up.
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

        <section className={styles.section} aria-labelledby="txn-settle-heading">
          <h3 id="txn-settle-heading" className={styles.sectionHeading}>{t('txn.form.settle')}</h3>
          <Form.List
          name="payments"
          rules={[{
            // The books refuse a purchase or a deposit with no payment on it
            // ("produced no journal lines"). Said here, before it gets that far.
            validator: async (_, payments: PaymentField[] | undefined) => {
              if (!NEEDS_PAYMENT.has(form.getFieldValue('txnType'))) return
              const complete = (payments ?? []).some((p) => Number(p?.amount ?? 0) > 0 && p?.method)
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
                      <InputNumber style={{ width: '100%' }} min={0} step={0.01}
                                   controls={false} />
                    </Form.Item>
                  </Col>
                  <Col xs={16} sm={10}>
                    <Form.Item
                      name={[field.name, 'method']}
                      label={t('txn.col.method')}
                      dependencies={[['payments', field.name, 'amount']]}
                      rules={[({ getFieldValue }) => ({
                        // An amount with no method used to be dropped on save,
                        // so the money typed simply was not there afterwards.
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
              {/* Half in cash, half by transfer and the rest by check is an
                  ordinary morning at this counter (B11). */}
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
