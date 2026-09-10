'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { Page, LoadFailed, money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { createLot } from '@/app/(app)/refining/actions'
import type { LotRow, LotStatus } from './types'

const STATUS_COLOR: Record<LotStatus, string> = {
  DRAFT: 'default', SENT: 'blue', ASSAYED: 'gold', RECEIVED: 'green', CLOSED: 'default',
}

/**
 * Every shipment, one row each. Opening a lot is one click — its code is
 * minted by the database — and lands on the lot page where the work happens.
 */
export function LotList({ lots, loadFailed = false }: { lots: LotRow[]; loadFailed?: boolean }) {
  const { t } = useLocale()
  const router = useRouter()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openLot() {
    setOpening(true)
    setError(null)
    const result = await createLot({})
    setOpening(false)
    if (!result.ok) { setError(result.message); return }
    router.push(`/refining/${result.lotId}`)
  }

  if (loadFailed) {
    return <Page titleKey="refining.title"><LoadFailed /></Page>
  }

  const columns: ColumnsType<LotRow> = [
    { title: t('refining.col.code'), dataIndex: 'lotCode', width: 118, ellipsis: true },
    {
      title: t('refining.status'), dataIndex: 'status', width: 112,
      render: (s: LotStatus) => <Tag color={STATUS_COLOR[s]}>{t(`refining.status.${s}` as const)}</Tag>,
    },
    { title: t('refining.col.refinery'), dataIndex: 'refineryName', ellipsis: true,
      render: (v: string | null) => v ?? '—' },
    { title: t('refining.sent'), dataIndex: 'sentDate', width: 104, render: (v: string | null) => v ?? '—' },
    { title: t('refining.assayed'), dataIndex: 'assayDate', width: 104, render: (v: string | null) => v ?? '—' },
    { title: t('refining.received'), dataIndex: 'receivedDate', width: 104, render: (v: string | null) => v ?? '—' },
    { title: t('refining.col.bags'), dataIndex: 'bagCount', width: 56, align: 'right' },
    {
      title: t('refining.weight'), dataIndex: 'totalGrossGram', width: 104, align: 'right',
      render: (v: number) => (v ? `${weight.format(v)} g` : '—'),
    },
    {
      title: t('refining.col.estimated'), dataIndex: 'estimatedValue', width: 120, align: 'right',
      render: (v: number) => (v ? money.format(v) : '—'),
    },
    {
      title: t('refining.col.settled'), dataIndex: 'assayValue', width: 120, align: 'right',
      render: (v: number) => (v ? money.format(v) : '—'),
    },
    {
      title: '', key: 'open', width: 64,
      render: (_: unknown, r) => (
        <Button size="small" onClick={() => router.push(`/refining/${r.id}`)}>
          {t('refining.open')}
        </Button>
      ),
    },
  ]

  return (
    <Page
      titleKey="refining.title"
      actions={
        <Button type="primary" loading={opening} onClick={openLot}>{t('refining.newLot')}</Button>
      }
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <DataTable<LotRow>
        rowKey="id"
        columns={columns}
        dataSource={lots}
        pagination={lots.length > 25 ? { pageSize: 25 } : false}
        onRow={(r) => ({ onClick: () => router.push(`/refining/${r.id}`), style: { cursor: 'pointer' } })}
      />
    </Page>
  )
}
