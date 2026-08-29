'use client'

import { useCallback, useState, useTransition } from 'react'
import { usePathname } from 'next/navigation'
import { Button, Modal } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { findActivePage } from '@/lib/nav'
import { useLocale } from '@/lib/i18n/provider'
import { fileReport } from '@/app/(app)/feedback/actions'
import styles from './Feedback.module.css'

const KINDS = ['BROKEN', 'WRONG_NUMBER', 'SUGGESTION'] as const
const IMPACTS = ['BLOCKING', 'SLOWS_WORK', 'MINOR'] as const

/**
 * Reporting a problem from wherever you hit it.
 *
 * Reachable from every screen, because the moment somebody notices a figure is
 * wrong is the moment they can still say which figure and on which day. A form
 * behind a menu, filled in later, produces "the gold page was strange
 * yesterday".
 *
 * The page is captured rather than asked for: what a reporter would write is
 * never the address that reproduces it.
 */
export function ReportDialog() {
  const { t } = useLocale()
  const pathname = usePathname()
  // What the screen is called in the menu. `document.title` is the application
  // name on every page, so a queue built from it reads "PC49" all the way down.
  const page = findActivePage(pathname)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<(typeof KINDS)[number]>('BROKEN')
  const [impact, setImpact] = useState<(typeof IMPACTS)[number]>('SLOWS_WORK')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [sentNote, setSentNote] = useState<string | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const [includeShot, setIncludeShot] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [pending, startTransition] = useTransition()

  /**
   * A picture of the page as the reporter had it.
   *
   * The address already travels with a report, so somebody can reopen the same
   * view. It does not show what was on it — which row was selected, what the
   * figure actually read, whether a button was greyed out — and that is usually
   * the difference between a report somebody can act on and one they cannot.
   */
  const capture = useCallback(async () => {
    setCapturing(true)
    try {
      // Loaded when somebody reports, not on every page. It is a large library
      // and nobody who is not filing a report needs it.
      const { domToPng } = await import('modern-screenshot')
      // Leave the reporting furniture out of it. A picture of the dialog
      // covering the screen tells whoever reads it nothing.
      const CHROME = '.ant-modal-root, .ant-message, .ant-notification'
      setShot(await domToPng(document.body, {
        scale: 0.6,
        // Parts of the page paint no background of their own, and a capture
        // with holes in it reads as a broken screen rather than a real one.
        backgroundColor: getComputedStyle(document.body).backgroundColor,
        filter: (node) => !(node instanceof Element && node.matches(CHROME)),
      }))
    } catch {
      // A capture that fails must not stop the report. The words are what
      // matter; the picture is what helps.
      setShot(null)
    } finally {
      setCapturing(false)
    }
  }, [])

  function open_() {
    setOpen(true)
    setShot(null)
    setIncludeShot(true)
    // Captured as the dialog opens, before it has painted over the page.
    void capture()
  }

  function close() {
    setOpen(false)
    setError(null)
    setSent(false)
    setSentNote(null)
    setDescription('')
    setShot(null)
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await fileReport({
        kind,
        impact,
        description,
        // The whole address, including the day or filter being looked at.
        pageUrl: typeof window === 'undefined' ? pathname
          : window.location.pathname + window.location.search,
        pageRoute: pathname,
        pageTitle: page ? t(page.labelKey) : undefined,
        screenshot: includeShot ? shot : null,
      })
      if (!result.ok) { setError(result.message); return }
      // Said plainly either way. A reporter who believes a picture went with
      // their report, when none did, is worse off than one who knows.
      setSentNote(
        result.screenshotStored ? t('fb.withShot')
          : result.screenshotProblem ? `${t('fb.noShot')} ${result.screenshotProblem}`
          : null,
      )
      setSent(true)
      setDescription('')
    })
  }

  return (
    <>
      <Button
        type="text"
        icon={<WarningOutlined />}
        aria-label={t('fb.report')}
        title={t('fb.report')}
        onClick={open_}
      />

      <Modal
        open={open}
        onCancel={close}
        title={t('fb.report')}
        // In the footer rather than the body: the body scrolls once a picture
        // is in it, and the button that sends the report was scrolling out of
        // reach on a laptop screen.
        footer={sent ? (
          <span className={styles.buttons}>
            <button type="button" className={styles.quiet} onClick={() => setSent(false)}>
              {t('fb.another')}
            </button>
            <button type="button" className={styles.primary} onClick={close}>
              {t('fb.done')}
            </button>
          </span>
        ) : (
          <span className={styles.buttons}>
            <button type="button" className={styles.quiet} onClick={close} disabled={pending}>
              {t('refining.cancel')}
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={submit}
              disabled={pending || description.trim().length < 5}
            >
              {pending ? t('fb.sending') : t('fb.send')}
            </button>
          </span>
        )}
        width={520}
        // The picture makes this dialog tall enough to run off a laptop screen,
        // and the button that sends the report is at the bottom. Scroll the
        // contents rather than pushing Send out of reach.
        styles={{ body: { maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' } }}
      >
        {sent ? (
          <div className={styles.sent}>
            <p className={styles.sentLead}>{t('fb.thanks')}</p>
            <p className={styles.sentNote}>{t('fb.thanksNote')}</p>
            {sentNote && <p className={styles.sentNote}>{sentNote}</p>}
          </div>
        ) : (
          <div className={styles.form}>
            <fieldset className={styles.choice}>
              <legend className={styles.legend}>{t('fb.whatKind')}</legend>
              {KINDS.map((k) => (
                <label key={k} className={styles.option}>
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                  />
                  {t(`fb.kind.${k}` as const)}
                </label>
              ))}
            </fieldset>

            <fieldset className={styles.choice}>
              <legend className={styles.legend}>{t('fb.howBad')}</legend>
              {IMPACTS.map((i) => (
                <label key={i} className={styles.option}>
                  <input
                    type="radio"
                    name="impact"
                    value={i}
                    checked={impact === i}
                    onChange={() => setImpact(i)}
                  />
                  {t(`fb.impact.${i}` as const)}
                </label>
              ))}
            </fieldset>

            <label className={styles.field}>
              <span className={styles.legend}>{t('fb.whatHappened')}</span>
              <textarea
                className={styles.textarea}
                rows={5}
                value={description}
                placeholder={t('fb.placeholder')}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            {/* Shown rather than asked for, so the reporter can see that the
                page goes with the report and does not have to describe it. */}
            <p className={styles.context}>
              {t('fb.fromPage')}: <code>{page ? t(page.labelKey) : pathname}</code>
            </p>

            {/* The picture, shown before it is sent. Nobody should have to
                guess what they are attaching to a report that will be read by
                somebody else. */}
            {/* The choice and the warning come before the picture, not after
                it. On a laptop screen the picture is tall enough to push
                whatever follows it below the fold, and what follows it was the
                sentence saying the picture holds customer names and amounts. */}
            <div className={styles.shot}>
              {capturing && <p className={styles.shotNote}>{t('fb.capturing')}</p>}
              {!capturing && !shot && (
                <p className={styles.shotNote}>{t('fb.shotFailed')}</p>
              )}
              {shot && (
                <label className={styles.shotToggle}>
                  <input
                    type="checkbox"
                    checked={includeShot}
                    onChange={(e) => setIncludeShot(e.target.checked)}
                  />
                  {t('fb.includeShot')}
                </label>
              )}
              {shot && includeShot && (
                <p className={styles.shotWarning}>{t('fb.shotPrivacy')}</p>
              )}
              {!capturing && shot && includeShot && (
                // A data URL held in this browser's memory, never fetched and
                // never served. next/image optimises what it can request from a
                // URL, which is nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shot} alt={t('fb.shotAlt')} className={styles.shotImage} />
              )}
            </div>

            {error && <p className={styles.failed}>{error}</p>}

          </div>
        )}
      </Modal>
    </>
  )
}
