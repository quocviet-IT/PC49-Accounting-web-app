'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Grams, ledger } from '@/components/ledger/Ledger'

export type StockRow = {
  code: string
  nameVi: string
  nameEn: string
  uom: string
  book: number
  physical: number
  total: number
}

export function InventoryView({ rows }: { rows: StockRow[] }) {
  const { locale, t } = useLocale()
  const shown = rows.filter((r) => r.book !== 0 || r.physical !== 0 || r.total !== 0)
  const sum = (k: 'book' | 'physical' | 'total') => shown.reduce((s, r) => s + r[k], 0)

  return (
    <Page titleKey="inv.title" noteKey="inv.explain">
      <Section>
        {shown.length === 0 ? <Empty /> : (
          <table className={ledger.table}>
            <thead>
              <tr>
                <th>{t('inv.goldType')}</th>
                <th>{t('inv.native')}</th>
                <th className={ledger.num}>{t('inv.book')}</th>
                <th className={ledger.num}>{t('inv.physical')}</th>
                <th className={ledger.num}>{t('inv.total')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.code}>
                  <td>{locale === 'vi' ? r.nameVi : r.nameEn}</td>
                  <td className={ledger.muted}>{r.uom}</td>
                  <td className={ledger.num}><Grams value={r.book} /></td>
                  <td className={ledger.num}><Grams value={r.physical} /></td>
                  <td className={ledger.num}><Grams value={r.total} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{t('common.total')} ({t('inv.gram')})</td>
                <td className={ledger.num}><Grams value={sum('book')} /></td>
                <td className={ledger.num}><Grams value={sum('physical')} /></td>
                <td className={ledger.num}><Grams value={sum('total')} /></td>
              </tr>
            </tfoot>
          </table>
        )}
      </Section>
    </Page>
  )
}
