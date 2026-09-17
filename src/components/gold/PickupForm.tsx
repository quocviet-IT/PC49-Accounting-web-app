'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useRef, useState } from 'react'
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Typography,
} from 'antd'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { savePickup } from '@/app/(app)/gold-transactions/actions'
import { money, weight } from '@/components/ledger/Ledger'
import { describeRefusal } from './receiptErrors'
import { leftToPay } from './pickup'
import { MAX_PAYMENTS, PAYMENT_METHODS, type ReceiptRow } from './types'
import styles from './Txn.module.css'

type PaymentField = { amount: number | null; method: string | null }
type Values = { pickupDate: string; orderValue: number | null; payments: PaymentField[]; remarks: string }

/** One figure of the order, its name above it. */
function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div><Typography.Text strong>{value}</Typography.Text></div>
      {note && <Typography.Text type="secondary">{note}</Typography.Text>}
    </div>
  )
}

/**
 * The customer comes back for a deposit's gold (spec 2026-09-17, 0087).
 *
 * Everything about the order comes from the deposit — customer, gold,
 * quantity, agreed price, what was put down — so all that is typed is the day
 * and what was handed over. Less than is left is recorded as owed, and paid
 * later from the ledger like any sale.
 */
export function PickupForm({ row, today, goldName, onClose, onDone }: {
  /** The deposit being collected. */
  row: ReceiptRow
  today: string
  goldName: (code: string) => string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /** One pickup on this form is one pickup, however often Save is pressed. */
  const requestKey = useRef<string>(crypto.randomUUID())

  const info = row.deposit!
  const line = row.lines[0]
  const known = info.orderValue !== null
  const typedValue = Form.useWatch('orderValue', form) as number | null | undefined
  const payments = (Form.useWatch('payments', form) ?? []) as (PaymentField | undefined)[]
  const left = leftToPay({ orderValue: known ? info.orderValue : (typedValue ?? null), paid: info.paid })
  const paying = payments.reduce((sum, p) => sum + Number(p?.amount ?? 0), 0)
  const gap = left === null ? 0 : Math.round((paying - left) * 100) / 100

  async function save() {
    setError(null)
    let v: Values
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    const result = await settleAction(() => savePickup({
      requestKey: requestKey.current,
      key: row.key,
      pickupDate: v.pickupDate,
      orderValue: known ? null : Number(v.orderValue ?? 0),
      payments: (v.payments ?? [])
        .map((p) => ({ amount: Number(p?.amount ?? 0), method: String(p?.method ?? '') }))
        .filter((p) => p.amount > 0 && p.method),
      remarks: v.remarks?.trim() || null,
    }))
    setSaving(false)
    if (!result.ok) {
      setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      return
    }
    onDone(t('pickup.saved').replace('{0}', result.docNo ?? ''))
  }

  return (
    <Modal
      open
      width={680}
      title={t('pickup.title').replace('{0}', row.doc_no ?? '—')}
      onCancel={onClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>{t('txn.form.close')}</Button>,
        <Button key="save" type="primary" icon={<Check size={16} aria-hidden />} loading={saving}
                onClick={save}>
          {t('txn.save')}
        </Button>,
      ]}
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}

      <Typography.Paragraph>
        {row.partner_code ?? '—'} · {line ? `${goldName(line.gold_type_code)} ${weight.format(Math.abs(line.qty))} ${line.uom}` : ''}
      </Typography.Paragraph>
      <Space size={32} wrap style={{ marginBottom: 16 }}>
        <Figure label={t('pickup.orderValue')} value={known ? money.format(info.orderValue!) : '—'} />
        <Figure label={t('pickup.deposited')} value={money.format(info.paid)} note={row.txn_date} />
        <Figure label={t('pickup.left')} value={left === null ? '—' : money.format(left)} />
      </Space>

      <Form<Values>
        form={form}
        layout="vertical"
        initialValues={{
          pickupDate: today < row.txn_date ? row.txn_date : today,
          orderValue: null,
          payments: [{ amount: left, method: 'CASH' }],
          remarks: '',
        }}
      >
        <Row gutter={12}>
          <Col xs={24} sm={12}>
            <Form.Item name="pickupDate" label={t('pickup.date')}
                       rules={[{ required: true, message: t('txn.form.required') }]}>
              <Input type="date" min={row.txn_date} />
            </Form.Item>
          </Col>
          {!known && (
            <Col xs={24} sm={12}>
              <Form.Item name="orderValue" label={t('pickup.orderValue')} extra={t('pickup.orderValueHint')}
                         rules={[{ required: true, message: t('txn.form.required') }]}>
                <InputNumber style={{ width: '100%' }} min={0.01} step={0.01} controls={false} />
              </Form.Item>
            </Col>
          )}
        </Row>

        <section className={styles.section} aria-labelledby="pickup-pay-heading">
          <h3 id="pickup-pay-heading" className={styles.sectionHeading}>{t('pickup.payments')}</h3>
          <Form.List name="payments">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row gutter={12} key={field.key} align="middle">
                    <Col xs={24} sm={10}>
                      <Form.Item name={[field.name, 'amount']} label={t('txn.form.payAmount')}>
                        <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
                      </Form.Item>
                    </Col>
                    <Col xs={16} sm={10}>
                      <Form.Item name={[field.name, 'method']} label={t('txn.col.method')}>
                        <Select allowClear options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
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
                {fields.length < MAX_PAYMENTS && (
                  <Button type="dashed" block icon={<Plus size={16} aria-hidden />}
                          onClick={() => add({ amount: null, method: null })}>
                    {t('txn.form.addPayment')}
                  </Button>
                )}
              </>
            )}
          </Form.List>
          {left !== null && Math.abs(gap) >= 0.005 && (
            <Alert type="warning" showIcon role="status" style={{ marginTop: 12 }}
                   title={gap > 0
                     ? t('receipt.gap.over').replace('{0}', money.format(gap))
                     : t('receipt.gap.under').replace('{0}', money.format(-gap))} />
          )}
        </section>

        <Form.Item name="remarks" label={t('txn.col.remarks')} style={{ marginTop: 16 }}>
          <Input maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
