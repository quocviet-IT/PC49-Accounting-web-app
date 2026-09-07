'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Frame } from '@/components/ledger/Ledger'
import { changeMyPassword } from '@/app/password/actions'
import styles from './Users.module.css'

/**
 * Choosing your own password.
 *
 * Open to everybody, and the only way past the door when an administrator has
 * just issued a temporary one. `forced` changes what the screen says, not what
 * it does: somebody sent here against their will should be told why rather
 * than left wondering what they clicked.
 */
export function PasswordView({ forced }: { forced: boolean }) {
  const { t } = useLocale()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    // Checked here and not on the server, because the server never sees the
    // second box: it exists to catch a typo in the first, which is a question
    // about this form rather than about the account.
    if (password !== again) { setError(t('pw.mismatch')); return }
    startTransition(async () => {
      const result = await changeMyPassword({ password })
      if (!result.ok) { setError(result.message); return }
      setDone(true)
      setPassword(''); setAgain('')
      router.refresh()
      router.push('/')
    })
  }

  return (
    <Page titleKey="pw.title" noteKey={forced ? 'pw.forced' : 'pw.note'}>
      <Section>
        <Frame>
          <div className={styles.form} style={{ padding: 16, flexDirection: 'column',
                                                alignItems: 'flex-start' }}>
            <input
              type="password"
              className={styles.field}
              value={password}
              autoComplete="new-password"
              aria-label={t('pw.new')}
              placeholder={t('pw.new')}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              type="password"
              className={styles.field}
              value={again}
              autoComplete="new-password"
              aria-label={t('pw.again')}
              placeholder={t('pw.again')}
              onChange={(e) => setAgain(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            />
            <button type="button" className={styles.primary} disabled={pending}
                    onClick={submit}>
              {t('pw.save')}
            </button>
            {error && <span className={styles.failed}>{error}</span>}
            {done && <span>{t('pw.done')}</span>}
          </div>
        </Frame>
      </Section>
    </Page>
  )
}
