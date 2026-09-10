'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Alert, Button, Descriptions, Space, Steps, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, LoadFailed, money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { closeLot, deleteBag, type Result } from '@/app/(app)/refining/actions'
import { AssayTable, SendTable } from './BagTable'
import { PurchasePicker } from './PurchasePicker'
import { AssayDialog, BagDialog, SendDialog, SettleDialog } from './LotDialogs'
import {
  LOT_STAGES, type Bag, type BandTotal, type GoldOption, type Lot, type OwnerShare,
  type Purchase, type Receipt,
} from './types'

type Dialog =
  | { kind: 'send' }
  | { kind: 'assay' }
  | { kind: 'settle'; share: OwnerShare }
  | { kind: 'bag'; bag: Bag | null }
  | null

/**
 * One lot, stage by stage.
 *
 * The sheet has the whole cycle on one row of columns and the accountant
 * fills them left to right. Here each stage shows only what it needs and the
 * one control that moves the lot on — the database refuses anything out of
 * order, so a control that would be refused is not offered.
 *
 *   DRAFT     tick purchases, make bags, weigh and X-ray them   → send
 *   SENT      the green table, priced at the send-day spot      → assay
 *   ASSAYED   the blue table beside it, and the variance        → receive
 *   RECEIVED  who has been settled, who is still owed           → close
 *   CLOSED    read only
 */
export function LotDetail({
  lot, bags, bands, available, picked, shares, receipts, goldTypes, canApprove, loadFailed = false,
}: {
  lot: Lot | null
  bags: Bag[]
  bands: BandTotal[]
  available: Purchase[]
  picked: Purchase[]
  shares: OwnerShare[]
  receipts: Receipt[]
  goldTypes: GoldOption[]
  canApprove: boolean
  loadFailed?: boolean
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loadFailed || !lot) {
    return (
      <Page titleKey="refining.title">
        <LoadFailed />
      </Page>
    )
  }

  const stage = LOT_STAGES.indexOf(lot.status)
  const houseBags = bags.filter((b) => b.ownerCode === 'PC49')
  const hasAssay = bags.some((b) => b.assayWeightGram !== null)

  function done(result: Result) {
    if (!result.ok) { setError(result.message); return }
    setError(null)
    setDialog(null)
    router.refresh()
  }

  async function removeBag(bag: Bag) {
    setBusy(true)
    const r = await deleteBag({ lotId: lot!.id, lineId: bag.id })
    setBusy(false)
    done(r)
  }

  async function close() {
    setBusy(true)
    const r = await closeLot({ lotId: lot!.id })
    setBusy(false)
    done(r)
  }

  const owedBy = (s: OwnerShare) => Math.max(0, Math.round((s.assayWeightGram - s.receivedGram) * 10000) / 10000)
  const allSettled = shares.length > 0 && shares.every((s) => owedBy(s) === 0)

  const shareColumns: ColumnsType<OwnerShare> = [
    { title: t('refining.owner'), dataIndex: 'ownerCode', width: 120,
      render: (v: string) => (v === 'PC49' ? <Tag color="gold">{v}</Tag> : <Tag>{v}</Tag>) },
    { title: t('refining.weight'), dataIndex: 'assayWeightGram', align: 'right', width: 130,
      render: (v: number) => `${weight.format(v)} g` },
    { title: t('refining.share'), dataIndex: 'sharePct', align: 'right', width: 100,
      render: (v: number) => `${v.toFixed(1)}%` },
    { title: t('refining.receivedGram'), dataIndex: 'receivedGram', align: 'right', width: 130,
      render: (v: number) => `${weight.format(v)} g` },
    { title: t('refining.owed'), key: 'owed', align: 'right', width: 130,
      render: (_, s) => (owedBy(s) > 0
        ? <span className="pc-out">{weight.format(owedBy(s))} g</span>
        : <Typography.Text type="secondary">—</Typography.Text>) },
    { title: '', key: 'act', width: 130,
      render: (_, s) => ((lot.status === 'ASSAYED' || lot.status === 'RECEIVED')
        ? <Button size="small" onClick={() => setDialog({ kind: 'settle', share: s })}>{t('refining.receive')}</Button>
        : null) },
  ]

  const receiptColumns: ColumnsType<Receipt> = [
    { title: t('refining.receiptOn'), dataIndex: 'receiveDate', width: 110 },
    { title: t('refining.owner'), dataIndex: 'ownerCode', width: 100 },
    { title: t('refining.settleKind'), dataIndex: 'settleKind', width: 110,
      render: (v: Receipt['settleKind']) => (v === 'CASH' ? t('refining.takeCash') : t('refining.takeMetal')) },
    { title: t('refining.weight'), dataIndex: 'qtyGram', align: 'right', width: 120,
      render: (v: number | null) => (v === null ? '—' : `${weight.format(v)} g`) },
    { title: t('txn.form.payAmount'), dataIndex: 'amountUsd', align: 'right',
      render: (v: number | null) => (v === null ? '—' : money.format(v)) },
  ]

  return (
    <Page
      titleKey="refining.title"
      actions={
        <Space wrap>
          <Link href="/refining">{t('refining.back')}</Link>
          {lot.status === 'DRAFT' && (
            <Button type="primary" disabled={houseBags.length === 0 || busy}
                    onClick={() => setDialog({ kind: 'send' })}>
              {t('refining.to.SENT')}
            </Button>
          )}
          {lot.status === 'SENT' && (
            <Button type="primary" disabled={busy} onClick={() => setDialog({ kind: 'assay' })}>
              {t('refining.to.ASSAYED')}
            </Button>
          )}
          {lot.status === 'RECEIVED' && (
            <Button type="primary" disabled={!allSettled || !canApprove || busy} onClick={close}
                    title={!allSettled ? t('refining.closeHint') : undefined}>
              {t('refining.close')}
            </Button>
          )}
        </Space>
      }
    >
      <Typography.Title level={3} style={{ marginTop: -8 }}>
        {lot.lotCode} <Tag>{t(`refining.status.${lot.status}` as const)}</Tag>
      </Typography.Title>

      <Steps
        current={stage}
        size="small"
        style={{ margin: '12px 0 20px' }}
        items={LOT_STAGES.map((s) => ({ title: t(`refining.step.${s}` as const) }))}
      />

      {error && <Alert type="error" showIcon closable title={error} onClose={() => setError(null)}
                       style={{ marginBottom: 16 }} />}

      <Descriptions size="small" column={4} style={{ marginBottom: 20 }} items={[
        { key: 'r', label: t('refining.refinery'), children: lot.refineryName ?? '—' },
        { key: 's', label: t('refining.sent'), children: lot.sentDate ?? '—' },
        { key: 'a', label: t('refining.assayed'), children: lot.assayDate ?? '—' },
        { key: 'v', label: t('refining.received'), children: lot.receivedDate ?? '—' },
        { key: 'sg', label: `${t('refining.spot')} Gold`, children: lot.spotGoldSent === null ? '—' : money.format(lot.spotGoldSent) },
        { key: 'sp', label: `${t('refining.spot')} PT`, children: lot.spotPtSent === null ? '—' : money.format(lot.spotPtSent) },
        { key: 'fg', label: `${t('refining.bag.fee')} Gold`, children: lot.feePctGold === null ? '—' : `${lot.feePctGold}%` },
        { key: 'fp', label: `${t('refining.bag.fee')} PT`, children: lot.feePctPt === null ? '—' : `${lot.feePctPt}%` },
      ]} />

      {/* The green table — the one the accountant computed by hand in the
          sheet ("phần màu xanh người dùng tự tính"). Here it simply is. */}
      <Section titleKey="refining.bags">
        <Typography.Paragraph type="secondary">{t('refining.bag.greenNote')}</Typography.Paragraph>
        <SendTable
          bags={bags}
          editable={lot.status === 'DRAFT'}
          onEdit={(bag) => setDialog({ kind: 'bag', bag })}
          onDelete={removeBag}
        />
        {lot.status === 'DRAFT' && (
          <Space style={{ marginTop: 8 }}>
            <Button onClick={() => setDialog({ kind: 'bag', bag: null })}>{t('refining.addBag')}</Button>
          </Space>
        )}
      </Section>

      {hasAssay && (
        <Section>
          <Typography.Paragraph type="secondary">{t('refining.bag.blueNote')}</Typography.Paragraph>
          <AssayTable bags={bags} />
        </Section>
      )}

      {lot.status === 'DRAFT' && (
        <Section>
          <PurchasePicker lotId={lot.id} available={available} picked={picked} bands={bands} />
        </Section>
      )}

      {stage >= LOT_STAGES.indexOf('ASSAYED') && (
        <Section titleKey="refining.owner">
          <DataTable<OwnerShare> rowKey="ownerCode" columns={shareColumns} dataSource={shares} pagination={false} />
          {receipts.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Typography.Title level={5}>{t('refining.receipts')}</Typography.Title>
              <DataTable<Receipt> rowKey="id" columns={receiptColumns} dataSource={receipts} pagination={false} />
            </div>
          )}
        </Section>
      )}

      {dialog?.kind === 'send' && (
        <SendDialog open lotId={lot.id} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === 'assay' && (
        <AssayDialog open lotId={lot.id} bags={bags} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === 'settle' && (
        <SettleDialog open lotId={lot.id} share={dialog.share} onClose={() => setDialog(null)} onDone={done} />
      )}
      {dialog?.kind === 'bag' && (
        <BagDialog open lotId={lot.id} bag={dialog.bag} goldTypes={goldTypes}
                   onClose={() => setDialog(null)} onDone={done} />
      )}
    </Page>
  )
}
