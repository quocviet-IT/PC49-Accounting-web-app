'use client'

import { describeThrew, isThrew, settleAction } from '@/lib/ui/settleAction'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Frame, ledger, LoadFailed } from '@/components/ledger/Ledger'
import { markFeedbackSeen, triageReport } from '@/app/(app)/feedback/actions'
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
  /** A link that expires, or null when no picture was sent or it has gone. */
  screenshotUrl: string | null
  /** Whether this reader filed it, which is what makes the list personal. */
  mine: boolean
  /** When its status last moved; null while it has not. */
  changedAt: string | null
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
  rows, status, counts, canTriage, seenAt, loadFailed = false,
}: {
  rows: ReportRow[]
  status: string | null
  counts: Record<string, number>
  canTriage: boolean
  /**
   * When this reader last opened the screen, read before this visit marks it
   * (0088): their reports that moved since then are marked as updated. Null or
   * "-infinity" is never; absent is unknown, which marks nothing.
   */
  seenAt?: string | null
  /**
   * The queue did not arrive. An empty queue means every report has been dealt
   * with — which is the one thing this screen must not say wrongly, since it
   * is where somebody comes to check that what they reported was not lost.
   */
  loadFailed?: boolean
}) {
  const { t } = useLocale()
  const router = useRouter()

  // Opening this screen is looking at it: marked once, then the shell is read
  // again so the badge on the menu goes out at once (spec 2026-09-18).
  const marked = useRef(false)
  useEffect(() => {
    if (marked.current) return
    marked.current = true
    void markFeedbackSeen().then((r) => { if (r.ok) router.refresh() })
  }, [router])

  /** When the reader last looked: never is -Infinity, unknown is +Infinity. */
  const since = seenAt === undefined ? Infinity
    : seenAt === null || Number.isNaN(Date.parse(seenAt)) ? -Infinity : Date.parse(seenAt)
  /** The reader's own report, moved since they last looked. */
  const updated = (r: ReportRow) =>
    r.mine && r.changedAt !== null && Date.parse(r.changedAt) > since

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
        {loadFailed ? <LoadFailed /> : rows.length === 0 ? <Empty /> : (
          <Frame>
            <table className={`${ledger.table} ${styles.queueTable}`}>
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
                      {r.screenshotUrl && (
                        <>
                          <br />
                          {/* And the page as it was, which the address alone
                              cannot show: which row was selected, what the
                              figure read, what was greyed out. */}
                          <a href={r.screenshotUrl} target="_blank" rel="noreferrer">
                            {t('fb.shotOnReport')}
                          </a>
                        </>
                      )}
                    </td>
                    <td>
                      {canTriage
                        ? <Triage id={r.id} status={r.status} />
                        : <span className={ledger.badge}>
                            {t(`fb.status.${r.status}` as never)}
                          </span>}
                      {updated(r) && (
                        <>
                          <br />
                          <span className={styles.updated}>{t('fb.updated')}</span>
                        </>
                      )}
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

/**
 * Moving one report on, with a note the reporter will read.
 *
 * The note goes with every status, not only a decline. "Fixed" on its own can
 * say the wrong thing: the first blocking report said transactions typed in on
 * two days were not there afterwards, and what got fixed was the form that let
 * that happen. What its reporter needed to hear was that those two days had to
 * be entered again, and there was nowhere to say it.
 */
function Triage({ id, status }: { id: string; status: string }) {
  const { t } = useLocale()
  const router = useRouter()
  const [next, setNext] = useState(status)
  // Empty, not holding the note already sent. Notes run to a paragraph, and a
  // one-line box showed the first few words of one; the note as the reporter
  // reads it is under what they wrote. Moving the status without typing keeps it.
  const [note, setNote] = useState('')
  // What this box last sent, so leaving it alone does not send it again.
  const [saved, setSaved] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function send(to: string) {
    setError(null)
    const said = note.trim()
    // A decline needs a reason, and the database refuses without one — so
    // nothing is sent until the box is filled.
    if (to === 'DECLINED' && said === '') return
    startTransition(async () => {
      const result = await settleAction(() => triageReport({ id, status: to, note: said || null }))
      if (!result.ok) { setError(isThrew(result) ? describeThrew(result, t) : result.message); return }
      if (said) setSaved(said)
      router.refresh()
    })
  }

  return (
    <span className={styles.triage}>
      <select
        aria-label={t('fb.state')}
        value={next}
        disabled={pending}
        onChange={(e) => { setNext(e.target.value); send(e.target.value) }}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>{t(`fb.status.${s}` as const)}</option>
        ))}
      </select>
      <input
        aria-label={t('fb.note')}
        placeholder={t('fb.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        // An emptied box sends nothing. The database keeps a note it is given no
        // replacement for, so clearing it here would only look like it worked.
        onBlur={() => {
          const said = note.trim()
          if (said !== '' && said !== saved) send(next)
        }}
      />
      {error && <span className={styles.failed}>{error}</span>}
    </span>
  )
}
