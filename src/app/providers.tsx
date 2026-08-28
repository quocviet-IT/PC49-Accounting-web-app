'use client'

import { App, ConfigProvider, theme as antdTheme } from 'antd'
import enUS from 'antd/locale/en_US'
import viVN from 'antd/locale/vi_VN'
import { antdThemeTokens } from '@/lib/design/tokens'
import { useTheme } from '@/components/theme/ThemeProvider'
import { useLocale } from '@/lib/i18n/provider'

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

/**
 * App-wide Ant Design context.
 *
 * Every colour comes from lib/design/tokens.ts. A literal here would be a
 * second source of truth for a colour the stylesheet reads from there, and the
 * two drift on the first change nobody remembers to make twice.
 *
 * The theme and the tokens have to move together: `darkAlgorithm` recolours
 * every Ant Design component, while the tokens recolour everything the
 * stylesheet draws. One without the other is a half-converted screen.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()
  const { locale } = useLocale()
  const { token, components } = antdThemeTokens(theme)

  return (
    <ConfigProvider
      locale={locale === 'vi' ? viVN : enUS}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        /*
         * One variable scope per theme.
         *
         * Ant Design renders its component tokens as CSS variables and names
         * the block after a key it derives itself — the same key for both
         * themes. The light block the server emits and the dark block the
         * client emits then land on the identical selector at identical
         * specificity, and whichever is inserted last wins. Which one that is
         * varies by route, for no reason visible in any stylesheet. Distinct
         * keys give the two themes distinct selectors, so insertion order
         * stops mattering.
         */
        cssVar: { key: theme === 'dark' ? 'pc-dark' : 'pc-light' },
        token: { ...token, borderRadius: 8, fontFamily: SANS, fontSize: 14, wireframe: false },
        components: {
          ...components,
          // A dimension rather than a colour, so it stays here with the other
          // non-colour settings. Spreading keeps the colours the tokens set.
          Layout: { ...components.Layout, headerHeight: 56 },
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  )
}
