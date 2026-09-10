'use client'

import { Button, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import type { Bag } from './types'

/** Value conversion divides by 31.1 — VALUATION_GRAM_PER_OZ — never 31.105. */
const GRAM_PER_OZ_FOR_VALUE = 31.1

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(2)}%`)
const g = (v: number | null) => (v === null ? '—' : weight.format(v))
const usd = (v: number | null) => (v === null ? '—' : money.format(v))

/** Columns (1) and (2) of the sheet in one cell: the ounce price, and what that is a gram. */
function Spot({ perOz }: { perOz: number | null }) {
  if (perOz === null) return <>—</>
  return (
    <div style={{ lineHeight: 1.25 }}>
      <div>{money.format(perOz)}</div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {money.format(perOz / GRAM_PER_OZ_FOR_VALUE)}/g
      </Typography.Text>
    </div>
  )
}

function Delta({ value, digits = 2, suffix = '', asMoney = false }: {
  value: number | null; digits?: number; suffix?: string; asMoney?: boolean
}) {
  if (value === null) return <>—</>
  const cls = value === 0 ? undefined : value > 0 ? 'pc-in' : 'pc-out'
  const text = asMoney ? money.format(value) : value.toFixed(digits)
  return <span className={cls}>{value > 0 ? '+' : ''}{text}{suffix}</span>
}

/** A total of nothing is nothing, not 0.00 — the cells above it read "—". */
function sum(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((s, v) => s + v, 0)
}

function MetalTag({ bag }: { bag: Bag }) {
  return (
    <Space size={4}>
      <Tag color={bag.metal === 'PLATINUM' ? 'geekblue' : 'gold'}>
        {bag.metal === 'PLATINUM' ? 'PT' : 'Gold'}
      </Tag>
      {bag.goldTypeCode && bag.goldTypeCode !== 'SG' && bag.goldTypeCode !== 'PT' && (
        <Typography.Text type="secondary">{bag.goldTypeCode}</Typography.Text>
      )}
    </Space>
  )
}

/**
 * The green table of sheet 3.2: what went, and what it was estimated at.
 *
 * Every figure here is the sheet's, computed by the database view rather than
 * typed — the (n) in each header is the column number the accountant knows
 * it by. Weight net of fee is (5)×(1−(6)); the sheet's own header says (3)×(6)
 * but its formula says this, and the formula is what its totals were built on.
 * The fee (6) itself is one number per metal per lot and sits in the lot
 * header rather than repeating down every row.
 */
export function SendTable({
  bags, editable = false, onEdit, onDelete,
}: {
  bags: Bag[]
  editable?: boolean
  onEdit?: (bag: Bag) => void
  onDelete?: (bag: Bag) => void
}) {
  const { t } = useLocale()
  const net = (b: Bag) => (b.pureWeightGram === null || b.lossPct === null
    ? null : b.pureWeightGram * (1 - b.lossPct / 100))

  const columns: ColumnsType<Bag> = [
    { title: t('refining.bag.no'), dataIndex: 'seq', width: 48, align: 'right' },
    { title: t('refining.bag.metal'), key: 'metal', width: 96, render: (_, b) => <MetalTag bag={b} /> },
    { title: t('refining.bag.owner'), dataIndex: 'ownerCode', width: 72 },
    { title: t('refining.bag.desc'), dataIndex: 'sourceDesc', ellipsis: true,
      render: (v: string | null) => v ?? '—' },
    { title: t('refining.bag.spot'), dataIndex: 'spotPerOzSent', width: 118, align: 'right',
      render: (v: number | null) => <Spot perOz={v} /> },
    { title: t('refining.bag.gross'), dataIndex: 'grossWeightGram', width: 100, align: 'right', render: g },
    { title: t('refining.bag.pct'), dataIndex: 'goldPct', width: 90, align: 'right', render: pct },
    { title: t('refining.bag.pure'), dataIndex: 'pureWeightGram', width: 104, align: 'right', render: g },
    { title: t('refining.bag.net'), key: 'net', width: 118, align: 'right', render: (_, b) => g(net(b)) },
    { title: t('refining.bag.est'), dataIndex: 'estimatedValue', width: 140, align: 'right',
      render: (v: number | null) => <strong>{usd(v)}</strong> },
  ]
  if (editable) {
    columns.push({
      title: '', key: 'actions', width: 112,
      render: (_, b) => (
        <Space size={4}>
          <Button size="small" onClick={() => onEdit?.(b)}>{t('refining.bag.edit')}</Button>
          <Button size="small" danger onClick={() => onDelete?.(b)}>{t('refining.cancel')}</Button>
        </Space>
      ),
    })
  }

  const totals = {
    gross: sum(bags.map((b) => b.grossWeightGram)),
    pure: sum(bags.map((b) => b.pureWeightGram)),
    net: sum(bags.map(net)),
    est: sum(bags.map((b) => b.estimatedValue)),
  }

  return (
    <DataTable<Bag>
      rowKey="id"
      columns={columns}
      dataSource={bags}
      pagination={false}
      emptyTitle={t('refining.bag.none')}
      summary={() => bags.length === 0 ? null : (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={5}><strong>{t('refining.bag.total')}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={5} align="right"><strong>{g(totals.gross)}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={6} />
          <Table.Summary.Cell index={7} align="right"><strong>{g(totals.pure)}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={8} align="right"><strong>{g(totals.net)}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={9} align="right"><strong>{usd(totals.est)}</strong></Table.Summary.Cell>
          {editable && <Table.Summary.Cell index={10} />}
        </Table.Summary.Row>
      )}
    />
  )
}

/**
 * The blue table: what the refinery weighed and assayed, what that settles
 * at, and what the assay changed. The variance block is why the sheet has one
 * at all — scrap judged over the counter and scrap measured by a refinery are
 * rarely the same number, and the difference is somebody's money.
 */
export function AssayTable({ bags }: { bags: Bag[] }) {
  const { t } = useLocale()

  const columns: ColumnsType<Bag> = [
    { title: t('refining.bag.no'), dataIndex: 'seq', width: 48, align: 'right' },
    { title: t('refining.bag.metal'), key: 'metal', width: 96, render: (_, b) => <MetalTag bag={b} /> },
    { title: t('refining.bag.owner'), dataIndex: 'ownerCode', width: 72 },
    { title: t('refining.bag.spotAssay'), dataIndex: 'spotPerOzAssay', width: 108, align: 'right', render: usd },
    { title: t('refining.bag.assayGram'), dataIndex: 'assayWeightGram', width: 96, align: 'right', render: g },
    { title: t('refining.bag.assayPct'), dataIndex: 'assayPct', width: 96, align: 'right', render: pct },
    { title: t('refining.bag.assayPure'), dataIndex: 'assayPureWeightGram', width: 104, align: 'right', render: g },
    { title: t('refining.bag.settled'), dataIndex: 'assayValue', width: 124, align: 'right',
      render: (v: number | null) => <strong>{usd(v)}</strong> },
    { title: t('refining.bag.varPct'), dataIndex: 'purityVariance', width: 88, align: 'right',
      render: (v: number | null) => <Delta value={v === null ? null : -v * 100} digits={2} suffix="%" /> },
    { title: t('refining.bag.varPure'), dataIndex: 'weightVariance', width: 100, align: 'right',
      render: (v: number | null) => <Delta value={v} digits={2} /> },
    { title: t('refining.bag.varValue'), dataIndex: 'valueVariance', width: 108, align: 'right',
      render: (v: number | null) => <Delta value={v} asMoney /> },
  ]

  const totals = {
    assay: sum(bags.map((b) => b.assayWeightGram)),
    pure: sum(bags.map((b) => b.assayPureWeightGram)),
    settled: sum(bags.map((b) => b.assayValue)),
    dvalue: sum(bags.map((b) => b.valueVariance)),
  }

  return (
    <DataTable<Bag>
      rowKey="id"
      columns={columns}
      dataSource={bags}
      pagination={false}
      summary={() => bags.length === 0 ? null : (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={4}><strong>{t('refining.bag.total')}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={4} align="right"><strong>{g(totals.assay)}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={5} />
          <Table.Summary.Cell index={6} align="right"><strong>{g(totals.pure)}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={7} align="right"><strong>{usd(totals.settled)}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={8} colSpan={2} />
          <Table.Summary.Cell index={10} align="right"><strong><Delta value={totals.dvalue} asMoney /></strong></Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  )
}
