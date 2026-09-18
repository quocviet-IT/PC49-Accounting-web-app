'use client'

import { useState } from 'react'
import { Button, Table, Tabs, type TableColumnsType } from 'antd'
import { Search } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { matchesSearch } from '@/lib/ui/list'
import { Page, Empty, Grams, money, weight, ledger, LoadFailed } from '@/components/ledger/Ledger'
import type { Uom } from '@/lib/domain/units'
import { nativeText } from './weightText'
import { DataTable } from '@/components/ui/DataTable'
import { ListToolbar } from '@/components/ui/ListToolbar'
import styles from './InventoryView.module.css'

export type MovementRow = {
  code: string; opening: number; receipt: number; issue: number; closing: number
  openingValue: number; closingValue: number; adjustment: number
}

export type StockRow = {
  code: string; nameVi: string; nameEn: string; uom: string
  book: number; physical: number; total: number
}

export function filterInventoryRows(rows: StockRow[], query: string) {
  return rows.filter((row) => matchesSearch(query, [row.code, row.nameVi, row.nameEn, row.uom]))
}

/**
 * A holding in the unit its gold is counted in, the grams beneath.
 *
 * "Bảng tồn kho, thể hiện đơn vị tính L, Oz nhưng số tồn đang thể hiện là gr"
 * (18-09-2026). Stock is kept in grams; each gold has one unit, so the grams go
 * back into it exactly. Gold counted in grams is written once.
 */
function Holding({ grams, uom }: { grams: number; uom: string }) {
  if (uom !== 'LUONG' && uom !== 'OZ') return <Grams value={grams} />
  return (
    <>
      <div>{nativeText(grams, uom as Uom)}</div>
      <div className={ledger.muted}>{weight.format(grams)} g</div>
    </>
  )
}

export function InventoryView({ rows, period, asOf, movements, stockFailed = false, movementFailed = false }: {
  rows: StockRow[]; period: string; asOf: string; movements: MovementRow[]
  stockFailed?: boolean; movementFailed?: boolean
}) {
  const { locale, t } = useLocale()
  const [stockSearch, setStockSearch] = useState('')
  const [movementSearch, setMovementSearch] = useState('')
  const shown = rows.filter((row) => row.book !== 0 || row.physical !== 0 || row.total !== 0)
  const filteredStock = filterInventoryRows(shown, stockSearch)
  const sum = (key: 'book' | 'physical' | 'total') => shown.reduce((total, row) => total + row[key], 0)
  const nameOf = (code: string) => {
    const gold = rows.find((row) => row.code === code)
    return gold ? (locale === 'vi' ? gold.nameVi : gold.nameEn) : code
  }
  const moved = movements.filter((row) => row.opening !== 0 || row.receipt !== 0 || row.issue !== 0 || row.closing !== 0)
  const filteredMovements = moved.filter((row) => matchesSearch(movementSearch, [row.code, nameOf(row.code)]))

  const stockColumns: TableColumnsType<StockRow> = [
    { title: t('inv.goldType'), key: 'name', width: 240, render: (_, row) => locale === 'vi' ? row.nameVi : row.nameEn },
    { title: t('inv.native'), dataIndex: 'uom', width: 120, render: (value: string) => <span className={ledger.muted}>{value}</span> },
    { title: t('inv.book'), dataIndex: 'book', width: 150, align: 'right', render: (value: number, row) => <Holding grams={value} uom={row.uom} /> },
    { title: t('inv.physical'), dataIndex: 'physical', width: 150, align: 'right', render: (value: number, row) => <Holding grams={value} uom={row.uom} /> },
    { title: t('inv.total'), dataIndex: 'total', width: 150, align: 'right', render: (value: number, row) => <Holding grams={value} uom={row.uom} /> },
  ]
  const uomOf = (code: string) => rows.find((row) => row.code === code)?.uom ?? 'GRAM'
  const movementColumns: TableColumnsType<MovementRow> = [
    { title: t('inv.goldType'), key: 'name', width: 220, render: (_, row) => <>{nameOf(row.code)} <span className={ledger.muted}>{row.code}</span></> },
    { title: t('inv.opening'), dataIndex: 'opening', width: 150, align: 'right', render: (value: number, row) => <Holding grams={value} uom={uomOf(row.code)} /> },
    { title: t('inv.receipt'), dataIndex: 'receipt', width: 150, align: 'right', render: (value: number, row) => <Holding grams={value} uom={uomOf(row.code)} /> },
    { title: t('inv.issue'), dataIndex: 'issue', width: 150, align: 'right', render: (value: number, row) => <Holding grams={-Math.abs(value)} uom={uomOf(row.code)} /> },
    { title: t('inv.closing'), dataIndex: 'closing', width: 150, align: 'right', render: (value: number, row) => <Holding grams={value} uom={uomOf(row.code)} /> },
    { title: t('inv.adjustment'), dataIndex: 'adjustment', width: 180, align: 'right', render: (value: number) => <span className={value === 0 ? ledger.muted : undefined}>{value === 0 ? '—' : money.format(value)}</span> },
  ]

  if (stockFailed) return <Page titleKey="inv.title" noteKey="inv.explain"><div className={styles.panel}><LoadFailed /></div></Page>

  const holdingsPanel = <div className={styles.panel}>
    <form className={`pc-month ${styles.dateForm}`} method="get" action="/inventory">
      <label htmlFor="asOf">{t('inv.asOf')}</label><input id="asOf" name="asOf" type="date" defaultValue={asOf} />
      <input type="hidden" name="period" value={period} /><Button htmlType="submit" icon={<Search size={14} aria-hidden />}>{t('inv.show')}</Button>
    </form>
    {shown.length === 0 ? <Empty /> : <>
      <ListToolbar search={stockSearch} onSearch={setStockSearch} placeholder={t('inv.searchGold')} count={filteredStock.length} total={shown.length} onReset={stockSearch ? () => setStockSearch('') : undefined} />
      <DataTable<StockRow> rowKey="code" columns={stockColumns} dataSource={filteredStock} pagination={false} emptyDescription={t('cash.noFilterResults')} summary={() => <Table.Summary.Row><Table.Summary.Cell index={0} colSpan={2}>{t('common.total')} ({t('inv.gram')})</Table.Summary.Cell><Table.Summary.Cell index={2} align="right"><Grams value={sum('book')} /></Table.Summary.Cell><Table.Summary.Cell index={3} align="right"><Grams value={sum('physical')} /></Table.Summary.Cell><Table.Summary.Cell index={4} align="right"><Grams value={sum('total')} /></Table.Summary.Cell></Table.Summary.Row>} />
    </>}
  </div>

  const movementPanel = <div className={styles.panel}>
    <form className={`pc-month ${styles.dateForm}`} method="get" action="/inventory">
      <label htmlFor="period">{t('common.period')}</label><input id="period" name="period" type="month" defaultValue={period} />
      <Button htmlType="submit" icon={<Search size={14} aria-hidden />}>{t('inv.show')}</Button>
    </form>
    <p className={ledger.note}>{t('inv.movementNote')}</p>
    {movementFailed ? <LoadFailed /> : moved.length === 0 ? <Empty /> : <>
      <ListToolbar search={movementSearch} onSearch={setMovementSearch} placeholder={t('inv.searchGold')} count={filteredMovements.length} total={moved.length} onReset={movementSearch ? () => setMovementSearch('') : undefined} />
      <DataTable<MovementRow> rowKey="code" columns={movementColumns} dataSource={filteredMovements} emptyDescription={t('cash.noFilterResults')} />
    </>}
  </div>

  return <Page titleKey="inv.title" noteKey="inv.explain"><Tabs className="pc-tabs" defaultActiveKey="holdings" items={[
    { key: 'holdings', label: <span>{t('inv.tab.holdings')} <span className={styles.count}>{shown.length}</span></span>, children: holdingsPanel, forceRender: true },
    // No count on a tab whose read failed: 0 there would be a figure never read.
    { key: 'movements', label: <span>{t('inv.tab.movements')} {!movementFailed && <span className={styles.count}>{moved.length}</span>}</span>, children: movementPanel, forceRender: true },
  ]} /></Page>
}
