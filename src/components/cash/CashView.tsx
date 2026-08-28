'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Signed, money, ledger, Frame } from '@/components/ledger/Ledger'
import { StatementImport } from './StatementImport'
import { Reconcile } from './Reconcile'

/** One movement of money in the month being read. */
export type CashTxnRow = {
  id: string
  date: string
  account: string
  direction: 'IN' | 'OUT'
  amount: number
  description: string | null
  /** The accountant's own note: "Mua khach", "Phi ngan hang", "Luong". */
  note: string | null
  source: string
}

/** A statement line the importer could not place against any account. */
export type QueueRow = {
  id: string
  date: string | null
  accountNo: string | null
  accountName: string | null
  amount: number | null
  description: string | null
  reason: string
}

/** One account squared against what the other book says it closed at. */
export type ReconRow = {
  account: string
  date: string
  ours: number
  theirs: number
  difference: number
  status: string
  reason: string | null
}

/** What one counterparty still owes the group, or is owed by it. */
export type LoanRow = { counterparty: string; outstanding: number }

export type AccountRow = {
  code: string
  displayName: string
  isClearing: boolean
  opening: number
  received: number
  paid: number
  closing: number
}

export function CashView({
  period, rows, unmatched, movements, unplaced, recon, loans, monthEnd,
}: {
  period: string
  rows: AccountRow[]
  unmatched: number
  movements: CashTxnRow[]
  unplaced: QueueRow[]
  recon: ReconRow[]
  loans: LoanRow[]
  monthEnd: string
}) {
  const { t } = useLocale()
  const real = rows.filter((r) => !r.isClearing)
  const clearing = rows.filter((r) => r.isClearing)
  const totalClosing = real.reduce((s, r) => s + r.closing, 0)

  const body = (list: AccountRow[]) => list.map((r) => (
    <tr key={r.code} className={r.isClearing ? ledger.aside : undefined}>
      <td>{r.displayName}</td>
      <td className={ledger.num}>{money.format(r.opening)}</td>
      <td className={ledger.num}><Signed value={r.received} /></td>
      <td className={ledger.num}><Signed value={-r.paid} /></td>
      <td className={ledger.num}><Signed value={r.closing} /></td>
    </tr>
  ))

  // The clearing table repeats the same columns, so it is laid out to the same
  // widths: two tables of figures that do not line up are two tables nobody can
  // compare.
  const columns = (
    <colgroup>
      <col style={{ width: '34%' }} />
      <col style={{ width: '16%' }} />
      <col style={{ width: '16%' }} />
      <col style={{ width: '16%' }} />
      <col style={{ width: '18%' }} />
    </colgroup>
  )

  const header = (
    <thead>
      <tr>
        <th>{t('cash.account')}</th>
        <th className={ledger.num}>{t('cash.opening')}</th>
        <th className={ledger.num}>{t('cash.received')}</th>
        <th className={ledger.num}>{t('cash.paid')}</th>
        <th className={ledger.num}>{t('cash.closing')}</th>
      </tr>
    </thead>
  )

  return (
    <Page titleKey="cash.title">
      <StatementImport />
      <Section>
        <p className={ledger.note}>{t('common.period')}: {period}</p>
        {rows.length === 0 ? <Empty /> : (
          <Frame>
<table className={ledger.table}>
              {columns}
              {header}
              <tbody>{body(real)}</tbody>
              <tfoot>
                <tr>
                  <td>{t('common.total')}</td>
                  <td colSpan={3} />
                  <td className={ledger.num}><Signed value={totalClosing} /></td>
                </tr>
              </tfoot>
            </table>
          </Frame>
        )}
      </Section>

      {clearing.length > 0 && (
        <Section titleKey="cash.clearing">
          <p className={ledger.note}>{t('cash.clearingNote')}</p>
          <Frame>
<table className={ledger.table}>
              {columns}
              {header}
              <tbody>{body(clearing)}</tbody>
            </table>
          </Frame>
        </Section>
      )}

      {unmatched > 0 && (
        <Section titleKey="cash.unmatched">
          {/* A count alone is not actionable. What the line said, and why it
              could not be placed, is what somebody needs to fix it. */}
          <p className={ledger.note}>{t('cash.unmatchedNote')}</p>
          <Frame>
            <table className={ledger.table}>
              <colgroup>
                <col style={{ width: '13%' }} /><col style={{ width: '20%' }} />
                <col style={{ width: '14%' }} /><col style={{ width: '28%' }} />
                <col style={{ width: '25%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('cash.date')}</th>
                  <th>{t('cash.rawAccount')}</th>
                  <th className={ledger.num}>{t('cash.amount')}</th>
                  <th>{t('cash.description')}</th>
                  <th>{t('imp.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {unplaced.map((q) => (
                  <tr key={q.id}>
                    <td>{q.date ?? '—'}</td>
                    <td>{[q.accountNo, q.accountName].filter(Boolean).join(' · ') || '—'}</td>
                    <td className={ledger.num}>
                      {q.amount === null ? '—' : money.format(q.amount)}
                    </td>
                    <td>{q.description ?? '—'}</td>
                    <td className={ledger.out}>{q.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Frame>
        </Section>
      )}

      <Section titleKey="cash.reconciliation">
        <p className={ledger.note}>{t('cash.reconciliationNote')}</p>
        <Frame>
          <table className={ledger.table}>
            <colgroup>
              <col style={{ width: '24%' }} /><col style={{ width: '15%' }} />
              <col style={{ width: '15%' }} /><col style={{ width: '15%' }} />
              <col style={{ width: '31%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('cash.account')}</th>
                <th className={ledger.num}>{t('cash.ourClosing')}</th>
                <th className={ledger.num}>{t('cash.theirClosing')}</th>
                <th className={ledger.num}>{t('cash.difference')}</th>
                <th>{t('cash.recStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {real.map((a) => {
                const r = recon.find((x) => x.account === a.code)
                return (
                  <tr key={a.code}>
                    <td>{a.displayName}</td>
                    <td className={ledger.num}>{money.format(r ? r.ours : a.closing)}</td>
                    <td className={ledger.num}>{r ? money.format(r.theirs) : '—'}</td>
                    {/* A difference of nothing is the answer everyone wants, so
                        it reads quiet rather than green. */}
                    <td className={`${ledger.num} ${
                      !r ? ledger.muted : r.difference === 0 ? ledger.muted : ledger.out}`}>
                      {r ? money.format(r.difference) : '—'}
                    </td>
                    <td>
                      {r ? (
                        <>
                          <span className={ledger.badge}>{t(`cash.rec.${r.status}` as never)}</span>
                          {r.reason && <span className={ledger.muted}> {r.reason}</span>}
                        </>
                      ) : (
                        <Reconcile
                          accountCode={a.code}
                          accountName={a.displayName}
                          ourClosing={a.closing}
                          recDate={monthEnd}
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Frame>
      </Section>

      {loans.length > 0 && (
        <Section titleKey="cash.loans">
          <p className={ledger.note}>{t('cash.loansNote')}</p>
          <Frame>
            <table className={ledger.table}>
              <colgroup><col style={{ width: '60%' }} /><col style={{ width: '40%' }} /></colgroup>
              <thead>
                <tr>
                  <th>{t('rep.partner')}</th>
                  <th className={ledger.num}>{t('cash.outstanding')}</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.counterparty}>
                    <td>{l.counterparty}</td>
                    <td className={ledger.num}><Signed value={l.outstanding} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Frame>
        </Section>
      )}

      <Section titleKey="cash.movements">
        {movements.length === 0 ? <Empty /> : (
          <Frame>
            <table className={ledger.table}>
              <colgroup>
                <col style={{ width: '12%' }} /><col style={{ width: '16%' }} />
                <col style={{ width: '15%' }} /><col style={{ width: '38%' }} />
                <col style={{ width: '19%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('cash.date')}</th>
                  <th>{t('cash.account')}</th>
                  <th className={ledger.num}>{t('cash.amount')}</th>
                  <th>{t('cash.description')}</th>
                  <th>{t('cash.note')}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}>
                    <td>{m.date}</td>
                    <td>{m.account}</td>
                    {/* Direction carries the sign, so the figure reads the way
                        it moved rather than the way the bank wrote it. */}
                    <td className={ledger.num}>
                      <Signed value={m.direction === 'IN' ? m.amount : -m.amount} />
                    </td>
                    <td>{m.description ?? '—'}</td>
                    <td className={ledger.muted}>{m.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Frame>
        )}
      </Section>
    </Page>
  )
}
