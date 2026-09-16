'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Select, Tag } from 'antd'
import { FolderOpen, Plus } from 'lucide-react'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { matchesSearch } from '@/lib/ui/list'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { Page, LoadFailed, money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { IconAction } from '@/components/ui/IconAction'
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
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<LotStatus | undefined>()
  const [refinery, setRefinery] = useState<string | undefined>()
  const filtered = lots.filter((r) => (!status || r.status === status)
    && (!refinery || r.refineryName === refinery)
    && matchesSearch(search, [r.lotCode, r.refineryName, r.sentDate, r.assayDate, r.receivedDate]))

  async function openLot() {
    setOpening(true)
    setError(null)
    const result = await settleAction(() => createLot({}))
    setOpening(false)
    if (!result.ok) { setError(isThrew(result) ? describeThrew(result, t) : result.message); return }
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
        <IconAction icon={<FolderOpen size={16} aria-hidden />} label={t('refining.open')}
                    onClick={() => router.push(`/refining/${r.id}`)} />
      ),
    },
  ]

  return (
    <Page
      titleKey="refining.title"
      actions={
        <Button type="primary" icon={<Plus size={17} aria-hidden />} loading={opening} onClick={openLot}>{t('refining.newLot')}</Button>
      }
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <ListToolbar search={search} onSearch={setSearch} count={filtered.length} total={lots.length}
        onReset={search || status || refinery ? () => { setSearch(''); setStatus(undefined); setRefinery(undefined) } : undefined}>
        <Select className="pc-filter-select" aria-label={t('refining.status')} placeholder={t('refining.status')}
          allowClear value={status} onChange={setStatus} options={Object.keys(STATUS_COLOR).map((s) => ({
            value: s, label: t(`refining.status.${s as LotStatus}`),
          }))} />
        <Select className="pc-filter-select" aria-label={t('refining.refinery')} placeholder={t('refining.refinery')}
          allowClear value={refinery} onChange={setRefinery} options={[...new Set(lots.map((l) => l.refineryName).filter(Boolean))]
            .map((value) => ({ value, label: value }))} />
      </ListToolbar>
      <DataTable<LotRow>
        rowKey="id"
        columns={columns}
        key={`${search}-${status}-${refinery}`}
        dataSource={filtered}
        onRow={(r) => ({ onClick: () => router.push(`/refining/${r.id}`), style: { cursor: 'pointer' } })}
      />
    </Page>
  )
}
