'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Signed, money, weight, ledger } from '@/components/ledger/Ledger'

export type PlLine = {
  code: string
  nameVi: string
  nameEn: string
  kind: 'ACCOUNTS' | 'SUBTOTAL' | 'DIFFERENCE'
  indent: number
  amount: number
}

export type AparLine = {
  partnerCode: string
  accountCode: string
  opening: number
  closing: number
}

export type Assets = {
  inventoryGram: number
  inventoryValue: number
  receivable: number
  payable: number
  cash: number
  bank: number
  total: number
}

export function ReportsView({
  period, pl, apar, assets,
}: { period: string; pl: PlLine[]; apar: AparLine[]; assets: Assets | null }) {
  const { locale, t } = useLocale()
  const name = (l: PlLine) => (locale === 'vi' ? l.nameVi : l.nameEn)

  return (
    <Page titleKey="rep.title">
      <p className={ledger.note}>{t('common.period')}: {period}</p>

      <Section titleKey="rep.pl">
        {pl.length === 0 ? <Empty /> : (
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
                  something different here than everywhere else in the app. */}
              {pl.map((l) => (
                <tr key={l.code} className={l.kind === 'ACCOUNTS' ? ledger.aside : undefined}>
                  <td style={{ paddingLeft: l.indent * 18 }}>{name(l)}</td>
                  <td className={ledger.num}>
                    {l.kind === 'DIFFERENCE'
                      ? <strong><Signed value={l.amount} /></strong>
                      : l.kind === 'SUBTOTAL'
                        ? <strong>{money.format(l.amount)}</strong>
                        : money.format(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {assets && (
        <Section titleKey="rep.assets">
          <table className={ledger.table}>
            <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
            <tbody>
              <tr>
                <td>{t('rep.inventoryValue')} <span className={ledger.muted}>
                  ({weight.format(assets.inventoryGram)} g)</span></td>
                <td className={ledger.num}>{money.format(assets.inventoryValue)}</td>
              </tr>
              <tr>
                <td>{t('rep.receivable')}</td>
                <td className={ledger.num}>{money.format(assets.receivable)}</td>
              </tr>
              <tr>
                <td>{t('rep.payable')}</td>
                <td className={ledger.num}><Signed value={-assets.payable} /></td>
              </tr>
              <tr>
                <td>{t('rep.cash')}</td>
                <td className={ledger.num}>{money.format(assets.cash)}</td>
              </tr>
              <tr>
                <td>{t('rep.bank')}</td>
                <td className={ledger.num}>{money.format(assets.bank)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>{t('rep.cashFlowTotal')}</td>
                <td className={ledger.num}><Signed value={assets.total} /></td>
              </tr>
            </tfoot>
          </table>
        </Section>
      )}

      <Section titleKey="rep.apar">
        {apar.length === 0 ? <Empty /> : (
          <table className={ledger.table}>
            <thead>
              <tr>
                <th>{t('rep.partner')}</th>
                <th>{t('rep.account')}</th>
                <th className={ledger.num}>{t('rep.opening')}</th>
                <th className={ledger.num}>{t('rep.closing')}</th>
              </tr>
            </thead>
            <tbody>
              {apar.map((r) => (
                <tr key={`${r.partnerCode}-${r.accountCode}`}>
                  <td>{r.partnerCode}</td>
                  <td className={ledger.muted}>{r.accountCode}</td>
                  <td className={ledger.num}>{money.format(r.opening)}</td>
                  <td className={ledger.num}><Signed value={r.closing} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </Page>
  )
}
