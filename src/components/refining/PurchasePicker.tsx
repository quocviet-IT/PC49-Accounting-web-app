'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Space, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { bagsFromPicked, pickPurchases, unpickPurchases } from '@/app/(app)/refining/actions'
import type { BandTotal, Purchase } from './types'

/**
 * The checkbox column of sheet 1.Scrap Gold, as a screen.
 *
 * Two lists: the scrap bought and not yet sent anywhere, and what has been
 * ticked into this lot. Underneath, the ticked purchases totalled per bag —
 * the four figures the batch tab computes — and the one button that turns
 * those totals into the bags that go (K1: "phải lấy số từ file Scrap Gold sau
 * khi tick").
 */
export function PurchasePicker({
  lotId, available, picked, bands,
}: {
  lotId: string
  available: Purchase[]
  picked: Purchase[]
  bands: BandTotal[]
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [chosen, setChosen] = useState<React.Key[]>([])
  const [dropping, setDropping] = useState<React.Key[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    setBusy(true); setError(null)
    const r = await fn()
    setBusy(false)
    if (!r.ok) { setError(r.message ?? 'failed'); return }
    setChosen([]); setDropping([])
    router.refresh()
  }

  const columns: ColumnsType<Purchase> = [
    { title: t('txn.col.doc'), dataIndex: 'docNo', width: 128, render: (v: string | null) => v ?? '—' },
    { title: t('refining.boughtOn'), dataIndex: 'txnDate', width: 108 },
    { title: t('refining.from'), dataIndex: 'partnerCode', ellipsis: true, render: (v: string | null) => v ?? '—' },
    { title: t('refining.band'), dataIndex: 'gradeBand', width: 110,
      render: (v: string | null, p) => (v ? <Tag>{v}</Tag> : <Tag color="red">{p.scrapDetail ?? t('refining.noBand')}</Tag>) },
    { title: t('refining.pct'), dataIndex: 'goldPct', width: 90, align: 'right',
      render: (v: number | null) => (v === null ? '—' : v.toFixed(4)) },
    { title: t('refining.grossGram'), dataIndex: 'qtyGram', width: 110, align: 'right',
      render: (v: number) => weight.format(v) },
    { title: t('refining.cost'), dataIndex: 'amount', width: 110, align: 'right',
      render: (v: number) => money.format(-v) },
  ]

  const bandColumns: ColumnsType<BandTotal> = [
    { title: t('refining.band'), dataIndex: 'gradeBand', width: 120,
      render: (v: string | null) => (v ? <Tag>{v}</Tag> : <Tag color="red">{t('refining.noBand')}</Tag>) },
    { title: t('inv.goldType'), dataIndex: 'goldTypeCode', width: 80 },
    { title: t('refining.pickCount'), dataIndex: 'purchaseCount', width: 90, align: 'right' },
    { title: t('refining.grossGram'), dataIndex: 'grossWeightGram', width: 120, align: 'right',
      render: (v: number) => weight.format(v) },
    { title: t('refining.avgPct'), dataIndex: 'avgGoldPct', width: 100, align: 'right',
      render: (v: number | null) => (v === null ? '—' : v.toFixed(4)) },
    { title: t('refining.pureGram'), dataIndex: 'pureWeightGram', width: 120, align: 'right',
      render: (v: number | null) => (v === null ? '—' : weight.format(v)) },
    { title: t('refining.cost'), dataIndex: 'totalCost', align: 'right',
      render: (v: number) => money.format(v) },
  ]

  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      {error && <Alert type="error" showIcon title={error} />}

      <div>
        <Typography.Title level={5}>{t('refining.pick.picked')} ({picked.length})</Typography.Title>
        <DataTable<Purchase>
          rowKey="id"
          columns={columns}
          dataSource={picked}
          pagination={false}
          emptyTitle={t('common.empty')}
          rowSelection={{ selectedRowKeys: dropping, onChange: setDropping }}
        />
        <Space style={{ marginTop: 8 }} wrap>
          <Button disabled={busy || dropping.length === 0}
                  onClick={() => run(() => unpickPurchases({ lotId, txnIds: dropping }))}>
            {t('refining.pick.remove')} ({dropping.length})
          </Button>
        </Space>
      </div>

      {bands.length > 0 && (
        <div>
          <Typography.Title level={5}>{t('refining.pick.bandTotal')}</Typography.Title>
          <DataTable<BandTotal>
            rowKey={(b) => `${b.gradeBand}|${b.goldTypeCode}`}
            columns={bandColumns}
            dataSource={bands}
            pagination={false}
          />
          <Space style={{ marginTop: 8 }} align="start" wrap>
            <Button type="primary" disabled={busy}
                    onClick={() => run(() => bagsFromPicked({ lotId }))}>
              {t('refining.pick.toBags')}
            </Button>
            <Typography.Text type="secondary">{t('refining.pick.toBagsHint')}</Typography.Text>
          </Space>
        </div>
      )}

      <div>
        <Typography.Title level={5}>{t('refining.pick.title')} ({available.length})</Typography.Title>
        <DataTable<Purchase>
          rowKey="id"
          columns={columns}
          dataSource={available}
          pagination={available.length > 50 ? { pageSize: 50 } : false}
          emptyTitle={t('refining.pick.none')}
          rowSelection={{ selectedRowKeys: chosen, onChange: setChosen }}
        />
        <Space style={{ marginTop: 8 }} wrap>
          <Button type="primary" disabled={busy || chosen.length === 0}
                  onClick={() => run(() => pickPurchases({ lotId, txnIds: chosen }))}>
            {t('refining.pick.add')} ({chosen.length})
          </Button>
        </Space>
      </div>
    </Space>
  )
}
