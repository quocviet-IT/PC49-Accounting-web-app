'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/i18n/provider'
import {
  Page, Section, Empty, Frame, Signed, Grams, money, weight, ledger,
} from '@/components/ledger/Ledger'
import type { ReportDefinition } from '@/lib/domain/reports'
import styles from './Reports.module.css'

export type PnlLine = {
  code: string; nameVi: string; nameEn: string
  lineKind: 'ACCOUNTS' | 'SUBTOTAL' | 'DIFFERENCE'; indent: number; amount: number
}
export type TrialRow = {
  code: string; nameVi: string; nameEn: string
  opening: number; debit: number; credit: number; closing: number
}
export type LedgerRow = {
  date: string; memo: string | null; partner: string | null; contra: string | null
  debit: number; credit: number; balance: number
}
export type StockRow = {
  code: string; opening: number; receipt: number; issue: number
  closing: number; closingValue: number; adjustment: number
}
export type DepositRow = {
  date: string; partner: string | null; gold: string; qty: number; gram: number
  amount: number; settledBy: string | null; settledDate: string | null
}
export type AparRow = {
  partner: string; account: string
  opening: number; debit: number; credit: number; closing: number
}
export type VendorRow = {
  partner: string; gold: string; qty: number; purchased: number; outstanding: number
}
export type AccountOption = { code: string; nameVi: string; nameEn: string }

export type ReportData =
  | { kind: 'empty' }
  | { kind: 'pnl'; lines: PnlLine[] }
  | {
      kind: 'assets'; inventoryGram: number; inventoryValue: number
      receivable: number; payable: number; cash: number; bank: number; total: number
    }
  | { kind: 'trial'; rows: TrialRow[] }
  | { kind: 'ledger'; account: string; accounts: AccountOption[]; rows: LedgerRow[] }
  | { kind: 'stock'; rows: StockRow[] }
  | { kind: 'deposits'; rows: DepositRow[] }
  | { kind: 'apar'; rows: AparRow[] }
  | { kind: 'vendor'; rows: VendorRow[] }

export function ReportView({
  report, period, date, from, to, data,
}: {
  report: ReportDefinition
  period: string
  date: string
  from: string
  to: string
  data: ReportData
}) {
  const { locale, t } = useLocale()
  const name = (r: { nameVi: string; nameEn: string }) =>
    locale === 'vi' ? r.nameVi : r.nameEn

  // The file has to be of the report on screen, over the window on screen.
  const exportHref = `/reports/export?${new URLSearchParams({
    report: report.id,
    ...(report.range === 'month' ? { period } : {}),
    ...(report.range === 'day' ? { date } : {}),
    ...(report.range === 'range'
      ? { from, to, ...(data.kind === 'ledger' ? { account: data.account } : {}) }
      : {}),
  })}`

  /* Only the control the report actually reads. A month picker on a report
     taken at a date is a control that does nothing, which is worse than none. */
  const controls = (
    <form className={styles.controls} method="get" action="/reports">
      <input type="hidden" name="report" value={report.id} />
      {report.range === 'month' && (
        <>
          <label htmlFor="period">{t('common.period')}</label>
          <input id="period" name="period" type="month" defaultValue={period} />
        </>
      )}
      {report.range === 'day' && (
        <>
          <label htmlFor="date">{t('common.asOf')}</label>
          <input id="date" name="date" type="date" defaultValue={date} />
        </>
      )}
      {report.range === 'range' && (
        <>
          <label htmlFor="from">{t('rep.from')}</label>
          <input id="from" name="from" type="date" defaultValue={from} />
          <label htmlFor="to">{t('rep.to')}</label>
          <input id="to" name="to" type="date" defaultValue={to} />
          {data.kind === 'ledger' && (
            <select name="account" aria-label={t('rep.account')} defaultValue={data.account}>
              {data.accounts.map((a) => (
                <option key={a.code} value={a.code}>{a.code} · {name(a)}</option>
              ))}
            </select>
          )}
        </>
      )}
      <button type="submit">{t('rep.run')}</button>
    </form>
  )

  return (
    <Page
      titleKey={report.titleKey}
      noteKey={report.descriptionKey}
      actions={
        <span className={styles.actions}>
          <Link className="pc-download" href="/reports">{t('rep.backToCentre')}</Link>
          <a className="pc-download" href={exportHref}>{t('rep.export')}</a>
        </span>
      }
    >
      {controls}

      {data.kind === 'empty' && <Empty />}

      {data.kind === 'pnl' && (
        <Section>
          <Frame>
            <table className={ledger.table}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <thead>
                <tr>
                  <th>{t('rep.line')}</th>
                  <th className={ledger.num}>{t('rep.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {/* Only the bottom line carries a direction. Colouring cost the
                    same green as revenue would make the two signal colours mean
                    something different here than everywhere else. */}
                {data.lines.map((l) => (
                  <tr key={l.code} className={l.lineKind === 'ACCOUNTS' ? ledger.aside : undefined}>
                    <td style={{ paddingLeft: 12 + l.indent * 18 }}>{name(l)}</td>
                    <td className={ledger.num}>
                      {l.lineKind === 'DIFFERENCE'
                        ? <strong><Signed value={l.amount} /></strong>
                        : l.lineKind === 'SUBTOTAL'
                          ? <strong>{money.format(l.amount)}</strong>
                          : money.format(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Frame>
        </Section>
      )}

      {data.kind === 'assets' && (
        <Section>
          <Frame>
            <table className={ledger.table}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <tbody>
                <tr>
                  <td>
                    {t('rep.inventoryValue')}{' '}
                    <span className={ledger.muted}>({weight.format(data.inventoryGram)} g)</span>
                  </td>
                  <td className={ledger.num}>{money.format(data.inventoryValue)}</td>
                </tr>
                <tr>
                  <td>{t('rep.receivable')}</td>
                  <td className={ledger.num}>{money.format(data.receivable)}</td>
                </tr>
                <tr>
                  <td>{t('rep.payable')}</td>
                  <td className={ledger.num}>{money.format(data.payable)}</td>
                </tr>
                <tr>
                  <td>{t('rep.cash')}</td>
                  <td className={ledger.num}>{money.format(data.cash)}</td>
                </tr>
                <tr>
                  <td>{t('rep.bank')}</td>
                  <td className={ledger.num}>{money.format(data.bank)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>{t('rep.cashFlowTotal')}</td>
                  <td className={ledger.num}><Signed value={data.total} /></td>
                </tr>
              </tfoot>
            </table>
          </Frame>
        </Section>
      )}

      {data.kind === 'trial' && (
        <Section>
          {data.rows.length === 0 ? <Empty /> : (
            <Frame>
              <table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '34%' }} /><col style={{ width: '16%' }} />
                  <col style={{ width: '16%' }} /><col style={{ width: '16%' }} />
                  <col style={{ width: '18%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('rep.account')}</th>
                    <th className={ledger.num}>{t('rep.opening')}</th>
                    <th className={ledger.num}>{t('journal.debit')}</th>
                    <th className={ledger.num}>{t('journal.credit')}</th>
                    <th className={ledger.num}>{t('rep.closing')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.code}>
                      <td>{r.code} <span className={ledger.muted}>{name(r)}</span></td>
                      <td className={ledger.num}>{money.format(r.opening)}</td>
                      <td className={ledger.num}>{money.format(r.debit)}</td>
                      <td className={ledger.num}>{money.format(r.credit)}</td>
                      <td className={ledger.num}>{money.format(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
                {/* The proof. A trial balance whose two columns disagree is the
                    report telling you to stop and look. */}
                <tfoot>
                  <tr>
                    <td>{t('common.total')}</td>
                    <td />
                    <td className={ledger.num}>
                      {money.format(data.rows.reduce((s, r) => s + r.debit, 0))}
                    </td>
                    <td className={ledger.num}>
                      {money.format(data.rows.reduce((s, r) => s + r.credit, 0))}
                    </td>
                    <td className={ledger.num}>
                      {Math.abs(
                        data.rows.reduce((s, r) => s + r.debit - r.credit, 0),
                      ) < 0.005
                        ? <span className={ledger.in}>{t('rep.balanced')}</span>
                        : <span className={ledger.out}>{t('rep.outOfBalance')}</span>}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </Frame>
          )}
        </Section>
      )}

      {data.kind === 'ledger' && (
        <Section>
          {data.rows.length === 0 ? <Empty /> : (
            <Frame>
              <table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '11%' }} /><col style={{ width: '12%' }} />
                  <col style={{ width: '31%' }} /><col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} /><col style={{ width: '16%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('journal.date')}</th>
                    <th>{t('rep.contra')}</th>
                    <th>{t('journal.memo')}</th>
                    <th className={ledger.num}>{t('journal.debit')}</th>
                    <th className={ledger.num}>{t('journal.credit')}</th>
                    <th className={ledger.num}>{t('rep.runningBalance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={`${r.date}-${i}`}>
                      <td>{r.date}</td>
                      <td className={ledger.muted}>{r.contra ?? '—'}</td>
                      <td>{r.memo ?? '—'}{r.partner && <span className={ledger.muted}> · {r.partner}</span>}</td>
                      <td className={ledger.num}>{r.debit ? money.format(r.debit) : ''}</td>
                      <td className={ledger.num}>{r.credit ? money.format(r.credit) : ''}</td>
                      <td className={ledger.num}><strong>{money.format(r.balance)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}
        </Section>
      )}

      {data.kind === 'stock' && (
        <Section>
          {data.rows.length === 0 ? <Empty /> : (
            <Frame>
              <table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '16%' }} /><col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} /><col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} /><col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('inv.goldType')}</th>
                    <th className={ledger.num}>{t('inv.opening')}</th>
                    <th className={ledger.num}>{t('inv.receipt')}</th>
                    <th className={ledger.num}>{t('inv.issue')}</th>
                    <th className={ledger.num}>{t('inv.closing')}</th>
                    <th className={ledger.num}>{t('inv.adjustment')}</th>
                    <th className={ledger.num}>{t('rep.closingValue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.code}>
                      <td>{r.code}</td>
                      <td className={ledger.num}>{weight.format(r.opening)}</td>
                      <td className={ledger.num}><Grams value={r.receipt} /></td>
                      <td className={ledger.num}><Grams value={-Math.abs(r.issue)} /></td>
                      <td className={ledger.num}>{weight.format(r.closing)}</td>
                      <td className={`${ledger.num} ${r.adjustment === 0 ? ledger.muted : ''}`}>
                        {r.adjustment === 0 ? '—' : money.format(r.adjustment)}
                      </td>
                      <td className={ledger.num}>{money.format(r.closingValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}
        </Section>
      )}

      {data.kind === 'deposits' && (
        <Section>
          {data.rows.length === 0 ? <Empty /> : (
            <Frame>
              <table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '12%' }} /><col style={{ width: '18%' }} />
                  <col style={{ width: '12%' }} /><col style={{ width: '14%' }} />
                  <col style={{ width: '16%' }} /><col style={{ width: '28%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('journal.date')}</th>
                    <th>{t('rep.partner')}</th>
                    <th>{t('inv.goldType')}</th>
                    <th className={ledger.num}>{t('inv.gram')}</th>
                    <th className={ledger.num}>{t('rep.amount')}</th>
                    <th>{t('rep.settled')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={`${r.date}-${i}`} className={r.settledBy ? ledger.aside : undefined}>
                      <td>{r.date}</td>
                      <td>{r.partner ?? '—'}</td>
                      <td>{r.gold}</td>
                      <td className={ledger.num}>{weight.format(Math.abs(r.gram))}</td>
                      <td className={ledger.num}>{money.format(r.amount)}</td>
                      {/* Outstanding is the state worth seeing, so a deposit
                          nobody has collected against reads loud and a settled
                          one reads quiet. */}
                      <td>
                        {r.settledBy
                          ? <span className={ledger.muted}>{r.settledBy} · {r.settledDate}</span>
                          : <span className={ledger.out}>{t('rep.outstanding')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}
        </Section>
      )}

      {data.kind === 'apar' && (
        <Section>
          {data.rows.length === 0 ? <Empty /> : (
            <Frame>
              <table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '24%' }} /><col style={{ width: '16%' }} />
                  <col style={{ width: '15%' }} /><col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} /><col style={{ width: '15%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('rep.partner')}</th>
                    <th>{t('rep.account')}</th>
                    <th className={ledger.num}>{t('rep.opening')}</th>
                    <th className={ledger.num}>{t('journal.debit')}</th>
                    <th className={ledger.num}>{t('journal.credit')}</th>
                    <th className={ledger.num}>{t('rep.closing')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={`${r.partner}-${r.account}`}>
                      <td>{r.partner}</td>
                      <td className={ledger.muted}>{r.account}</td>
                      <td className={ledger.num}>{money.format(r.opening)}</td>
                      <td className={ledger.num}>{money.format(r.debit)}</td>
                      <td className={ledger.num}>{money.format(r.credit)}</td>
                      <td className={ledger.num}><Signed value={r.closing} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}
        </Section>
      )}

      {data.kind === 'vendor' && (
        <Section>
          {data.rows.length === 0 ? <Empty /> : (
            <Frame>
              <table className={ledger.table}>
                <colgroup>
                  <col style={{ width: '28%' }} /><col style={{ width: '16%' }} />
                  <col style={{ width: '18%' }} /><col style={{ width: '19%' }} />
                  <col style={{ width: '19%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t('rep.partner')}</th>
                    <th>{t('inv.goldType')}</th>
                    <th className={ledger.num}>{t('txn.col.qty')}</th>
                    <th className={ledger.num}>{t('rep.purchased')}</th>
                    <th className={ledger.num}>{t('cash.outstanding')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr key={`${r.partner}-${r.gold}-${i}`}>
                      <td>{r.partner}</td>
                      <td>{r.gold}</td>
                      <td className={ledger.num}>{weight.format(r.qty)}</td>
                      <td className={ledger.num}>{money.format(r.purchased)}</td>
                      <td className={`${ledger.num} ${r.outstanding > 0 ? ledger.out : ledger.muted}`}>
                        {money.format(r.outstanding)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
          )}
        </Section>
      )}
    </Page>
  )
}
