'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Avatar, Button, Drawer, Dropdown, Grid, Layout, Menu, Tooltip, Typography,
} from 'antd'
import {
  Landmark as BankOutlined, ChartNoAxesCombined as BarChartOutlined, LayoutDashboard as DashboardOutlined,
  CircleDollarSign as DollarOutlined, FlaskConical as ExperimentOutlined, Gem as GoldOutlined,
  ChevronLeft as LeftOutlined, LogOut as LogoutOutlined, Menu as MenuOutlined,
  BookOpen as ReadOutlined, ChevronRight as RightOutlined, MessageCircle as MessageOutlined,
  Settings2 as SettingOutlined, ArrowLeftRight as ShopOutlined, Repeat2 as SwapOutlined,
  NotebookTabs as TableOutlined, UserRound as UserOutlined,
} from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase/client'
import type { Role } from '@/lib/auth/roles'
import { findActiveGroup, findActivePage, isNavGroup, navigationForRole } from '@/lib/nav'
import { useLocale } from '@/lib/i18n/provider'
import { LocaleSwitch } from '@/components/LocaleSwitch'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { ReportDialog } from '@/components/feedback/ReportDialog'

const { Header, Sider, Content } = Layout

/**
 * Icons live here rather than in the nav data, so `lib/nav.ts` stays plain data
 * a unit test can check against the app's routes.
 */
const ICONS: Record<string, ReactNode> = {
  '/': <DashboardOutlined />,
  trading: <GoldOutlined />,
  money: <BankOutlined />,
  books: <TableOutlined />,
  '/settings': <SettingOutlined />,
  '/gold-transactions': <ShopOutlined />,
  '/prices': <DollarOutlined />,
  '/refining': <ExperimentOutlined />,
  '/inventory': <GoldOutlined />,
  '/cash': <BankOutlined />,
  '/bank-conversion': <SwapOutlined />,
  '/journal': <ReadOutlined />,
  '/reports': <BarChartOutlined />,
  '/feedback': <MessageOutlined />,
}

const COLLAPSED_KEY = 'pc49.sidebar-collapsed'
const STORAGE_EVENT = 'pc49:storage'

/**
 * A choice kept in the browser, or null when this browser has never made one.
 *
 * Read the way React wants an external store read. The server has no idea what
 * this browser stored, so it renders "no choice" and the client corrects on
 * hydration — `useSyncExternalStore` makes that correction a single render
 * rather than a cascade. The custom event is because `storage` only fires in
 * *other* tabs, and this one needs to hear its own writes too.
 *
 * Null matters: it is what lets a default depend on the screen while an explicit
 * choice still wins. A flag that read a missing key as false could not tell
 * "never touched the button" from "chose to keep the menu open".
 */
function useStoredChoice(key: string): [boolean | null, (value: boolean) => void] {
  const value = useSyncExternalStore(
    (onChange) => {
      const onCustom = (e: Event) => {
        if ((e as CustomEvent<string>).detail === key) onChange()
      }
      const onStorage = (e: StorageEvent) => { if (e.key === key) onChange() }
      window.addEventListener(STORAGE_EVENT, onCustom)
      window.addEventListener('storage', onStorage)
      return () => {
        window.removeEventListener(STORAGE_EVENT, onCustom)
        window.removeEventListener('storage', onStorage)
      }
    },
    () => {
      try {
        const stored = window.localStorage.getItem(key)
        return stored === null ? null : stored === 'true'
      } catch { return null }
    },
    () => null,
  )

  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(key, String(next))
      window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: key }))
    } catch {
      // Private browsing or a restrictive policy; the preference simply does
      // not persist, which is better than the click doing nothing.
    }
  }, [key])

  return [value, set]
}

/** Whether a media query matches, assuming `onServer` before hydration. */
function useMediaQuery(query: string, onServer: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => onServer,
  )
}

/**
 * Wide enough to keep the menu's labels beside the working area.
 *
 * The transaction list needs 1,136px once no column is squeezed; with the menu
 * open at 236px that fits from about 1,412px. On a 1280 or 1366 laptop the open
 * menu used to leave the list either scrolling sideways or with its customer and
 * remark columns squeezed to a few letters, so below this the menu starts
 * folded to its icons — until somebody opens it, and then it stays open.
 */
const ROOMY = '(min-width: 1440px)'

export function AppShell({
  role, email, children,
}: { role: Role | null; email?: string; children: ReactNode }) {
  const { t } = useLocale()
  const pathname = usePathname()
  const router = useRouter()
  const screens = Grid.useBreakpoint()
  const isMobile = screens.lg === false
  const roomy = useMediaQuery(ROOMY, true)
  const [chosen, setCollapsed] = useStoredChoice(COLLAPSED_KEY)
  // An explicit choice wins; otherwise the screen decides.
  const collapsed = chosen ?? !roomy
  const [drawerOpen, setDrawerOpen] = useState(false)

  const items = useMemo(() => navigationForRole(role), [role])
  const activePage = findActivePage(pathname)
  const activeKey = activePage?.key ?? ''
  const activeGroup = activePage ? findActiveGroup(activePage.key) : undefined

  const menuItems = items.map((item) =>
    isNavGroup(item)
      ? {
          key: item.key,
          icon: ICONS[item.key],
          label: t(item.labelKey),
          children: item.children.map((child) => ({
            key: child.key,
            icon: ICONS[child.key],
            label: <Link href={child.key}>{t(child.labelKey)}</Link>,
          })),
        }
      : {
          key: item.key,
          icon: ICONS[item.key],
          label: <Link href={item.key}>{t(item.labelKey)}</Link>,
        },
  )

  async function signOut() {
    await createBrowserSupabase().auth.signOut()
    router.refresh()
    router.push('/login')
  }

  const nav = (onNavigate?: () => void) => (
    <Menu
      aria-label={t('nav.primary')}
      className="pc-shell__nav"
      key={`${activeGroup ?? 'root'}-${collapsed ? 'folded' : 'open'}`}
      theme="dark"
      mode="inline"
      inlineIndent={18}
      selectedKeys={[activeKey]}
      defaultOpenKeys={activeGroup ? [activeGroup] : []}
      onClick={onNavigate}
      items={menuItems}
    />
  )

  return (
    <Layout className="pc-shell">
      <a className="pc-skip-link" href="#main">{t('nav.skip')}</a>

      {!isMobile && (
        <Sider
          collapsible
          collapsed={collapsed}
          collapsedWidth={72}
          trigger={null}
          theme="dark"
          width={236}
          className="pc-shell__sider"
        >
          <div className="pc-shell__sidebar-frame">
            <Brand collapsed={collapsed} />
            <div className="pc-shell__nav-scroll">{nav()}</div>
            <div className="pc-shell__sidebar-footer">
              <Tooltip title={collapsed ? t('nav.expand') : ''} placement="right">
                <Button
                  type="text"
                  className="pc-shell__collapse"
                  icon={collapsed ? <RightOutlined /> : <LeftOutlined />}
                  aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed(!collapsed)}
                >
                  {!collapsed && <span>{t('nav.collapse')}</span>}
                </Button>
              </Tooltip>
            </div>
          </div>
        </Sider>
      )}

      <Drawer
        title={<Brand collapsed={false} />}
        placement="left"
        open={isMobile && drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{ wrapper: { width: 280 },
                  body: { padding: 0, background: 'var(--pc-surface-sider)' },
                  header: { background: 'var(--pc-surface-sider)',
                            borderBottom: '1px solid var(--pc-chrome-border)' } }}
      >
        {nav(() => setDrawerOpen(false))}
      </Drawer>

      <Layout className="pc-shell__workspace">
        <Header className="pc-shell__header">
          {isMobile && (
            <Button
              type="text"
              icon={<MenuOutlined />}
              aria-label={t('nav.open')}
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            />
          )}
          <span className="pc-shell__header-title">
            {activePage ? t(activePage.labelKey) : t('app.name')}
          </span>

          <div className="pc-shell__header-end">
            <ReportDialog />
            <ThemeToggle />
            <LocaleSwitch />
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'identity',
                    disabled: true,
                    label: (
                      <div>
                        <Typography.Text strong>{email ?? '—'}</Typography.Text>
                        {role && <><br /><Typography.Text type="secondary">{role}</Typography.Text></>}
                      </div>
                    ),
                  },
                  { type: 'divider' as const },
                  {
                    key: 'sign-out',
                    icon: <LogoutOutlined />,
                    label: t('auth.signOut'),
                    danger: true,
                    onClick: signOut,
                  },
                ],
              }}
            >
              <Button type="text" className="pc-shell__account" aria-label={t('auth.account')}>
                <Avatar size={28} icon={<UserOutlined />} />
                {!isMobile && (
                  <span className="pc-shell__account-identity" aria-hidden="true">
                    <span className="pc-shell__account-email">{email ?? '—'}</span>
                    {role && <span className="pc-shell__account-role">{role}</span>}
                  </span>
                )}
              </Button>
            </Dropdown>
          </div>
        </Header>

        <Content id="main" tabIndex={-1} className="pc-shell__content">
          <div className="pc-shell__content-inner">{children}</div>
        </Content>
      </Layout>
    </Layout>
  )
}

function Brand({ collapsed }: { collapsed: boolean }) {
  const { t } = useLocale()
  return (
    <Link
      href="/"
      aria-label={t('app.name')}
      className={`pc-shell__brand${collapsed ? ' pc-shell__brand--collapsed' : ''}`}
    >
      <span className="pc-shell__brand-mark" aria-hidden="true">49</span>
      {!collapsed && (
        <span className="pc-shell__brand-copy">
          <span className="pc-shell__brand-name">{t('app.name')}</span>
          <span className="pc-shell__brand-sub">{t('app.tagline')}</span>
        </span>
      )}
    </Link>
  )
}
