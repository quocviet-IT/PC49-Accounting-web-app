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
  amountOf, MAX_PAYMENTS, MAX_SALES_PEOPLE, PAYMENT_METHODS, TXN_TYPES,
  type GoldTypeOption, type SavedRow,
} from './types'

const money = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

type PaymentField = { amount: number | null; method: string | null }
type ShareField = { code: string | null; sharePct: number | null }

type Values = {
  txnType: string
  goldTypeCode: string
  qty: number | null
  unitPrice: number | null
  scrapDetail: string
  goldPct: number | null
  partnerCode: string
  partnerPhone: string
  remarks: string
  salesPeople: ShareField[]
  payments: PaymentField[]
  reason: string
}

/**
 * One transaction, entered on a form rather than typed across a row.
 *
 * The grid this replaces put every field of every draft on screen at once, so
 * the fields were as wide as the column they lived in and the row scrolled
 * sideways past the end of the screen. A purchase has eleven things to say
 * about it and the accountant is entering one purchase at a time; a form is
 * the shape that fits.
 *
 * Correcting reuses this form rather than a second one. A correction IS a
 * transaction — the same eleven fields, plus the reason and a destination that
 * reverses the original in the same database transaction. Nothing is written
 * when the form opens: the original stays live and posted until this is saved,
 * so closing the tab half way through leaves the books as they were.
 */
export function TxnForm({
  open, onClose, onSaved, txnDate, goldTypes, salesPeople, partners, correcting,
}: {
  open: boolean
  onClose: () => void
  onSaved: () => void
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
  const [saving, setSaving] = useState(false)

  /**
   * Stable for the life of this form, so pressing Save twice — or trying again
   * after an answer went missing on the way back — is recognised as the same
   * intention rather than as a second purchase.
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
        scrapDetail: correcting.scrap_detail ?? '',
        goldPct: correcting.gold_pct,
        partnerCode: correcting.partner_code ?? '',
        partnerPhone: phoneOf(correcting.partner_code ?? ''),
        remarks: correcting.remarks ?? '',
        salesPeople: correcting.soldBy.length
          ? correcting.soldBy.map((p) => ({ code: p.code, sharePct: p.sharePct }))
          : [{ code: null, sharePct: 100 }],
        payments: correcting.payments.length
          ? correcting.payments.map((p) => ({ amount: p.amount, method: p.method }))
          : [{ amount: null, method: 'CASH' }],
        reason: '',
      }
    : {
        txnType: 'PO',
        goldTypeCode: '',
        qty: null,
        unitPrice: null,
        scrapDetail: '',
        goldPct: null,
        partnerCode: '',
        partnerPhone: '',
        remarks: '',
        salesPeople: [{ code: null, sharePct: 100 }],
        payments: [{ amount: null, method: 'CASH' }],
        reason: '',
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [correcting])

  const goldTypeCode = Form.useWatch('goldTypeCode', form)
  const qty = Form.useWatch('qty', form)
  const unitPrice = Form.useWatch('unitPrice', form)
  const shares = Form.useWatch('salesPeople', form)

  const uom = uomOf(goldTypeCode ?? '')
  const amount = amountOf(Number(qty ?? 0), unitPrice ?? null)

  /** Only shown once a second person is on the order — see the note on submit. */
  const manyPeople = (shares ?? []).filter((p) => p?.code).length > 1

  async function submit() {
    setError(null)
    setWarning(null)
    const v = await form.validateFields()

    const named = (v.salesPeople ?? []).filter((p) => p?.code)
    // One person holds the whole order without having to type a hundred; two
    // or more have to say how it divides, because nothing else can know. The
    // database refuses a split that does not come to 100 too — this is here so
    // the reason is read beside the field rather than as a Postgres message.
    const soldBy = named.length === 1
      ? [{ code: String(named[0].code), sharePct: 100 }]
      : named.map((p) => ({ code: String(p.code), sharePct: Number(p.sharePct ?? 0) }))
    if (soldBy.length > 1) {
      const total = Math.round(soldBy.reduce((s, p) => s + p.sharePct, 0) * 100) / 100
      if (soldBy.some((p) => !(p.sharePct > 0)) || total !== 100) {
        setError(`${t('txn.shareTotal')} ${total}%`)
        return
      }
    }

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
      salesPeople: soldBy,
      scrapDetail: v.scrapDetail?.trim() || null,
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
    // may not be, and that is a different sentence: it is shown against a
    // transaction that saved, never as a failure to save.
    if (result.warning) { setWarning(result.warning); return }
    onSaved()
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
        <Button key="save" type="primary" loading={saving} onClick={submit}>
          {t('txn.save')}
        </Button>,
      ]}
    >
      <Form<Values> form={form} layout="vertical" initialValues={initial} preserve={false}>
        {correcting && (
          <>
            <Form.Item
              name="reason"
              label={t('txn.form.reason')}
              extra={t('txn.form.reasonHint')}
              rules={[{ required: true, min: 3, message: t('txn.form.required') }]}
            >
              <Input placeholder={t('txn.correctReason')} />
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
              {/* Not a field. The unit belongs to the gold type — luong for
                  9999, ounce for Maple Leaf, gram for scrap — so choosing it
                  separately is only an opportunity to disagree with it. */}
              <Input value={uom} disabled />
            </Form.Item>
          </Col>
        </Row>

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
              <InputNumber style={{ width: '100%' }} step={0.01} controls={false} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="unitPrice" label={t('txn.col.price')}>
              <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item label={t('txn.col.amount')} extra={t('txn.form.amountAuto')}>
              <Input readOnly value={money.format(amount)} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="scrapDetail" label={t('txn.form.scrapDetail')}
                       extra={t('txn.form.scrapHint')}>
              <Input placeholder="10-18k/grs" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="goldPct" label={t('txn.col.purity')}
                       rules={[{ type: 'number', min: 0, max: 1,
                                 message: t('txn.col.purity') }]}>
              <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.0001}
                           controls={false} placeholder="0.7351" />
            </Form.Item>
          </Col>
        </Row>

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

        <Form.List name="salesPeople">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Row gutter={12} key={field.key} align="middle">
                  <Col xs={24} sm={manyPeople ? 12 : 20}>
                    <Form.Item name={[field.name, 'code']} label={t('txn.col.sales')}>
                      <Select allowClear showSearch
                              options={salesPeople.map((c) => ({ value: c, label: c }))} />
                    </Form.Item>
                  </Col>
                  {/* The percent stays out of the way while one person has the
                      order — the single line is the whole of it — and appears
                      the moment a second name arrives. Two people on an order
                      did not necessarily do half each, and a system that
                      assumes they did pays the wrong commission quietly. */}
                  {manyPeople && (
                    <Col xs={16} sm={8}>
                      <Form.Item name={[field.name, 'sharePct']} label={t('txn.col.share')}>
                        <InputNumber style={{ width: '100%' }} min={0} max={100}
                                     step={1} controls={false} suffix="%" />
                      </Form.Item>
                    </Col>
                  )}
                  <Col xs={8} sm={4}>
                    <Button type="text" danger icon={<DeleteOutlined />}
                            aria-label={t('txn.form.remove')}
                            disabled={fields.length === 1}
                            onClick={() => remove(field.name)} />
                  </Col>
                </Row>
              ))}
              {fields.length < MAX_SALES_PEOPLE && (
                <Button type="dashed" block icon={<PlusOutlined />}
                        onClick={() => add({ code: null, sharePct: null })}>
                  {t('txn.form.addPerson')}
                </Button>
              )}
            </>
          )}
        </Form.List>

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
                  ordinary morning at this counter. */}
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
          <Alert type="error" showIcon message={t('txn.rowError')} description={error}
                 style={{ marginTop: 8 }} />
        )}
        {warning && (
          <Alert
            type="warning" showIcon
            message={t('txn.savedWithWarning')} description={warning}
            style={{ marginTop: 8 }}
            action={<Button size="small" onClick={onSaved}>{t('txn.form.close')}</Button>}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {t('txn.date')}: {txnDate}
        </Typography.Paragraph>
      </Form>
    </Modal>
  )
}
