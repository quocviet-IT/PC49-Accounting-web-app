'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Frame, ledger } from '@/components/ledger/Ledger'
import { triageReport } from '@/app/(app)/feedback/actions'
import styles from './Feedback.module.css'

export type ReportRow = {
  id: string
  kind: string
  impact: string
  description: string
  status: string
  pageUrl: string
  pageTitle: string | null
  reporterRole: string | null
  triageNote: string | null
  createdAt: string
  /** Whether this reader filed it, which is what makes the list personal. */
  mine: boolean
}

const STATUSES = ['NEW', 'LOOKING', 'FIXED', 'DECLINED'] as const

/**
 * What has been reported, and what happened to it.
 *
 * The same screen for everybody, showing different rows: a reporter sees their
 * own and an administrator sees the queue. That is deliberate — the reason
 * people stop filing reports is never that filing is hard, it is that nothing
 * visibly happens to what they filed.
 */
export function FeedbackQueue({
  rows, status, counts, canTriage,
}: {
  rows: ReportRow[]
  status: string | null
  counts: Record<string, number>
  canTriage: boolean
}) {
  const { t } = useLocale()

  return (
    <Page titleKey="fb.queue" noteKey={canTriage ? 'fb.queueNote' : 'fb.mineNote'}>
      <nav className={styles.queueTabs}>
        <Link
          href="/feedback"
          className={`${styles.tab} ${status === null ? styles.tabOn : ''}`}
        >
          {t('fb.all')}
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/feedback?status=${s}`}
            className={`${styles.tab} ${status === s ? styles.tabOn : ''}`}
          >
            {t(`fb.status.${s}` as const)}
            {counts[s] ? ` · ${counts[s]}` : ''}
          </Link>
        ))}
      </nav>

      <Section>
        {rows.length === 0 ? <Empty /> : (
          <Frame>
            <table className={ledger.table}>
              <colgroup>
                <col style={{ width: '12%' }} /><col style={{ width: '19%' }} />
                <col style={{ width: '32%' }} /><col style={{ width: '15%' }} />
                <col style={{ width: '22%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{t('journal.date')}</th>
                  <th>{t('fb.whatKind')}</th>
                  <th>{t('fb.whatHappened')}</th>
                  <th>{t('fb.fromPage')}</th>
                  <th>{t('fb.state')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.createdAt.slice(0, 10)}</td>
                    <td className={ledger.wrap}>
                      {t(`fb.kind.${r.kind}` as never)}
                      <br />
                      {/* Blocking is the one that stops somebody working. */}
                      <span className={r.impact === 'BLOCKING' ? styles.blocking : styles.minor}>
                        {t(`fb.impact.${r.impact}` as never)}
                      </span>
                    </td>
                    <td className={ledger.wrap}>
                      {r.description}
                      {r.triageNote && (
                        <>
                          <br />
                          <span className={ledger.muted}>↳ {r.triageNote}</span>
                        </>
                      )}
                    </td>
                    <td className={ledger.muted}>
                      {/* A link, because the first thing anybody reading a
                          report wants is to be looking at what the reporter
                          was looking at. */}
                      <Link href={r.pageUrl}>{r.pageTitle ?? r.pageUrl}</Link>
                    </td>
                    <td>
                      {canTriage
                        ? <Triage id={r.id} status={r.status} />
                        : <span className={ledger.badge}>
                            {t(`fb.status.${r.status}` as never)}
                          </span>}
                    </td>
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

/** Moving one report on, with the reason a decline needs. */
function Triage({ id, status }: { id: string; status: string }) {
  const { t } = useLocale()
  const router = useRouter()
  const [next, setNext] = useState(status)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function move(to: string) {
    setNext(to)
    setError(null)
    // A decline needs a reason, and the database refuses without one — so the
    // box appears and nothing is sent until it is filled.
    if (to === 'DECLINED' && note.trim() === '') return
    startTransition(async () => {
      const result = await triageReport({ id, status: to, note: note || null })
      if (!result.ok) { setError(result.message); return }
      router.refresh()
    })
  }

  return (
    <span className={styles.triage}>
      <select
        aria-label={t('fb.state')}
        value={next}
        disabled={pending}
        onChange={(e) => move(e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{t(`fb.status.${s}` as const)}</option>
        ))}
      </select>
      {(next === 'DECLINED' || note !== '') && (
        <input
          aria-label={t('fb.note')}
          placeholder={t('fb.note')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (next === 'DECLINED' && note.trim()) move('DECLINED') }}
        />
      )}
      {error && <span className={styles.failed}>{error}</span>}
    </span>
  )
}
