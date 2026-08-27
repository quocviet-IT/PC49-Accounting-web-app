'use client'
import Link from 'next/link'
import { Layout, Menu, Space, Typography } from 'antd'
import type { Role } from '@/lib/auth/roles'
import { navItemsFor } from '@/lib/nav'
import { useLocale } from '@/lib/i18n/provider'
import { LocaleSwitch } from '@/components/LocaleSwitch'

export function AppShell({ role, children }: { role: Role | null; children: React.ReactNode }) {
  const { t } = useLocale()
  const items = navItemsFor(role).map((i) => ({
    key: i.key,
    label: <Link href={i.href}>{t(i.labelKey)}</Link>,
  }))

  return (
    <Layout style={{ minHeight: '100dvh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Typography.Text strong style={{ color: '#fff' }}>{t('app.name')}</Typography.Text>
        <Menu theme="dark" mode="horizontal" items={items} style={{ flex: 1, minWidth: 0 }} />
        <Space><LocaleSwitch /></Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
    </Layout>
  )
}
