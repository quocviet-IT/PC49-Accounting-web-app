'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Input, Modal, Select, Space, Tag, Tooltip, Typography } from 'antd'
import { Download, Plus } from 'lucide-react'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { toGrams } from '@/lib/domain/units'
import { voidTransaction } from '@/app/(app)/gold-transactions/actions'
import { Page, Stat, Stats, LoadFailed, money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { TxnForm } from './TxnForm'
import { PAYMENT_METHODS, type GoldTypeOption, type LedgerRow } from './types'
import {
  DEFAULT_PAGE_SIZE, LEDGER_TXN_TYPES, PAGE_SIZES, ledgerSearch, presetRange, singleDay,
  type LedgerQuery, type Preset,
} from './ledgerQuery'
import styles from './Txn.module.css'

export type { GoldTypeOption, SavedRow, LedgerRow } from './types'

/** What the whole filter matched, not the page on screen (0068). */
export type LedgerTotals = {
  count: number
  purchases: number
  sales: number
  grams: Record<string, number>
}

const PRESETS: Preset[] = ['today', 'last7', 'thisMonth', 'lastMonth', 'thisYear', 'all']

/** Money going out of the till reads differently from money coming in. */
function Money({ value }: { value: number }) {
  const tone = value === 0 ? undefined : value > 0 ? 'pc-in' : 'pc-out'
  return <span className={tone}>{money.format(value)}</span>
}

/**
 * The gold ledger: every transaction, newest first, filtered as asked.
 *
 * It used to be one day at a time. The filter now lives in the address and is
 * applied by the database, so a range of a year is as quick to open as a day,
 * a view can be sent to somebody, and the file behind "Xuất Excel" holds
 * exactly the rows the filter means.
 *
 * Entry still happens on a form, not across a row: recording one purchase is
 * one task, and it gets one dialog.
 */
export function TxnScreen({
  query, today, goldTypes, salesPeople, partners, rows, totals, loadFailed = false,
}: {
  query: LedgerQuery
  /** The server's date, so the quick ranges agree between server and browser. */
  today: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
  rows: LedgerRow[]
  totals: LedgerTotals
  /**
   * The ledger, its totals, or the gold types did not arrive.
   *
   * Nothing to type into is offered in that case. An empty list on a day that
   * actually has transactions invites somebody to enter them again, and a
   * duplicated purchase is a real loss of money.
   */
  loadFailed?: boolean
}) {
  const { locale, t } = useLocale()
  const router = useRouter()

  /** Open with no row for a fresh transaction, with a row to replace it. */
  const [editing, setEditing] = useState<{ correcting: LedgerRow | null } | null>(null)
  const [voidRow, setVoidRow] = useState<LedgerRow | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // The search box keeps what is being typed; the address keeps what was
  // searched. A search cleared from elsewhere (Xoá bộ lọc) clears the box too.
  const [search, setSearch] = useState(query.q)
  const [searched, setSearched] = useState(query.q)
  if (query.q !== searched) {
    setSearched(query.q)
    if (query.q !== search.trim()) setSearch(query.q)
  }

  const go = (patch: Partial<LedgerQuery>) =>
    router.push(`/gold-transactions${ledgerSearch(query, patch)}`)

  // Searched once typing stops, not on every key.
  useEffect(() => {
    const q = search.trim()
    if (q === query.q) return
    const timer = setTimeout(
      () => router.push(`/gold-transactions${ledgerSearch(query, { q })}`), 400)
    return () => clearTimeout(timer)
  }, [search, query, router])

  const goldName = (code: string) => {
    const g = goldTypes.find((x) => x.code === code)
    return g ? (locale === 'vi' ? g.name_vi : g.name_en) : code
  }

  const hasFilters = Boolean(
    query.from || query.to || query.type || query.gold || query.staff
      || query.method || query.status || query.q,
  )
  const clearFilters = () => router.push('/gold-transactions')
  const activePreset = PRESETS.find((p) => {
    const range = presetRange(p, today)
    return range.from === query.from && range.to === query.to
  })

  /**
   * Which days are being looked at.
   *
   * Native date inputs rather than Ant Design's, because these are the
   * controls that have to keep working on the screen that says a read failed.
   */
  const dateFilters = (
    <div className={styles.dateRange} role="group" aria-label={t('txn.date')}>
      <label className="pc-date-field">
        <span className="pc-date-label">{t('txn.filter.from')}</span>
        <input
          type="date"
          className="pc-date-input"
          value={query.from ?? ''}
          max={query.to ?? undefined}
          aria-label={t('txn.filter.from')}
          onChange={(e) => go({ from: e.target.value || null })}
        />
      </label>
      <label className="pc-date-field">
        <span className="pc-date-label">{t('txn.filter.to')}</span>
        <input
          type="date"
          className="pc-date-input"
          value={query.to ?? ''}
          min={query.from ?? undefined}
          aria-label={t('txn.filter.to')}
          onChange={(e) => go({ to: e.target.value || null })}
        />
      </label>
      <Space size={4} wrap>
        {PRESETS.map((p) => (
          <Button key={p} size="small" type={activePreset === p ? 'primary' : 'default'}
                  onClick={() => go(presetRange(p, today))}>
            {t(`txn.preset.${p}` as const)}
          </Button>
        ))}
      </Space>
    </div>
  )

  const newButton = (
    <Button type="primary" icon={<Plus size={16} aria-hidden />}
            onClick={() => setEditing({ correcting: null })}>
      {t('txn.new')}
    </Button>
  )

  // The same filter, without the page: the file is every matching row.
  const exportButton = (
    <Button icon={<Download size={16} aria-hidden />}
            href={`/gold-transactions/export${ledgerSearch(query, { page: 1, size: DEFAULT_PAGE_SIZE })}`}>
      {t('txn.export')}
    </Button>
  )

  async function confirmVoid() {
    if (!voidRow) return
    setVoiding(true)
    const result = await voidTransaction({ id: voidRow.id, reason: voidReason })
    setVoiding(false)
    if (!result.ok) { setNotice(result.message); return }
    setVoidRow(null)
    setVoidReason('')
    router.refresh()
  }

  if (loadFailed) {
    // The heading and the date range stay: somebody has to be able to see what
    // failed and look at another range without a reload.
    return (
      <Page titleKey="txn.title">
        <div className={styles.failedFilters}>{dateFilters}</div>
        <LoadFailed />
      </Page>
    )
  }

  // Widths are the design; the columns without one share what is left. Naming
  // a width on the figures is what stops a long customer name squeezing an
  // amount into two lines.
  const columns: ColumnsType<LedgerRow> = [
    { title: t('txn.date'), dataIndex: 'txn_date', width: 104 },
    {
      title: t('txn.col.doc'), dataIndex: 'doc_no', width: 132,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('txn.col.type'), dataIndex: 'txn_type', width: 96,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: t('txn.col.partner'), dataIndex: 'partner_code', ellipsis: true,
      render: (v: string | null, r) => (
        <>
          <div>{v ?? '—'}</div>
          {r.partner_phone && <Typography.Text type="secondary">{r.partner_phone}</Typography.Text>}
        </>
      ),
    },
    {
      title: t('txn.col.sales'), dataIndex: 'sales_person_code', width: 100,
      render: (v: string | null, r) => (r.soldBy.length > 1
        // Everybody on it, not just the leading name.
        ? <>{r.soldBy.map((p) => <div key={p.code}>{p.code} {p.sharePct}%</div>)}</>
        : (v ?? '—')),
    },
    {
      title: t('txn.col.gold'), dataIndex: 'gold_type_code', width: 124,
      render: (v: string, r) => (
        <>
          <div>{goldName(v)}</div>
          {(r.scrap_detail || r.gold_pct !== null) && (
            <Typography.Text type="secondary">
              {[r.scrap_detail, r.gold_pct].filter((x) => x !== null && x !== '').join(' · ')}
            </Typography.Text>
          )}
        </>
      ),
    },
    {
      title: t('txn.col.qty'), dataIndex: 'qty', width: 104, align: 'right',
      render: (v: number, r) => (
        <>
          <div>{weight.format(v)}</div>
          {r.uom !== 'GRAM' && (
            <Typography.Text type="secondary">{weight.format(toGrams(v, r.uom))} g</Typography.Text>
          )}
        </>
      ),
    },
    {
      title: t('txn.col.price'), dataIndex: 'unit_price', width: 92, align: 'right',
      render: (v: number | null) => (v === null ? '—' : money.format(v)),
    },
    {
      title: t('txn.col.amount'), dataIndex: 'amount', width: 136, align: 'right',
      render: (v: number, r) => (
        <>
          <div><Money value={v} /></div>
          {r.payments.map((p) => (
            <Typography.Text key={p.seq} type="secondary" style={{ display: 'block' }}>
              {money.format(p.amount)} {p.method}
            </Typography.Text>
          ))}
        </>
      ),
    },
    { title: t('txn.col.remarks'), dataIndex: 'remarks', ellipsis: true },
    {
      title: t('txn.col.actions'), key: 'actions', width: 124,
      render: (_: unknown, r) => (
        <Space size={4}>
          {/* Greyed out with the reason rather than offered and then refused:
              the books may have closed over it. */}
          <Tooltip title={r.blockedReason ?? ''}>
            <Button size="small" disabled={Boolean(r.blockedReason)}
                    onClick={() => setEditing({ correcting: r })}>
              {t('txn.correct')}
            </Button>
          </Tooltip>
          <Button size="small" danger onClick={() => setVoidRow(r)}>
            {t('txn.void')}
          </Button>
        </Space>
      ),
    },
  ]

  const grams = Object.entries(totals.grams)

  return (
    <Page titleKey="txn.title" actions={<Space wrap>{exportButton}{newButton}</Space>}>
      {notice && (
        <Alert type="error" showIcon closable title={notice}
               onClose={() => setNotice(null)} style={{ marginBottom: 16 }} />
      )}
      {toast && (
        <Alert type="success" showIcon closable title={toast}
               onClose={() => setToast(null)} style={{ marginBottom: 16 }} />
      )}

      {dateFilters}

      <ListToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t('txn.filter.search')}
        count={rows.length}
        total={totals.count}
        onReset={hasFilters ? clearFilters : undefined}
      >
        <div className={styles.filters} role="group" aria-label={t('txn.filter.label')}>
          <Select
            allowClear
            className={styles.filterSelect}
            value={query.type}
            aria-label={t('txn.filter.type')}
            placeholder={t('txn.filter.type')}
            options={LEDGER_TXN_TYPES.map((value) => ({ value, label: value }))}
            onChange={(value) => go({ type: value ?? null })}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            className={styles.filterSelectWide}
            value={query.gold}
            aria-label={t('txn.filter.gold')}
            placeholder={t('txn.filter.gold')}
            options={goldTypes.map((gold) => ({ value: gold.code, label: goldName(gold.code) }))}
            onChange={(value) => go({ gold: value ?? null })}
          />
          <Select
            allowClear
            showSearch
            className={styles.filterSelect}
            value={query.staff}
            aria-label={t('txn.filter.staff')}
            placeholder={t('txn.filter.staff')}
            options={salesPeople.map((value) => ({ value, label: value }))}
            onChange={(value) => go({ staff: value ?? null })}
          />
          <Select
            allowClear
            className={styles.filterSelectWide}
            value={query.method}
            aria-label={t('txn.filter.payment')}
            placeholder={t('txn.filter.payment')}
            options={PAYMENT_METHODS.map((value) => ({ value, label: value }))}
            onChange={(value) => go({ method: value ?? null })}
          />
          <Select
            allowClear
            className={styles.filterSelectWide}
            value={query.status}
            aria-label={t('txn.filter.status')}
            placeholder={t('txn.filter.status')}
            options={[
              { value: 'correctable', label: t('txn.filter.correctable') },
              { value: 'locked', label: t('txn.filter.locked') },
            ]}
            onChange={(value) => go({ status: value ?? null })}
          />
        </div>
      </ListToolbar>

      <Stats>
        <Stat labelKey="txn.total.count" value={totals.count.toLocaleString('en-US')}
              note={t('txn.total.filtered')} />
        <Stat labelKey="txn.total.purchases" value={money.format(totals.purchases)}
              note={t('txn.total.filtered')} tone="out" />
        <Stat labelKey="txn.total.sales" value={money.format(totals.sales)}
              note={t('txn.total.filtered')} tone="in" />
      </Stats>

      {grams.length > 0 && (
        <div className={styles.summaryRow}>
          <Space size={4} wrap>
            <Typography.Text type="secondary">{t('txn.total.movement')}</Typography.Text>
            {grams.map(([code, g]) => (
              <Tag key={code} color={g > 0 ? 'green' : 'red'}>
                {goldName(code)} {weight.format(g)} g
              </Tag>
            ))}
          </Space>
        </div>
      )}

      <DataTable<LedgerRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        emptyTitle={hasFilters ? t('txn.filter.empty') : t('txn.empty.all')}
        emptyAction={hasFilters
          ? <Button onClick={clearFilters}>{t('txn.filter.clear')}</Button>
          : newButton}
        // The database pages; the table only shows where in the ledger it is.
        pagination={{
          current: query.page,
          pageSize: query.size,
          total: totals.count,
          pageSizeOptions: [...PAGE_SIZES],
          onChange: (page, size) => go(size !== query.size ? { size, page: 1 } : { page }),
        }}
        style={{ marginTop: 16 }}
      />

      {editing && (
        <TxnForm
          open
          // Looking at one day, a new transaction goes on that day, as the day
          // screen always did; otherwise on today. A correction keeps its day.
          txnDate={editing.correcting?.txn_date ?? singleDay(query) ?? today}
          goldTypes={goldTypes}
          salesPeople={salesPeople}
          partners={partners}
          correcting={editing.correcting}
          onClose={() => setEditing(null)}
          onSaved={(docNo, stayOpen) => {
            setToast(docNo ? `${t('txn.form.savedAs')} ${docNo}` : t('txn.saved'))
            if (!stayOpen) setEditing(null)
            router.refresh()
          }}
        />
      )}

      <Modal
        open={Boolean(voidRow)}
        title={t('txn.void.title')}
        okText={t('txn.void.confirm')}
        okButtonProps={{ danger: true, disabled: voidReason.trim().length < 3, loading: voiding }}
        cancelText={t('txn.form.close')}
        onOk={confirmVoid}
        onCancel={() => { setVoidRow(null); setVoidReason('') }}
      >
        {/* The reason is asked for because the database demands one, and
            because a cancellation nobody explained is the row somebody
            re-types next month. */}
        <p>{t('txn.voidWhy')}</p>
        {voidRow && (
          <p>
            <Tag>{voidRow.txn_type}</Tag>
            {voidRow.txn_date} · {goldName(voidRow.gold_type_code)} · {weight.format(voidRow.qty)}
            {' · '}{money.format(voidRow.amount)}
          </p>
        )}
        <Input autoFocus value={voidReason}
               aria-label={t('txn.voidWhy')}
               onChange={(e) => setVoidReason(e.target.value)}
               placeholder={t('txn.correctReason')} />
      </Modal>
    </Page>
  )
}
