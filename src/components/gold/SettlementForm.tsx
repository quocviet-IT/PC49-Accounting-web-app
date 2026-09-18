'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useRef, useState, type CSSProperties } from 'react'
import {
  Alert, Button, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Typography,
} from 'antd'
import { Ban, Check } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { saveSettlement, voidSettlement } from '@/app/(app)/gold-transactions/actions'
import { IconAction } from '@/components/ui/IconAction'
import { money } from '@/components/ledger/Ledger'
import { describeRefusal } from './receiptErrors'
import { owes, paidSoFar } from './settlement'
import { leftToPay } from './pickup'
import { PAYMENT_METHODS, type ReceiptRow, type Settlement } from './types'
import styles from './Txn.module.css'

type Values = { payDate: string; amount: number | null; method: string; note: string }

const LIST: CSSProperties = { listStyle: 'none', margin: '0 0 16px', padding: 0 }

/** One figure of the receipt, its name above it. */
function Figure({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <div><Typography.Text strong type={danger ? 'danger' : undefined}>{value}</Typography.Text></div>
    </div>
  )
}

/**
 * Paying the rest of a receipt later: "đợt sau thanh toán tiếp" (17-09).
 *
 * What the receipt came to, what was paid at the counter and since, and what
 * is still owed. A later payment typed in error is cancelled here, with a
 * reason; while anything is owed another is recorded, on the day it was made.
 * Each goes to the books on its own (0083): the receipt is not touched.
 */
export function SettlementForm({ row, today, onClose, onDone }: {
  row: ReceiptRow
  /** The server's date: a payment is made today unless said otherwise. */
  today: string
  onClose: () => void
  /** Something was written; the sentence says what. */
  onDone: (message: string) => void
}) {
  const { t } = useLocale()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [cancelling, setCancelling] = useState<Settlement | null>(null)
  const [reason, setReason] = useState('')
  /** Pressing Save twice, or again after a lost answer, is still one payment. */
  const requestKey = useRef<string>(crypto.randomUUID())

  // On a deposit this is money added before the gold is collected (0089): what
  // is left is the order less what was put down, and nothing is owed as such.
  const deposit = row.txn_type === 'DEPOSIT' ? row.deposit ?? null : null
  const open = deposit?.role === 'deposit' && !deposit.settledBy
  const left = open && deposit ? leftToPay(deposit) : 0
  const owed = deposit ? (left ?? 0) : (row.owed ?? 0)
  const later = row.settlements ?? []
  const canPay = deposit ? open && (left === null || left >= 0.005) : owes(row)
  const doc = row.doc_no ?? '—'

  const refused = (result: { ok: false; message: string }) =>
    setError(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))

  async function save() {
    setError(null)
    let v: Values
    try {
      v = await form.validateFields()
    } catch {
      return
    }
    setSaving(true)
    const result = await settleAction(() => saveSettlement({
      requestKey: requestKey.current,
      key: row.key,
      payDate: v.payDate,
      amount: Number(v.amount ?? 0),
      method: v.method,
      note: v.note?.trim() || null,
    }))
    setSaving(false)
    if (!result.ok) {
      refused(result)
      return
    }
    onDone(t(deposit ? 'settle.depositSaved' : 'settle.saved').replace('{0}', doc))
  }

  async function cancel() {
    if (!cancelling) return
    setError(null)
    setSaving(true)
    const result = await settleAction(() => voidSettlement({ id: cancelling.id, reason }))
    setSaving(false)
    if (!result.ok) {
      refused(result)
      return
    }
    onDone(t('settle.voided'))
  }

  return (
    <Modal
      open
      width={640}
      title={t(deposit ? 'settle.depositTitle' : 'settle.title').replace('{0}', doc)}
      onCancel={onClose}
      mask={{ closable: false }}
      destroyOnHidden
      footer={[
        <Button key="close" onClick={onClose}>{t('txn.form.close')}</Button>,
        canPay && (
          <Button key="save" type="primary" icon={<Check size={16} aria-hidden />} loading={saving}
                  onClick={save}>
            {t('settle.save')}
          </Button>
        ),
      ]}
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}

      <Space size={32} wrap style={{ marginBottom: 16 }}>
        {deposit
          ? <>
              <Figure label={t('pickup.orderValue')}
                      value={deposit.orderValue === null ? '—' : money.format(deposit.orderValue)} />
              <Figure label={t('pickup.deposited')} value={money.format(paidSoFar(row))} />
              <Figure label={t('pickup.left')} value={left === null ? '—' : money.format(left)} />
            </>
          : <>
              <Figure label={t('settle.receiptTotal')} value={money.format(Math.abs(row.amount))} />
              <Figure label={t('settle.paid')} value={money.format(paidSoFar(row))} />
              <Figure label={t('settle.owed')} value={money.format(owed)} danger={canPay} />
            </>}
      </Space>

      <h3 className={styles.sectionHeading}>{t(deposit ? 'settle.depositAtCounter' : 'settle.atCounter')}</h3>
      {row.payments.length === 0
        ? <Typography.Paragraph type="secondary">{t('settle.noneAtCounter')}</Typography.Paragraph>
        : (
          <ul style={LIST}>
            {row.payments.map((p) => (
              <li key={p.seq}>{row.txn_date} · {money.format(p.amount)} {p.method}</li>
            ))}
          </ul>
        )}

      <h3 className={styles.sectionHeading}>{t(deposit ? 'settle.depositLater' : 'settle.later')}</h3>
      {later.length === 0
        ? <Typography.Paragraph type="secondary">{t('settle.noneLater')}</Typography.Paragraph>
        : (
          <ul style={LIST}>
            {later.map((s) => (
              <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>
                  {s.payDate} · {money.format(s.amount)} {s.method}{s.note ? ` · ${s.note}` : ''}
                </span>
                <IconAction icon={<Ban size={16} aria-hidden />} label={t('settle.void')} danger
                            onClick={() => { setCancelling(s); setReason('') }} />
              </li>
            ))}
          </ul>
        )}

      {cancelling && (
        <div role="group" aria-label={t('settle.void')} style={{ marginBottom: 16 }}>
          <Typography.Paragraph>
            {cancelling.payDate} · {money.format(cancelling.amount)} {cancelling.method}
          </Typography.Paragraph>
          <Space.Compact style={{ width: '100%' }}>
            <Input autoFocus value={reason} aria-label={t('settle.voidWhy')}
                   placeholder={t('settle.voidWhy')} onChange={(e) => setReason(e.target.value)} />
            <Button danger loading={saving} disabled={reason.trim().length < 3} onClick={cancel}>
              {t('settle.voidConfirm')}
            </Button>
          </Space.Compact>
        </div>
      )}

      {canPay
        ? (
          <section aria-labelledby="settle-new-heading">
            <h3 id="settle-new-heading" className={styles.sectionHeading}>
              {t(deposit ? 'settle.depositNew' : 'settle.new')}
            </h3>
            <Form<Values>
              form={form}
              layout="vertical"
              initialValues={{
                payDate: today < row.txn_date ? row.txn_date : today,
                amount: deposit && left === null ? null : owed,
                method: 'CASH',
                note: '',
              }}
            >
              <Row gutter={12}>
                <Col xs={24} sm={8}>
                  <Form.Item name="payDate" label={t('settle.payDate')}
                             rules={[{ required: true, message: t('txn.form.required') }]}>
                    <Input type="date" min={row.txn_date} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8}>
                  {/* Not capped at what is owed: typing more is refused with the figures. */}
                  <Form.Item name="amount" label={t('settle.amount')}
                             rules={[{ required: true, message: t('txn.form.required') }]}>
                    <InputNumber style={{ width: '100%' }} min={0.01} step={0.01} controls={false} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={8}>
                  <Form.Item name="method" label={t('txn.col.method')}
                             rules={[{ required: true, message: t('txn.form.required') }]}>
                    <Select options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="note" label={t('settle.note')}>
                <Input maxLength={500} />
              </Form.Item>
            </Form>
          </section>
        )
        : <Alert type="success" showIcon
                 title={deposit?.settledBy
                   ? t('pickup.done').replace('{0}', deposit.pickupDate ?? '')
                   : t('settle.paidUp')} />}
    </Modal>
  )
}
