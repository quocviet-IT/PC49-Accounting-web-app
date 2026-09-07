'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, Form, Input } from 'antd'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/provider'
import { LocaleSwitch } from '@/components/LocaleSwitch'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import styles from './Login.module.css'

/**
 * Says why somebody is back here, when there is a why.
 *
 * An account closed while its holder was working ends their session, and they
 * arrive at the sign-in page mid-task. Without this they try their own
 * password, watch it fail, and conclude they have forgotten it.
 */
function WhyBack() {
  const { t } = useLocale()
  const params = useSearchParams()
  if (params.get('closed') !== '1') return null
  return <span className={styles.error} role="status">{t('auth.accountClosed')}</span>
}

function LoginForm() {
  const { t } = useLocale()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onFinish(values: { email: string; password: string }) {
    setLoading(true)
    setError(null)
    const supabase = createBrowserSupabase()
    const { error } = await supabase.auth.signInWithPassword(values)
    setLoading(false)
    if (error) {
      // One message whether the email is unknown or the password is wrong:
      // saying which would tell a stranger that an address is real.
      setError(t('auth.failed'))
      return
    }
    router.replace('/')
    router.refresh()
  }

  return (
    <main className={styles.page}>
      <section className={styles.cover}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">49</span>
          <span>
            <span className={styles.name}>{t('app.name')}</span>
            <br />
            <span className={styles.tagline}>{t('app.tagline')}</span>
          </span>
        </div>

        <p className={styles.pitch}>{t('auth.pitch')}</p>

      </section>

      <section className={styles.side}>
        <div className={styles.tools}>
          <ThemeToggle />
          <LocaleSwitch />
        </div>

        <div className={styles.form}>
          <h1 className={styles.heading}>{t('auth.signIn')}</h1>
          <p className={styles.lede}>{t('auth.lede')}</p>

          {error && <span className={styles.error} role="alert">{error}</span>}
          {/* Suspense because reading the query string opts the page into
              client-side rendering, and the form should not wait on it. */}
          <Suspense fallback={null}><WhyBack /></Suspense>

          {/* Every field here is required, so Ant's asterisk marks nothing. */}
          <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="email"
              label={t('auth.email')}
              /*
               * Trimmed before it is judged.
               *
               * An address pasted out of an email or a chat message arrives with
               * a space on the end more often than not, and refusing it as "not
               * an email" is both wrong and impossible to act on — the space is
               * invisible. Normalising runs before validation, so the rule sees
               * what the person meant.
               */
              normalize={(value?: string) => value?.trim()}
              rules={[{ required: true, type: 'email', message: t('auth.emailNeeded') }]}
            >
              <Input autoComplete="email" autoFocus size="large" inputMode="email" />
            </Form.Item>
            <Form.Item
              name="password"
              label={t('auth.password')}
              rules={[{ required: true, message: t('auth.passwordNeeded') }]}
            >
              <Input.Password autoComplete="current-password" size="large" />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              size="large"
              block
              className={styles.submit}
            >
              {t('auth.signIn')}
            </Button>
          </Form>
        </div>
      </section>
    </main>
  )
}

export default function LoginPage() {
  return <LoginForm />
}
