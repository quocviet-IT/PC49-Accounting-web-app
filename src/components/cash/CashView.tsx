'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Signed, money, ledger, Frame } from '@/components/ledger/Ledger'
import { StatementImport } from './StatementImport'

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
  period, rows, unmatched,
}: { period: string; rows: AccountRow[]; unmatched: number }) {
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
          <p className={ledger.note}><span className={ledger.badge}>{unmatched}</span></p>
        </Section>
      )}
    </Page>
  )
}
