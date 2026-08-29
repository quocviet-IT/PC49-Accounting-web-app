'use client'

import { useState, useTransition } from 'react'
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
  const [pending, startTransition] = useTransition()

  function close() {
    setOpen(false)
    setError(null)
    setSent(false)
    setDescription('')
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
      })
      if (!result.ok) { setError(result.message); return }
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
        onClick={() => setOpen(true)}
      />

      <Modal
        open={open}
        onCancel={close}
        title={t('fb.report')}
        footer={null}
        width={520}
      >
        {sent ? (
          <div className={styles.sent}>
            <p className={styles.sentLead}>{t('fb.thanks')}</p>
            <p className={styles.sentNote}>{t('fb.thanksNote')}</p>
            <span className={styles.buttons}>
              <button type="button" className={styles.quiet} onClick={() => setSent(false)}>
                {t('fb.another')}
              </button>
              <button type="button" className={styles.primary} onClick={close}>
                {t('fb.done')}
              </button>
            </span>
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

            {error && <p className={styles.failed}>{error}</p>}

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
          </div>
        )}
      </Modal>
    </>
  )
}
