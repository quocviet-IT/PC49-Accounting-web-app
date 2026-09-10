'use client'

import { useEffect, useState } from 'react'
import { Alert, Form, Input, InputNumber, Modal, Select, Table, Typography } from 'antd'
import { useLocale } from '@/lib/i18n/provider'
import { weight } from '@/components/ledger/Ledger'
import {
  addBag, recordAssay, recordReceipt, sendLot, spotOn, updateBag, type Result,
} from '@/app/(app)/refining/actions'
import type { Bag, GoldOption, OwnerShare } from './types'

const today = () => new Date().toISOString().slice(0, 10)

type Done = (result: Result) => void

/** A date, and that day's spot per ounce for gold and platinum, prefilled. */
function useSpot(date: string | undefined) {
  const [spot, setSpot] = useState<{ GOLD: number | null; PLATINUM: number | null } | null>(null)
  useEffect(() => {
    let live = true
    if (!date) return
    spotOn(date).then((s) => { if (live) setSpot(s) })
    return () => { live = false }
  }, [date])
  return spot
}

// ------------------------------------------------------------------ send

export function SendDialog({ open, lotId, onClose, onDone }: {
  open: boolean; lotId: string; onClose: () => void; onDone: Done
}) {
  const { t } = useLocale()
  const [form] = Form.useForm<{ date: string; spotGold: number | null; spotPt: number | null }>()
  const date = Form.useWatch('date', form)
  const spot = useSpot(date)
  const [saving, setSaving] = useState(false)

  // The day's figures from the price table, offered before they are confirmed.
  useEffect(() => {
    if (!spot) return
    if (form.getFieldValue('spotGold') == null) form.setFieldValue('spotGold', spot.GOLD)
    if (form.getFieldValue('spotPt') == null) form.setFieldValue('spotPt', spot.PLATINUM)
  }, [spot, form])

  async function submit() {
    const v = await form.validateFields()
    setSaving(true)
    const r = await sendLot({ lotId, date: v.date, spotGoldPerOz: v.spotGold, spotPtPerOz: v.spotPt })
    setSaving(false)
    onDone(r)
  }

  return (
    <Modal open={open} title={t('refining.send.title')} onCancel={onClose} onOk={submit}
           okText={t('refining.send.confirm')} okButtonProps={{ loading: saving, danger: true }}
           cancelText={t('refining.cancel')} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={{ date: today(), spotGold: null, spotPt: null }}>
        <Form.Item name="date" label={t('refining.onDate')} rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        {spot && spot.GOLD === null && spot.PLATINUM === null && (
          <Alert type="warning" showIcon title={t('refining.send.noSpot')} style={{ marginBottom: 12 }} />
        )}
        <Form.Item name="spotGold" label={`${t('refining.spot')} — Gold`} extra={t('refining.send.spotAuto')}>
          <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
        </Form.Item>
        <Form.Item name="spotPt" label={`${t('refining.spot')} — PT`}>
          <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// ----------------------------------------------------------------- assay

type AssayRow = { lineId: string; seq: number; label: string; sent: number | null; assayWeightGram: number | null; assayPct: number | null }

export function AssayDialog({ open, lotId, bags, onClose, onDone }: {
  open: boolean; lotId: string; bags: Bag[]; onClose: () => void; onDone: Done
}) {
  const { t } = useLocale()
  const [form] = Form.useForm<{ date: string; spotGold: number | null; spotPt: number | null; rows: AssayRow[] }>()
  const date = Form.useWatch('date', form)
  const spot = useSpot(date)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!spot) return
    if (form.getFieldValue('spotGold') == null) form.setFieldValue('spotGold', spot.GOLD)
    if (form.getFieldValue('spotPt') == null) form.setFieldValue('spotPt', spot.PLATINUM)
  }, [spot, form])

  const initialRows: AssayRow[] = bags.map((b) => ({
    lineId: b.id, seq: b.seq,
    label: `${b.metal === 'PLATINUM' ? 'PT' : 'Gold'} · ${b.ownerCode} · ${b.sourceDesc ?? ''}`,
    sent: b.grossWeightGram,
    assayWeightGram: b.assayWeightGram ?? b.grossWeightGram,
    assayPct: b.assayPct ?? b.goldPct,
  }))

  async function submit() {
    const v = await form.validateFields()
    setSaving(true)
    const r = await recordAssay({
      lotId, date: v.date, spotGoldPerOz: v.spotGold, spotPtPerOz: v.spotPt,
      lines: (v.rows ?? []).map((x) => ({
        lineId: x.lineId, assayWeightGram: Number(x.assayWeightGram), assayPct: Number(x.assayPct),
      })),
    })
    setSaving(false)
    onDone(r)
  }

  return (
    <Modal open={open} width={760} title={t('refining.assay.title')} onCancel={onClose} onOk={submit}
           okText={t('refining.save')} okButtonProps={{ loading: saving }}
           cancelText={t('refining.cancel')} destroyOnHidden>
      <Typography.Paragraph type="secondary">{t('refining.assay.hint')}</Typography.Paragraph>
      <Form form={form} layout="vertical"
            initialValues={{ date: today(), spotGold: null, spotPt: null, rows: initialRows }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Form.Item name="date" label={t('refining.assayed')} rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="spotGold" label={`${t('refining.bag.spotAssay')} — Gold`}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
          </Form.Item>
          <Form.Item name="spotPt" label={`${t('refining.bag.spotAssay')} — PT`}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
          </Form.Item>
        </div>
        <Form.List name="rows">
          {(fields) => (
            <Table<AssayRow>
              size="small" pagination={false} rowKey="lineId"
              dataSource={fields.map((f) => form.getFieldValue(['rows', f.name]))}
              columns={[
                { title: t('refining.bag.no'), dataIndex: 'seq', width: 48 },
                { title: t('refining.bag.desc'), dataIndex: 'label', ellipsis: true },
                { title: t('refining.bag.gross'), dataIndex: 'sent', width: 100, align: 'right',
                  render: (v: number | null) => (v === null ? '—' : weight.format(v)) },
                { title: t('refining.bag.assayGram'), key: 'w', width: 140,
                  render: (_, __, i) => (
                    <Form.Item name={[i, 'assayWeightGram']} noStyle rules={[{ required: true }]}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
                    </Form.Item>) },
                { title: t('refining.bag.assayPct'), key: 'p', width: 140,
                  render: (_, __, i) => (
                    <Form.Item name={[i, 'assayPct']} noStyle rules={[{ required: true }]}>
                      <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.0001} controls={false} />
                    </Form.Item>) },
              ]}
            />
          )}
        </Form.List>
      </Form>
    </Modal>
  )
}

// ---------------------------------------------------------------- settle

export function SettleDialog({ open, lotId, share, onClose, onDone }: {
  open: boolean; lotId: string; share: OwnerShare | null; onClose: () => void; onDone: Done
}) {
  const { t } = useLocale()
  const [form] = Form.useForm<{ date: string; kind: 'METAL' | 'CASH'; qty: number | null; amount: number | null }>()
  const kind = Form.useWatch('kind', form)
  const [saving, setSaving] = useState(false)
  const owed = share ? Math.max(0, share.assayWeightGram - share.receivedGram) : 0

  async function submit() {
    if (!share) return
    const v = await form.validateFields()
    setSaving(true)
    const r = await recordReceipt({
      lotId, ownerCode: share.ownerCode, date: v.date, settleKind: v.kind,
      qtyGram: v.kind === 'METAL' ? Number(v.qty) : null,
      amountUsd: v.kind === 'CASH' ? Number(v.amount) : null,
    })
    setSaving(false)
    onDone(r)
  }

  return (
    <Modal open={open} title={`${t('refining.settle.title')} · ${share?.ownerCode ?? ''}`}
           onCancel={onClose} onOk={submit} okText={t('refining.save')}
           okButtonProps={{ loading: saving }} cancelText={t('refining.cancel')} destroyOnHidden>
      <Typography.Paragraph type="secondary">{t('refining.settle.hint')}</Typography.Paragraph>
      <Form form={form} layout="vertical"
            initialValues={{ date: today(), kind: 'METAL', qty: owed > 0 ? owed : null, amount: null }}>
        <Form.Item name="date" label={t('refining.receivedOn')} rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="kind" label={t('refining.settleKind')}>
          <Select options={[
            { value: 'METAL', label: t('refining.takeMetal') },
            { value: 'CASH', label: t('refining.takeCash') },
          ]} />
        </Form.Item>
        {/* Only one figure is ever on screen: a settlement half metal and
            half money is not a thing the books can hold. */}
        {kind === 'CASH' ? (
          <Form.Item name="amount" label={t('txn.form.payAmount')} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
          </Form.Item>
        ) : (
          <Form.Item name="qty" label={`${t('refining.receivedGram')} (Grain)`} rules={[{ required: true }]}
                     extra={owed > 0 ? `${t('refining.owed')}: ${weight.format(owed)} g` : undefined}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

// ------------------------------------------------------------------- bag

export function BagDialog({ open, lotId, bag, goldTypes, onClose, onDone }: {
  open: boolean; lotId: string; bag: Bag | null; goldTypes: GoldOption[]; onClose: () => void; onDone: Done
}) {
  const { locale, t } = useLocale()
  const [form] = Form.useForm<{ owner: string; goldType: string; desc: string; gross: number | null; pct: number | null }>()
  const [saving, setSaving] = useState(false)

  async function submit() {
    const v = await form.validateFields()
    setSaving(true)
    const r = bag
      ? await updateBag({ lotId, lineId: bag.id, grossWeightGram: Number(v.gross),
                          goldPct: v.pct ?? null, sourceDesc: v.desc || null })
      : await addBag({ lotId, ownerCode: v.owner, goldTypeCode: v.goldType, sourceDesc: v.desc || null,
                       grossWeightGram: Number(v.gross), goldPct: v.pct ?? null })
    setSaving(false)
    onDone(r)
  }

  return (
    <Modal open={open} title={bag ? t('refining.bag.edit') : t('refining.addBag')}
           onCancel={onClose} onOk={submit} okText={t('refining.save')}
           okButtonProps={{ loading: saving }} cancelText={t('refining.cancel')} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        {bag ? t('refining.bag.editHint') : t('refining.addBagHint')}
      </Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{
        owner: bag?.ownerCode ?? 'PC49',
        goldType: bag?.goldTypeCode ?? 'SG',
        desc: bag?.sourceDesc ?? '',
        gross: bag?.grossWeightGram ?? null,
        pct: bag?.goldPct ?? null,
      }}>
        {!bag && (
          <>
            <Form.Item name="owner" label={t('refining.owner')} rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="goldType" label={t('inv.goldType')} rules={[{ required: true }]}>
              <Select options={goldTypes.map((g) => ({ value: g.code, label: locale === 'vi' ? g.nameVi : g.nameEn }))} />
            </Form.Item>
          </>
        )}
        <Form.Item name="desc" label={t('refining.bag.desc')}>
          <Input placeholder="10-18k/grs · 18CS · SCRAP 706.4GR 73.51%" />
        </Form.Item>
        <Form.Item name="gross" label={t('refining.gross')} rules={[{ required: true }]}>
          <InputNumber style={{ width: '100%' }} min={0} step={0.01} controls={false} />
        </Form.Item>
        <Form.Item name="pct" label={t('refining.purity')}>
          <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.0001} controls={false} placeholder="0.7351" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
