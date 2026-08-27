'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, Card, Form, Input } from 'antd'
import { createBrowserSupabase } from '@/lib/supabase/client'
import { useLocale } from '@/lib/i18n/provider'
import { LocaleSwitch } from '@/components/LocaleSwitch'

export default function LoginPage() {
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
      setError(t('auth.failed'))
      return
    }
    router.replace('/')
    router.refresh()
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', padding: 24 }}>
      <Card title={t('app.name')} extra={<LocaleSwitch />} style={{ width: 360 }}>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label={t('auth.email')} rules={[{ required: true, type: 'email' }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label={t('auth.password')} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block>
            {t('auth.signIn')}
          </Button>
        </Form>
      </Card>
    </div>
  )
}
