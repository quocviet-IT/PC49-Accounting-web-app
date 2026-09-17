'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import { ArrowLeftRight, Ban, Banknote, Download, PackageCheck, Pencil, Plus } from 'lucide-react'
import { IconAction } from '@/components/ui/IconAction'
import { TxnTypeTag } from './TxnTypeTag'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { toGrams } from '@/lib/domain/units'
import { voidConversion, voidReceipt } from '@/app/(app)/gold-transactions/actions'
import { Page, Stat, Stats, LoadFailed, money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { ReceiptForm } from './ReceiptForm'
import { ConversionForm } from './ConversionForm'
import { SettlementForm } from './SettlementForm'
import { PickupForm } from './PickupForm'
import { canPickUp, leftToPay } from './pickup'
import { ReceiptLines } from './ReceiptLines'
import { goldSummary } from './ledgerRow'
import { blockedSentence, describeRefusal } from './receiptErrors'
import { canSettle, owes } from './settlement'
import { PAYMENT_METHODS, type GoldTypeOption, type ReceiptRow } from './types'
import {
  DEFAULT_PAGE_SIZE, LEDGER_TXN_TYPES, OWED, PAGE_SIZES, ledgerSearch, presetRange, singleDay,
  type LedgerQuery, type Preset,
} from './ledgerQuery'
import styles from './Txn.module.css'

export type { GoldTypeOption, ReceiptRow } from './types'

/** What the whole filter matched, not the page on screen (0076). */
export type LedgerTotals = {
  /** Receipts, not items. */
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
 * The gold ledger: every receipt, newest first, filtered as asked.
 *
 * One row per receipt, as the paper has one number, one customer and one
 * payment; its items open beneath it. A transaction from before receipts is a
 * receipt of one item and reads exactly as it did. The filter lives in the
 * address and is applied by the database (0076), so the file behind
 * "Xuất Excel" holds exactly what the filter means.
 */
export function TxnScreen({
  query, today, goldTypes, salesPeople, partners, rows, totals, loadFailed = false,
  flowRules = [], tolerancePct = 0.5,
}: {
  query: LedgerQuery
  /** The server's date, so the quick ranges agree between server and browser. */
  today: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
  rows: ReceiptRow[]
  totals: LedgerTotals
  /** Which gold may go out and come in on a transfer, for the conversion form. */
  flowRules?: { gold_type_code: string; txn_type: string }[]
  /** CONVERSION_WEIGHT_TOLERANCE_PCT. */
  tolerancePct?: number
  /**
   * The ledger, its totals, or the gold types did not arrive. Nothing to type
   * into is offered then: an empty list invites somebody to enter the day again.
   */
  loadFailed?: boolean
}) {
  const { locale, t } = useLocale()
  const router = useRouter()

  /** Open with no receipt for a fresh one, with a receipt to replace it. */
  const [editing, setEditing] = useState<{ correcting: ReceiptRow | null } | null>(null)
  /**
   * Open with no row for a fresh conversion, with a conversion row to replace
   * it. A conversion reached from the receipt form's type list keeps its day.
   */
  const [converting, setConverting] = useState<{ correcting: ReceiptRow | null; date?: string } | null>(null)
  /** The receipt whose later payments are open. */
  const [settling, setSettling] = useState<ReceiptRow | null>(null)
  /** The deposit whose customer has come for the gold. */
  const [pickingUp, setPickingUp] = useState<ReceiptRow | null>(null)
  const [voidRow, setVoidRow] = useState<ReceiptRow | null>(null)
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
   * Which days are being looked at. Native date inputs, because these are the
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

  // "cai transfer dau?" (17-09): converting gold is entered beside a receipt,
  // and called Transfer, as the sheets call it ("Không có phân loại Transfer").
  const convertButton = (
    <Button icon={<ArrowLeftRight size={16} aria-hidden />}
            onClick={() => setConverting({ correcting: null })}>
      {t('txn.newConversion')}
    </Button>
  )

  // The same filter, without the page: the file is every matching receipt.
  const exportButton = (
    <Button icon={<Download size={16} aria-hidden />}
            href={`/gold-transactions/export${ledgerSearch(query, { page: 1, size: DEFAULT_PAGE_SIZE })}`}>
      {t('txn.export')}
    </Button>
  )

  async function confirmVoid() {
    if (!voidRow) return
    setVoiding(true)
    const input = { key: voidRow.key, reason: voidReason }
    const result = await settleAction(() => (voidRow.conversion ? voidConversion(input) : voidReceipt(input)))
    setVoiding(false)
    if (!result.ok) {
      setNotice(isThrew(result) ? describeThrew(result, t) : describeRefusal(result.message, t))
      return
    }
    setVoidRow(null)
    setVoidReason('')
    router.refresh()
  }

  if (loadFailed) {
    return (
      <Page titleKey="txn.title">
        <div className={styles.failedFilters}>{dateFilters}</div>
        <LoadFailed />
      </Page>
    )
  }

  /** The only item of a receipt of one, or null. */
  const onlyItem = (r: ReceiptRow) => (r.lines.length === 1 ? r.lines[0] : null)

  // Widths are the design; the columns without one share what is left.
  const columns: ColumnsType<ReceiptRow> = [
    { title: t('txn.date'), dataIndex: 'txn_date', width: 104 },
    {
      title: t('txn.col.doc'), dataIndex: 'doc_no', width: 132,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('txn.col.type'), dataIndex: 'txn_type', width: 112,
      // A conversion is named by its code, as PO and SALE are.
      render: (v: string, r) => (r.conversion
        ? <Tag color="purple" className="pc-txn-type">
            {r.conversion.kind === 'RA_RP' ? 'RA_RP' : 'TRANSFER'}
          </Tag>
        : <TxnTypeTag type={v} />),
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
        ? <>{r.soldBy.map((p) => <div key={p.code}>{p.code} {p.sharePct}%</div>)}</>
        : (v ?? '—')),
    },
    {
      title: t('txn.col.gold'), key: 'gold', width: 150,
      render: (_: unknown, r) => {
        const only = onlyItem(r)
        return (
          <>
            <div>{goldSummary(r, goldName, t)}</div>
            {only && (only.scrap_detail || only.gold_pct !== null) && (
              <Typography.Text type="secondary">
                {[only.scrap_detail, only.gold_pct].filter((x) => x !== null && x !== '').join(' · ')}
              </Typography.Text>
            )}
          </>
        )
      },
    },
    {
      title: t('txn.col.qty'), key: 'qty', width: 104, align: 'right',
      render: (_: unknown, r) => {
        if (r.conversion) {
          // The weight that changed kind: the grams that went out.
          const out = r.lines.filter((l) => l.side === 'out')
            .reduce((sum, l) => sum + Math.abs(toGrams(l.qty, l.uom)), 0)
          return <>{weight.format(out)} g</>
        }
        const only = onlyItem(r)
        if (!only) {
          // Items counted in different units add up in grams.
          const grams = r.lines.reduce((sum, l) => sum + toGrams(l.qty, l.uom), 0)
          return <>{weight.format(grams)} g</>
        }
        return (
          <>
            <div>{weight.format(only.qty)}</div>
            {only.uom !== 'GRAM' && (
              <Typography.Text type="secondary">{weight.format(toGrams(only.qty, only.uom))} g</Typography.Text>
            )}
          </>
        )
      },
    },
    {
      title: t('txn.col.price'), key: 'price', width: 92, align: 'right',
      render: (_: unknown, r) => {
        const only = onlyItem(r)
        return !r.conversion && only && only.unit_price !== null ? money.format(only.unit_price) : '—'
      },
    },
    {
      title: t('txn.col.amount'), dataIndex: 'amount', width: 136, align: 'right',
      render: (v: number, r) => (r.conversion ? '—' : (
        <>
          <div><Money value={v} /></div>
          {/* A deposit: what is left to pay at pickup. A pickup: what was put down (0087). */}
          {r.deposit?.role === 'deposit' && !r.deposit.settledBy && leftToPay(r.deposit) !== null && (
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              {t('pickup.leftShort').replace('{0}', money.format(leftToPay(r.deposit)!))}
            </Typography.Text>
          )}
          {r.deposit?.role === 'pickup' && (
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              {t('pickup.depositedShort').replace('{0}', money.format(r.deposit.paid))}
            </Typography.Text>
          )}
          {r.payments.map((p) => (
            <Typography.Text key={p.seq} type="secondary" style={{ display: 'block' }}>
              {money.format(p.amount)} {p.method}
            </Typography.Text>
          ))}
          {/* Paid later, each on its own day (0083), then what is still owed. */}
          {(r.settlements ?? []).map((s) => (
            <Typography.Text key={s.id} type="secondary" style={{ display: 'block' }}>
              {money.format(s.amount)} {s.method} · {s.payDate}
            </Typography.Text>
          ))}
          {owes(r) && (
            <Typography.Text type="danger" style={{ display: 'block' }}>
              {t('receipt.owed').replace('{0}', money.format(r.owed ?? 0))}
            </Typography.Text>
          )}
        </>
      )),
    },
    {
      title: t('txn.col.remarks'), dataIndex: 'remarks', ellipsis: true,
      render: (v: string | null, r) => (
        <>
          {r.conversion?.varianceNote && (
            <Tag color="orange" title={r.conversion.varianceReason ?? r.conversion.varianceNote}>
              {t('conversion.variance')}
            </Tag>
          )}
          {/* Which day the order was taken, and which day it was collected. */}
          {r.deposit?.role === 'deposit' && (
            r.deposit.settledBy === 'PICKUP'
              ? <><Tag color="green">{t('pickup.done').replace('{0}', r.deposit.pickupDate ?? '')}</Tag>{r.deposit.pickupDoc} </>
              : r.deposit.settledBy === 'CANCEL'
                ? <Tag>{t('pickup.cancelled')}</Tag>
                : <Tag color="gold">{t('pickup.waiting')}</Tag>
          )}
          {r.deposit?.role === 'pickup' && (
            <><Tag color="green">{t('pickup.ofDeposit').replace('{0}', r.deposit.depositDate ?? '')}</Tag>{r.deposit.depositDoc} </>
          )}
          {v ?? ''}
        </>
      ),
    },
    {
      // Icons pinned to the right, so Sửa can be pressed without scrolling.
      title: t('txn.col.actions'), key: 'actions', width: 116, fixed: 'right',
      render: (_: unknown, r) => (
        <Space size={2}>
          {canPickUp(r) && (
            <IconAction icon={<PackageCheck size={16} aria-hidden />} label={t('pickup.open')}
                        onClick={() => setPickingUp(r)} />
          )}
          {canSettle(r) && (
            <IconAction icon={<Banknote size={16} aria-hidden />} label={t('settle.open')}
                        onClick={() => setSettling(r)} />
          )}
          <IconAction icon={<Pencil size={16} aria-hidden />} label={t('txn.correct')}
                      disabled={Boolean(r.blockedCode)}
                      disabledReason={blockedSentence(r.blockedCode, t)}
                      onClick={() => (r.conversion
                        ? setConverting({ correcting: r })
                        : setEditing({ correcting: r }))} />
          <IconAction icon={<Ban size={16} aria-hidden />} label={t('txn.void')} danger
                      onClick={() => setVoidRow(r)} />
        </Space>
      ),
    },
  ]

  const grams = Object.entries(totals.grams)

  return (
    <Page titleKey="txn.title" actions={<Space wrap>{exportButton}{convertButton}{newButton}</Space>}>
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
            options={[
              ...PAYMENT_METHODS.map((value) => ({ value, label: value })),
              { value: OWED, label: t('txn.filter.owed') },
            ]}
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

      <DataTable<ReceiptRow>
        rowKey="key"
        columns={columns}
        dataSource={rows}
        // A receipt of several items opens to show them; a receipt of one
        // already shows everything on its row.
        expandable={{
          rowExpandable: (r) => r.lines.length > 1,
          expandedRowRender: (r) => <ReceiptLines row={r} goldName={goldName} />,
        }}
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
        <ReceiptForm
          open
          // Looking at one day, a new receipt goes on that day; otherwise on
          // today. A correction keeps its day.
          txnDate={editing.correcting?.txn_date ?? singleDay(query) ?? today}
          goldTypes={goldTypes}
          salesPeople={salesPeople}
          partners={partners}
          correcting={editing.correcting}
          onClose={() => setEditing(null)}
          onTransfer={(date) => {
            setEditing(null)
            setConverting({ correcting: null, date })
          }}
          onSaved={(docNo, stayOpen) => {
            setToast(docNo ? `${t('txn.form.savedAs')} ${docNo}` : t('txn.saved'))
            if (!stayOpen) setEditing(null)
            router.refresh()
          }}
        />
      )}

      {converting && (
        <ConversionForm
          open
          // A correction keeps its day; a fresh conversion takes the day being
          // looked at, or today.
          convDate={converting.correcting?.txn_date ?? converting.date ?? singleDay(query) ?? today}
          goldTypes={goldTypes}
          partners={partners}
          flowRules={flowRules}
          tolerancePct={tolerancePct}
          correcting={converting.correcting}
          onClose={() => setConverting(null)}
          onSaved={(docNo, stayOpen) => {
            setToast(docNo ? `${t('txn.form.savedAs')} ${docNo}` : t('txn.saved'))
            if (!stayOpen) setConverting(null)
            router.refresh()
          }}
        />
      )}

      {settling && (
        <SettlementForm
          row={settling}
          today={today}
          onClose={() => setSettling(null)}
          onDone={(message) => {
            setSettling(null)
            setToast(message)
            router.refresh()
          }}
        />
      )}

      {pickingUp && (
        <PickupForm
          row={pickingUp}
          today={today}
          goldName={goldName}
          onClose={() => setPickingUp(null)}
          onDone={(message) => {
            setPickingUp(null)
            setToast(message)
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
            because a cancellation nobody explained is re-typed next month.
            Every item of the receipt goes. */}
        <p>{t('txn.voidWhy')}</p>
        {voidRow && (
          <p>
            <TxnTypeTag type={voidRow.txn_type} />
            {voidRow.txn_date} · {voidRow.doc_no ?? '—'} · {goldSummary(voidRow, goldName, t)}
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
