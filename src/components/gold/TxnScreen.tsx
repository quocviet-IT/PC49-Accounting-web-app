'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Input, Modal, Space, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useLocale } from '@/lib/i18n/provider'
import { toGrams } from '@/lib/domain/units'
import { voidTransaction } from '@/app/(app)/gold-transactions/actions'
import { Page, Stat, Stats, LoadFailed, money, weight } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { FilterBar } from '@/components/ui/FilterBar'
import { TxnForm } from './TxnForm'
import type { GoldTypeOption, SavedRow } from './types'

export type { GoldTypeOption, SavedRow } from './types'

/** Money going out of the till reads differently from money coming in. */
function Money({ value }: { value: number }) {
  const tone = value === 0 ? undefined : value > 0 ? 'pc-in' : 'pc-out'
  return <span className={tone}>{money.format(value)}</span>
}

/**
 * A day of trading: what has been recorded, and the way in to record more.
 *
 * Drawn the way the accounting team already reads OneBook — a page header
 * carrying the one action that writes something, a filter strip saying what is
 * being looked at, and a table held to the width of its box underneath.
 *
 * Entry happens on a form, not across a row. The grid this replaces put every
 * field of every unsaved draft on screen at once, so the fields were as narrow
 * as the column they lived in. Recording one purchase is one task; it gets one
 * dialog.
 */
export function TxnScreen({
  txnDate, goldTypes, salesPeople, partners, existing, loadFailed = false,
}: {
  txnDate: string
  goldTypes: GoldTypeOption[]
  salesPeople: string[]
  partners: { code: string; phone: string | null }[]
  existing: SavedRow[]
  /**
   * The day's rows, or the gold types, did not arrive.
   *
   * Nothing to type into is offered in that case. An empty screen on a day
   * that actually has transactions invites somebody to enter them again, and a
   * duplicated purchase is a real loss of money.
   */
  loadFailed?: boolean
}) {
  const { locale, t } = useLocale()
  const router = useRouter()

  /** Open with no row for a fresh transaction, with a row to replace it. */
  const [editing, setEditing] = useState<{ correcting: SavedRow | null } | null>(null)
  const [voidRow, setVoidRow] = useState<SavedRow | null>(null)
  const [voidReason, setVoidReason] = useState('')
  const [voiding, setVoiding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const goldName = (code: string) => {
    const g = goldTypes.find((x) => x.code === code)
    return g ? (locale === 'vi' ? g.name_vi : g.name_en) : code
  }
  const phoneOf = (code: string | null) =>
    partners.find((p) => p.code === code)?.phone ?? null

  const totals = useMemo(() => {
    const purchases = existing
      .filter((r) => r.txn_type === 'PO' || r.txn_type === 'PO_VENDOR')
      .reduce((s, r) => s - r.amount, 0)
    const sales = existing
      .filter((r) => r.txn_type === 'SALE' || r.txn_type === 'PICKUP')
      .reduce((s, r) => s + r.amount, 0)
    const movement = new Map<string, number>()
    for (const r of existing) {
      movement.set(r.gold_type_code,
        (movement.get(r.gold_type_code) ?? 0) + toGrams(r.qty, r.uom))
    }
    return { purchases, sales, movement: [...movement].filter(([, g]) => g !== 0) }
  }, [existing])

  /**
   * The day being looked at, and the only way to reach any other one.
   *
   * The date goes in the address so a day is a place: it survives a reload, it
   * can be linked to from a report, and the back button returns to the day
   * before. Nothing is typed on this screen without the form being open, so
   * changing the day can no longer throw work away.
   *
   * A native date input rather than Ant Design's, because this is the control
   * that has to keep working on the screen that says a read failed.
   */
  const datePicker = (
    <label className="pc-date-field">
      <span className="pc-date-label">{t('txn.date')}</span>
      <input
        type="date"
        className="pc-date-input"
        value={txnDate}
        aria-label={t('txn.date')}
        onChange={(e) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
            router.push(`/gold-transactions?date=${e.target.value}`)
          }
        }}
      />
    </label>
  )

  const newButton = (
    <Button type="primary" onClick={() => setEditing({ correcting: null })}>
      {t('txn.new')}
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
    // The heading and the date picker stay: somebody has to be able to see
    // which day failed and go to another one without a reload.
    return (
      <Page titleKey="txn.title" actions={datePicker}>
        <LoadFailed />
      </Page>
    )
  }

  // Widths are the design; the columns without one share what is left. Naming
  // a width on the figures is what stops a long customer name squeezing an
  // amount into two lines.
  /*
   * Nine columns, not eleven.
   *
   * Every column that declares a width takes it out of the two that do not,
   * and a first cut declared nine of eleven: the customer column was left
   * thirty pixels and drew "Chi Lan" as "Chi". So the facts that are read
   * together are now shown together — the grade under the metal it describes,
   * how it was settled under the amount settled — and the two columns holding
   * names and prose get the room that frees up.
   */
  const columns: ColumnsType<SavedRow> = [
    {
      title: t('txn.col.doc'), dataIndex: 'doc_no', width: 132,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: t('txn.col.type'), dataIndex: 'txn_type', width: 84,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: t('txn.col.partner'), dataIndex: 'partner_code', ellipsis: true,
      render: (v: string | null) => (
        <>
          <div>{v ?? '—'}</div>
          {/* Read off the customer, not off the row, so it is the same number
              on every order they appear on. */}
          {phoneOf(v) && <Typography.Text type="secondary">{phoneOf(v)}</Typography.Text>}
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
      title: t('txn.col.gold'), dataIndex: 'gold_type_code', width: 148,
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
      title: t('txn.col.qty'), dataIndex: 'qty', width: 112, align: 'right',
      render: (v: number, r) => (
        <>
          <div>{weight.format(v)}</div>
          {/* Only when there is a conversion to show: a quantity already in
              grams printed the same number twice. */}
          {r.uom !== 'GRAM' && (
            <Typography.Text type="secondary">
              {weight.format(toGrams(v, r.uom))} g
            </Typography.Text>
          )}
        </>
      ),
    },
    {
      title: t('txn.col.price'), dataIndex: 'unit_price', width: 100, align: 'right',
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

  return (
    <Page titleKey="txn.title" actions={newButton}>
      {notice && (
        <Alert type="error" showIcon closable title={notice}
               onClose={() => setNotice(null)} style={{ marginBottom: 16 }} />
      )}
      {toast && (
        <Alert type="success" showIcon closable title={toast}
               onClose={() => setToast(null)} style={{ marginBottom: 16 }} />
      )}

      <FilterBar
        actions={
          totals.movement.length === 0 ? null : (
            <Space size={4} wrap>
              <Typography.Text type="secondary">{t('txn.total.movement')}</Typography.Text>
              {totals.movement.map(([code, grams]) => (
                <Tag key={code} color={grams > 0 ? 'green' : 'red'}>
                  {goldName(code)} {weight.format(grams)} g
                </Tag>
              ))}
            </Space>
          )
        }
      >
        {datePicker}
      </FilterBar>

      <Stats>
        <Stat labelKey="txn.total.purchases" value={money.format(totals.purchases)} tone="out" />
        <Stat labelKey="txn.total.sales" value={money.format(totals.sales)} tone="in" />
      </Stats>

      <DataTable<SavedRow>
        rowKey="id"
        columns={columns}
        dataSource={existing}
        pagination={false}
        emptyTitle={t('txn.empty2')}
        emptyAction={newButton}
        style={{ marginTop: 16 }}
      />

      {editing && (
        <TxnForm
          open
          txnDate={txnDate}
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
            {goldName(voidRow.gold_type_code)} · {weight.format(voidRow.qty)}
            {' · '}{money.format(voidRow.amount)}
          </p>
        )}
        <Input autoFocus value={voidReason}
               onChange={(e) => setVoidReason(e.target.value)}
               placeholder={t('txn.correctReason')} />
      </Modal>
    </Page>
  )
}
