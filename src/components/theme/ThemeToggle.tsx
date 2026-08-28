'use client'

import { Button, Tooltip } from 'antd'
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useTheme } from './ThemeProvider'
import { useLocale } from '@/lib/i18n/provider'
import type { ThemeMode } from '@/lib/domain/theme'

/**
 * One button, three states, cycled in a fixed order.
 *
 * Three buttons on the header bar for a display preference crowds it; a cycle
 * costs at most two clicks to reach any state and the icon always says which
 * one is current. The tooltip names what the next click does, because an icon
 * showing the present state cannot also show the next one.
 */
const ORDER: ThemeMode[] = ['light', 'dark', 'system']

const ICON = {
  light: <SunOutlined />,
  dark: <MoonOutlined />,
  system: <DesktopOutlined />,
}

export function ThemeToggle() {
  const { mode, setMode } = useTheme()
  const { t } = useLocale()
  const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]

  return (
    <Tooltip title={t(`theme.to.${next}` as const)}>
      <Button
        type="text"
        icon={ICON[mode]}
        aria-label={t(`theme.to.${next}` as const)}
        onClick={() => setMode(next)}
      />
    </Tooltip>
  )
}
