'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, ledger, Frame, LoadFailed } from '@/components/ledger/Ledger'
import { setPeriodStatus } from '@/app/(app)/settings/actions'
import styles from './Settings.module.css'

export type PeriodRow = {
  period: string
  closed: boolean
  closedAt: string | null
  note: string | null
  posted: number
  draft: number
}

export function PeriodList({ rows, loadFailed = false }: {
  rows: PeriodRow[]
  /**
   * The period states, or the entry counts, did not arrive.
   *
   * A month with no row is open — which is true when the read worked, and a
   * plain falsehood when it did not. Drawing every month as open, each with a
   * Close button beside a count of zero, would tell somebody the books are
   * untouched and safe to sign off.
   */
  loadFailed?: boolean
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggle(row: PeriodRow) {
    setError(null)
    setBusy(row.period)
    startTransition(async () => {
      const result = await setPeriodStatus({ period: row.period, close: !row.closed })
      setBusy(null)
      if (result.ok) router.refresh()
      else setError(`${row.period}: ${result.message}`)
    })
  }

  if (loadFailed) {
    return (
      <Page titleKey="period.title" noteKey="period.note">
        <Section><LoadFailed /></Section>
      </Page>
    )
  }

  return (
    <Page titleKey="period.title" noteKey="period.note">
      <Section>
        <Frame>
<table className={ledger.table}>
            <colgroup>
              <col style={{ width: '16%' }} /><col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} /><col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} /><col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('period.month')}</th>
                <th className={ledger.num}>{t('period.posted')}</th>
                <th className={ledger.num}>{t('period.draft')}</th>
                <th>{t('period.state')}</th>
                <th>{t('period.closedAt')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period} className={r.closed ? styles.closed : undefined}>
                  <td>{r.period}</td>
                  <td className={`${ledger.num} ${r.posted ? '' : ledger.muted}`}>
                    {r.posted || '—'}
                  </td>
                  {/* A draft entry in a month somebody is about to close is worth
                      seeing: closing does not post it, it strands it. */}
                  <td className={`${ledger.num} ${r.draft ? ledger.out : ledger.muted}`}>
                    {r.draft || '—'}
                  </td>
                  <td>
                    <span className={ledger.badge}>
                      {t(r.closed ? 'period.closed' : 'period.open')}
                    </span>
                  </td>
                  <td className={ledger.muted}>
                    {r.closedAt ? r.closedAt.slice(0, 10) : '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.quiet}
                      disabled={busy === r.period}
                      onClick={() => toggle(r)}
                    >
                      {t(r.closed ? 'period.reopen' : 'period.close')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
        {error && <p className={styles.failed}>{error}</p>}
      </Section>
    </Page>
  )
}
