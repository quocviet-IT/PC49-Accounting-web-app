'use client'

import { useMemo, useState } from 'react'
import { Select, Table, Tabs, type TableColumnsType } from 'antd'
import { useLocale } from '@/lib/i18n/provider'
import { matchesSearch } from '@/lib/ui/list'
import { Page, Section, Empty, Signed, money, ledger, LoadFailed, Body } from '@/components/ledger/Ledger'
import { DataTable } from '@/components/ui/DataTable'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { StatementImport } from './StatementImport'
import { Reconcile } from './Reconcile'
import styles from './CashView.module.css'

export type CashTxnRow = {
  id: string; date: string; account: string; direction: 'IN' | 'OUT'
  amount: number; description: string | null; note: string | null; source: string
}
export type QueueRow = {
  id: string; date: string | null; accountNo: string | null
  accountName: string | null; amount: number | null
  description: string | null; reason: string
}
export type ReconRow = {
  account: string; date: string; ours: number; theirs: number
  difference: number; status: string; reason: string | null
}
export type LoanRow = { counterparty: string; outstanding: number }
export type AccountRow = {
  code: string; displayName: string; isClearing: boolean
  opening: number; received: number; paid: number; closing: number
}
export type ReconciliationViewRow = {
  account: string; accountName: string; ours: number
  reconciliation: ReconRow | null
}

export function filterCashMovements(
  rows: CashTxnRow[], query: string, account: string | null,
  direction: CashTxnRow['direction'] | null,
) {
  return rows.filter((row) => (!account || row.account === account)
    && (!direction || row.direction === direction)
    && matchesSearch(query, [row.date, row.account, row.description, row.note, row.source]))
}

export function filterReconciliations(
  rows: ReconciliationViewRow[], query: string, status: string | null,
) {
  return rows.filter((row) => {
    const actualStatus = row.reconciliation?.status ?? 'pending'
    return (!status || actualStatus === status) && matchesSearch(query, [row.account, row.accountName])
  })
}

export function CashView({
  period, rows, unmatched, movements, unplaced, recon, loans, monthEnd,
  balancesFailed = false, mayWrite = false, failed = {},
}: {
  period: string; rows: AccountRow[]; balancesFailed?: boolean
  failed?: { movements?: boolean; queue?: boolean; recon?: boolean; loans?: boolean }
  mayWrite?: boolean; unmatched: number; movements: CashTxnRow[]; unplaced: QueueRow[]
  recon: ReconRow[]; loans: LoanRow[]; monthEnd: string
}) {
  const { t } = useLocale()
  const [movementSearch, setMovementSearch] = useState('')
  const [movementAccount, setMovementAccount] = useState<string | null>(null)
  const [movementDirection, setMovementDirection] = useState<CashTxnRow['direction'] | null>(null)
  const [queueSearch, setQueueSearch] = useState('')
  const [reconSearch, setReconSearch] = useState('')
  const [reconStatus, setReconStatus] = useState<string | null>(null)
  const [loanSearch, setLoanSearch] = useState('')
  const real = rows.filter((row) => !row.isClearing)
  const clearing = rows.filter((row) => row.isClearing)
  const totalClosing = real.reduce((sum, row) => sum + row.closing, 0)
  const accountOptions = useMemo(
    () => [...new Set(movements.map((row) => row.account))]
      .sort().map((value) => ({ value, label: value })),
    [movements],
  )
  const filteredMovements = filterCashMovements(movements, movementSearch, movementAccount, movementDirection)
  const filteredQueue = unplaced.filter((row) => matchesSearch(queueSearch, [row.date, row.accountNo, row.accountName, row.description, row.reason]))
  const reconciliationRows: ReconciliationViewRow[] = real.map((account) => {
    const reconciliation = recon.find((row) => row.account === account.code) ?? null
    return { account: account.code, accountName: account.displayName,
      ours: reconciliation?.ours ?? account.closing, reconciliation }
  })
  const filteredRecon = filterReconciliations(reconciliationRows, reconSearch, reconStatus)
  const filteredLoans = loans.filter((row) => matchesSearch(loanSearch, [row.counterparty]))

  const accountColumns: TableColumnsType<AccountRow> = [
    { title: t('cash.account'), dataIndex: 'displayName', width: 240 },
    { title: t('cash.opening'), dataIndex: 'opening', width: 150, align: 'right',
      render: (value: number) => money.format(value) },
    { title: t('cash.received'), dataIndex: 'received', width: 150, align: 'right',
      render: (value: number) => <Signed value={value} /> },
    { title: t('cash.paid'), dataIndex: 'paid', width: 150, align: 'right',
      render: (value: number) => <Signed value={-value} /> },
    { title: t('cash.closing'), dataIndex: 'closing', width: 160, align: 'right',
      render: (value: number) => <Signed value={value} /> },
  ]
  const movementColumns: TableColumnsType<CashTxnRow> = [
    { title: t('cash.date'), dataIndex: 'date', width: 120 },
    { title: t('cash.account'), dataIndex: 'account', width: 150 },
    { title: t('cash.amount'), dataIndex: 'amount', width: 150, align: 'right',
      render: (value: number, row) => (
        <Signed value={row.direction === 'IN' ? value : -value} />
      ) },
    { title: t('cash.description'), dataIndex: 'description', width: 280,
      render: (value: string | null) => value ?? '—' },
    { title: t('cash.note'), dataIndex: 'note', width: 190,
      render: (value: string | null) => (
        <span className={ledger.muted}>{value ?? '—'}</span>
      ) },
  ]
  const queueColumns: TableColumnsType<QueueRow> = [
    { title: t('cash.date'), dataIndex: 'date', width: 120,
      render: (value: string | null) => value ?? '—' },
    { title: t('cash.rawAccount'), key: 'account', width: 220,
      render: (_, row) => (
        [row.accountNo, row.accountName].filter(Boolean).join(' · ') || '—'
      ) },
    { title: t('cash.amount'), dataIndex: 'amount', width: 140, align: 'right',
      render: (value: number | null) => value === null ? '—' : money.format(value) },
    { title: t('cash.description'), dataIndex: 'description', width: 260,
      render: (value: string | null) => value ?? '—' },
    { title: t('imp.reason'), dataIndex: 'reason', width: 220,
      render: (value: string) => <span className={ledger.out}>{value}</span> },
  ]
  const reconColumns: TableColumnsType<ReconciliationViewRow> = [
    { title: t('cash.account'), dataIndex: 'accountName', width: 220 },
    { title: t('cash.ourClosing'), dataIndex: 'ours', width: 150, align: 'right',
      render: (value: number) => money.format(value) },
    { title: t('cash.theirClosing'), key: 'theirs', width: 150, align: 'right',
      render: (_, row) => row.reconciliation
        ? money.format(row.reconciliation.theirs) : '—' },
    { title: t('cash.difference'), key: 'difference', width: 150, align: 'right',
      render: (_, row) => (
        <span className={!row.reconciliation || row.reconciliation.difference === 0
          ? ledger.muted : ledger.out}>
          {row.reconciliation ? money.format(row.reconciliation.difference) : '—'}
        </span>
      ) },
    { title: t('cash.recStatus'), key: 'status', width: 280,
      render: (_, row) => row.reconciliation ? (
        <>
          <span className={ledger.badge}>
            {t(`cash.rec.${row.reconciliation.status}` as never)}
          </span>
          {row.reconciliation.reason && (
            <span className={ledger.muted}> {row.reconciliation.reason}</span>
          )}
        </>
      ) : mayWrite ? (
        <Reconcile accountCode={row.account} accountName={row.accountName}
          ourClosing={row.ours} recDate={monthEnd} />
      ) : <span className={ledger.muted}>—</span> },
  ]
  const loanColumns: TableColumnsType<LoanRow> = [
    { title: t('rep.partner'), dataIndex: 'counterparty' },
    { title: t('cash.outstanding'), dataIndex: 'outstanding', width: 220,
      align: 'right', render: (value: number) => <Signed value={value} /> },
  ]

  if (balancesFailed) {
    return <Page titleKey="cash.title"><Section><LoadFailed /></Section></Page>
  }

  const overview = (
    <div className={styles.panel}>
      <p className={styles.context}>
        {t('common.period')}: <strong>{period}</strong>
      </p>
      {real.length === 0 ? <Empty /> : (
        <DataTable<AccountRow>
          rowKey="code"
          columns={accountColumns}
          dataSource={real}
          pagination={false}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}>{t('common.total')}</Table.Summary.Cell>
              <Table.Summary.Cell index={1} colSpan={3} />
              <Table.Summary.Cell index={4} align="right">
                <Signed value={totalClosing} />
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      )}
      {clearing.length > 0 && (
        <div className={styles.subpanel}>
          <h2 className={ledger.sectionTitle}>{t('cash.clearing')}</h2>
          <p className={ledger.note}>{t('cash.clearingNote')}</p>
          <DataTable<AccountRow>
            rowKey="code"
            columns={accountColumns}
            dataSource={clearing}
            pagination={false}
            rowClassName={() => ledger.aside}
          />
        </div>
      )}
    </div>
  )

  const movementPanel = (
    <div className={styles.panel}>
      <ListToolbar
        search={movementSearch}
        onSearch={setMovementSearch}
        placeholder={t('cash.searchMovements')}
        count={filteredMovements.length}
        total={movements.length}
        onReset={movementSearch || movementAccount || movementDirection ? () => {
          setMovementSearch('')
          setMovementAccount(null)
          setMovementDirection(null)
        } : undefined}
      >
        <Select className="pc-filter-select" allowClear
          aria-label={t('cash.filterAccount')} placeholder={t('cash.filterAccount')}
          value={movementAccount} options={accountOptions} onChange={setMovementAccount} />
        <Select className="pc-filter-select" allowClear
          aria-label={t('cash.filterDirection')} placeholder={t('cash.filterDirection')}
          value={movementDirection} onChange={setMovementDirection}
          options={[
            { value: 'IN', label: t('cash.direction.in') },
            { value: 'OUT', label: t('cash.direction.out') },
          ]} />
      </ListToolbar>
      <Body failed={failed.movements} empty={movements.length === 0}>
        <DataTable<CashTxnRow> rowKey="id" columns={movementColumns}
          dataSource={filteredMovements} emptyDescription={t('cash.noFilterResults')} />
      </Body>
    </div>
  )

  const clearingPanel = (
    <div className={styles.panel}>
      {mayWrite && <StatementImport />}
      {(unmatched > 0 || unplaced.length > 0 || failed.queue) && (
        <Section titleKey="cash.unmatched">
          <p className={ledger.note}>{t('cash.unmatchedNote')}</p>
          <ListToolbar search={queueSearch} onSearch={setQueueSearch}
            placeholder={t('cash.searchQueue')} count={filteredQueue.length}
            total={unplaced.length}
            onReset={queueSearch ? () => setQueueSearch('') : undefined} />
          <Body failed={failed.queue} empty={unplaced.length === 0}>
            <DataTable<QueueRow> rowKey="id" columns={queueColumns}
              dataSource={filteredQueue} emptyDescription={t('cash.noFilterResults')} />
          </Body>
        </Section>
      )}
      <Section titleKey="cash.reconciliation">
        <p className={ledger.note}>{t('cash.reconciliationNote')}</p>
        <ListToolbar search={reconSearch} onSearch={setReconSearch}
          placeholder={t('cash.searchAccounts')} count={filteredRecon.length}
          total={reconciliationRows.length}
          onReset={reconSearch || reconStatus ? () => {
            setReconSearch('')
            setReconStatus(null)
          } : undefined}
        >
          <Select className="pc-filter-select" allowClear
            aria-label={t('cash.filterStatus')} placeholder={t('cash.filterStatus')}
            value={reconStatus} onChange={setReconStatus}
            options={[
              { value: 'pending', label: t('cash.rec.pending') },
              { value: 'MATCHED', label: t('cash.rec.MATCHED') },
              { value: 'DIFF_EXPLAINED', label: t('cash.rec.DIFF_EXPLAINED') },
              { value: 'NOT_FOUND', label: t('cash.rec.NOT_FOUND') },
              { value: 'PENDING', label: t('cash.rec.PENDING') },
            ]} />
        </ListToolbar>
        {failed.recon ? <LoadFailed /> : (
          <DataTable<ReconciliationViewRow> rowKey="account" columns={reconColumns}
            dataSource={filteredRecon} emptyDescription={t('cash.noFilterResults')} />
        )}
      </Section>
    </div>
  )

  const loansPanel = (
    <div className={styles.panel}>
      <Section titleKey="cash.loans">
        <p className={ledger.note}>{t('cash.loansNote')}</p>
        <ListToolbar search={loanSearch} onSearch={setLoanSearch}
          placeholder={t('cash.searchLoans')} count={filteredLoans.length}
          total={loans.length}
          onReset={loanSearch ? () => setLoanSearch('') : undefined} />
        <Body failed={failed.loans} empty={loans.length === 0}>
          <DataTable<LoanRow> rowKey="counterparty" columns={loanColumns}
            dataSource={filteredLoans} emptyDescription={t('cash.noFilterResults')} />
        </Body>
      </Section>
    </div>
  )

  return (
    <Page titleKey="cash.title">
      {/* A tab whose read failed shows no count: 0 there would be a figure the
          screen never read. The failure itself is said inside the tab. */}
      <Tabs className={`pc-tabs ${styles.tabs}`} defaultActiveKey="overview" items={[
        { key: 'overview', label: t('cash.tab.overview'),
          children: overview, forceRender: true },
        { key: 'movements', label: (
          <span>{t('cash.tab.movements')} {!failed.movements && <span className={styles.count}>{movements.length}</span>}</span>
        ), children: movementPanel, forceRender: true },
        { key: 'clearing', label: (
          <span>{t('cash.tab.clearing')} {!failed.queue && <span className={styles.count}>{unplaced.length}</span>}</span>
        ), children: clearingPanel, forceRender: true },
        ...((loans.length > 0 || failed.loans) ? [{
          key: 'loans',
          label: <span>{t('cash.tab.loans')} {!failed.loans && <span className={styles.count}>{loans.length}</span>}</span>,
          children: loansPanel,
          forceRender: true,
        }] : []),
      ]} />
    </Page>
  )
}
