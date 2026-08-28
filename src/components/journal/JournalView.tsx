'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Grams, money, ledger, Frame } from '@/components/ledger/Ledger'

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

export function JournalView({ period, entries }: { period: string; entries: EntryRow[] }) {
  const { t } = useLocale()
  if (entries.length === 0) return <Page titleKey="journal.title"><Empty /></Page>

  const totalDebit = entries.flatMap((e) => e.lines)
    .filter((l) => l.debit).reduce((s, l) => s + l.amount, 0)
  const totalCredit = entries.flatMap((e) => e.lines)
    .filter((l) => l.credit).reduce((s, l) => s + l.amount, 0)

  return (
    <Page titleKey="journal.title">
      <Section>
        <p className={ledger.note}>{t('common.period')}: {period}</p>
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
              {entries.flatMap((e) =>
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
      </Section>
    </Page>
  )
}
