'use client'

import { useState } from 'react'
import { Pagination, Select } from 'antd'
import { ListToolbar } from '@/components/ui/ListToolbar'
import { matchesSearch, pageSlice } from '@/lib/ui/list'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Grams, money, ledger, Frame, LoadFailed } from '@/components/ledger/Ledger'

export type EntryRow = {
  id: string
  entryDate: string
  memo: string | null
  posted: boolean
  lines: {
    seq: number
    debit: string | null
    credit: string | null
    amount: number
    goldType: string | null
    qtyGram: number | null
  }[]
}

export function JournalView({ period, entries, loadFailed = false }: {
  period: string
  entries: EntryRow[]
  /**
   * The month's entries did not arrive. On a set of books an empty month is
   * the statement that nothing was recorded in it, which is not something a
   * query that failed is entitled to say.
   */
  loadFailed?: boolean
}) {
  const { t } = useLocale()
  const [search, setSearch] = useState('')
  const [posted, setPosted] = useState<string | undefined>()
  const [account, setAccount] = useState<string | undefined>()
  const [current, setCurrent] = useState(1)
  const [size, setSize] = useState(20)
  const filtered = entries.filter((e) => (!posted || String(e.posted) === posted)
    && (!account || e.lines.some((l) => l.debit === account || l.credit === account))
    && matchesSearch(search, [e.entryDate, e.memo, ...e.lines.flatMap((l) => [l.debit, l.credit, l.goldType])]))
  const page = pageSlice(filtered, current, size)
  const accounts = [...new Set(entries.flatMap((e) => e.lines.flatMap((l) => [l.debit, l.credit])).filter((a): a is string => !!a))].sort()
  if (loadFailed) return <Page titleKey="journal.title"><LoadFailed /></Page>
  if (entries.length === 0) return <Page titleKey="journal.title"><Empty /></Page>

  const totalDebit = entries.flatMap((e) => e.lines)
    .filter((l) => l.debit).reduce((s, l) => s + l.amount, 0)
  const totalCredit = entries.flatMap((e) => e.lines)
    .filter((l) => l.credit).reduce((s, l) => s + l.amount, 0)

  return (
    <Page titleKey="journal.title">
      <Section>
        <p className={ledger.note}>{t('common.period')}: {period}</p>
        <ListToolbar search={search} onSearch={(v) => { setSearch(v); setCurrent(1) }} count={filtered.length} total={entries.length}
          onReset={search || posted || account ? () => { setSearch(''); setPosted(undefined); setAccount(undefined); setCurrent(1) } : undefined}>
          <Select className="pc-filter-select" aria-label={t('rep.account')} placeholder={t('rep.account')} allowClear
            value={account} onChange={(v) => { setAccount(v); setCurrent(1) }} showSearch options={accounts.map((a) => ({ value: a, label: a }))} />
          <Select className="pc-filter-select" aria-label={t('users.state')} placeholder={t('users.state')} allowClear value={posted}
            onChange={(v) => { setPosted(v); setCurrent(1) }} options={[
              { value: 'true', label: t('home.posted') }, { value: 'false', label: t('journal.unposted') },
            ]} />
        </ListToolbar>
        <Frame>
<table className={ledger.table}>
            <thead>
              <tr>
                <th>{t('journal.date')}</th>
                <th>{t('journal.memo')}</th>
                <th>{t('journal.debit')}</th>
                <th>{t('journal.credit')}</th>
                <th className={ledger.num}>{t('journal.amount')}</th>
                <th className={ledger.num}>{t('journal.weight')}</th>
              </tr>
            </thead>
            <tbody>
              {page.rows.flatMap((e) =>
                e.lines.map((l, i) => (
                  <tr key={`${e.id}-${l.seq}`} className={e.posted ? undefined : ledger.aside}>
                    <td className={ledger.muted}>{i === 0 ? e.entryDate : ''}</td>
                    <td>
                      {i === 0 ? e.memo : ''}
                      {i === 0 && !e.posted && (
                        <> <span className={ledger.badge}>{t('journal.unposted')}</span></>
                      )}
                    </td>
                    <td>{l.debit ?? ''}</td>
                    <td>{l.credit ?? ''}</td>
                    <td className={ledger.num}>{money.format(l.amount)}</td>
                    <td className={ledger.num}>
                      {l.qtyGram === null ? '' : <Grams value={l.qtyGram} />}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{t('common.total')}</td>
                <td className={ledger.num}>{money.format(totalDebit)}</td>
                <td className={ledger.num}>{money.format(totalCredit)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </Frame>
        {filtered.length === 0 && <Empty />}
        <div className="pc-table-explorer__footer">
          <p>{t('ui.totalScope')}</p>
          <Pagination current={page.page} pageSize={size} total={filtered.length} showSizeChanger pageSizeOptions={[10, 20, 50, 100]}
            onChange={(p, n) => { setCurrent(n === size ? p : 1); setSize(n) }} />
        </div>
      </Section>
    </Page>
  )
}
