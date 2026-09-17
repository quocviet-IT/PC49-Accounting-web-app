'use client'

import { useLocale } from '@/lib/i18n/provider'
import { money, weight } from '@/components/ledger/Ledger'
import { fineGrams } from './receiptLine'
import type { ReceiptRow } from './types'
import styles from './Txn.module.css'

const fineFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 4,
})

/** The items of one receipt, as they were written on the paper. */
export function ReceiptLines({ row, goldName }: {
  row: ReceiptRow
  goldName: (code: string) => string
}) {
  const { t } = useLocale()
  return (
    <table className={styles.lines}>
      <thead>
        <tr>
          <th className={styles.num}>#</th>
          <th>{t('receipt.itemDesc')}</th>
          <th>{t('txn.col.gold')}</th>
          <th className={styles.num}>{t('txn.col.qty')}</th>
          <th className={styles.num}>{t('txn.col.scrap')}</th>
          <th className={styles.num}>{t('receipt.fine')}</th>
          <th className={styles.num}>{t('receipt.finePrice')}</th>
          <th className={styles.num}>{t('txn.col.price')}</th>
          <th className={styles.num}>{t('txn.col.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {row.lines.map((l) => {
          const fine = fineGrams(l.uom, l.qty, l.gold_pct)
          return (
            <tr key={l.id}>
              <td className={styles.num}>
                {l.side ? `${t(l.side === 'out' ? 'conversion.side.out' : 'conversion.side.in')} ${l.lineNo}` : l.lineNo}
              </td>
              <td>{l.itemDesc ?? '—'}</td>
              <td>{goldName(l.gold_type_code)}{l.scrap_detail ? ` · ${l.scrap_detail}` : ''}</td>
              <td className={styles.num}>{weight.format(l.qty)} {l.uom}</td>
              <td className={styles.num}>{l.gold_pct ?? '—'}</td>
              <td className={styles.num}>{fine === null ? '—' : fineFormat.format(fine)}</td>
              <td className={styles.num}>{fine ? money.format(Math.abs(l.amount) / fine) : '—'}</td>
              <td className={styles.num}>{l.unit_price === null ? '—' : money.format(l.unit_price)}</td>
              <td className={styles.num}>{money.format(l.amount)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
