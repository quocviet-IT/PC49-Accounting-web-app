'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Alert, AutoComplete, Button, Col, Divider, Form, Input, InputNumber, Modal,
  Row, Select, Typography,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
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

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

type PaymentField = { amount: number | null; method: string | null }

type Values = {
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

  const initial: Values = useMemo(() => (correcting
    ? {
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
    const v = await form.validateFields()

    const payments = (v.payments ?? [])
      .map((p) => ({ amount: Number(p?.amount ?? 0), method: String(p?.method ?? '') }))
      .filter((p) => p.amount > 0 && p.method)

    const body = {
      requestKey: requestKey.current,
      txnDate,
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

    if (!result.ok) { setError(result.message); return }
    // The money is on the books. Something beside it — filing the customer —
    // may not be, and that is a different sentence: shown against a
    // transaction that saved, never as a failure to save.
    if (result.warning) { setWarning(result.warning) }

    if (stayOpen && !correcting) {
      // The next transaction on the same day: same date, everything else
      // fresh, and a fresh key so it cannot be mistaken for a retry of this one.
      requestKey.current = crypto.randomUUID()
      form.resetFields()
      setLastSaved(result.docNo)
      onSaved(result.docNo, true)
      return
    }
    onSaved(result.docNo, false)
  }

  return (
    <Modal
      open={open}
      width={820}
      title={t(correcting ? 'txn.form.correctTitle' : 'txn.form.newTitle')}
      onCancel={onClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>{t('txn.form.close')}</Button>,
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
      <Form<Values> form={form} layout="vertical" initialValues={initial} preserve={false}>
        {lastSaved && (
          <Alert type="success" showIcon style={{ marginBottom: 12 }}
                 title={`${t('txn.form.savedAs')} ${lastSaved}`} />
        )}

        {correcting && (
          <>
            <Form.Item
              name="reason"
              label={t('txn.form.reason')}
              extra={t('txn.form.reasonHint')}
              rules={[{ required: true, min: 3, message: t('txn.form.required') }]}
            >
              <Input />
            </Form.Item>
            <Divider />
          </>
        )}

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
              <Form.Item name="scrapDetail" label={t('txn.form.band')}
                         extra={t('txn.form.scrapHint')}>
                <Select allowClear
                        options={SCRAP_BANDS.map((b) => ({ value: b, label: b }))} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="goldPct" label={t('txn.col.purity')}
                         rules={[{ type: 'number', min: 0, max: 1, message: t('txn.col.purity') }]}>
                <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.0001}
                             controls={false} placeholder="0.7351" />
              </Form.Item>
            </Col>
          </Row>
        )}

        <Divider titlePlacement="start" plain>{t('txn.form.money')}</Divider>

        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="qty" label={t('txn.col.qty')}
                       extra={t('txn.hint')}
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

        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          {t('txn.col.amount')}: <strong>{money.format(signed)}</strong>
          {' · '}{t('txn.form.amountAuto')}
        </Typography.Paragraph>

        <Divider titlePlacement="start" plain>{t('txn.form.who')}</Divider>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="partnerCode" label={t('txn.col.partner')}>
              <AutoComplete
                options={partners.map((p) => ({ value: p.code }))}
                filterOption={(input, option) =>
                  String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
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

        <Divider titlePlacement="start" plain>{t('txn.form.settle')}</Divider>

        <Form.List name="payments">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Row gutter={12} key={field.key} align="middle">
                  <Col xs={24} sm={10}>
                    <Form.Item name={[field.name, 'amount']} label={t('txn.form.payAmount')}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.01}
                                   controls={false} />
                    </Form.Item>
                  </Col>
                  <Col xs={16} sm={10}>
                    <Form.Item name={[field.name, 'method']} label={t('txn.col.method')}>
                      <Select allowClear
                              options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
                    </Form.Item>
                  </Col>
                  <Col xs={8} sm={4}>
                    <Button type="text" danger icon={<DeleteOutlined />}
                            aria-label={t('txn.form.remove')}
                            disabled={fields.length === 1}
                            onClick={() => remove(field.name)} />
                  </Col>
                </Row>
              ))}
              {/* Half in cash, half by transfer and the rest by check is an
                  ordinary morning at this counter (B11). */}
              {fields.length < MAX_PAYMENTS && (
                <Button type="dashed" block icon={<PlusOutlined />}
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

        {error && (
          <Alert type="error" showIcon title={t('txn.rowError')} description={error}
                 style={{ marginTop: 8 }} />
        )}
        {warning && (
          <Alert type="warning" showIcon title={t('txn.savedWithWarning')} description={warning}
                 style={{ marginTop: 8 }} />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {t('txn.date')}: {txnDate}
        </Typography.Paragraph>
      </Form>
    </Modal>
  )
}
