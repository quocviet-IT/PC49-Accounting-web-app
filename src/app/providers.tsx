'use client'

import { App, ConfigProvider, theme as antdTheme } from 'antd'
import enUS from 'antd/locale/en_US'
import viVN from 'antd/locale/vi_VN'
import { antdThemeTokens } from '@/lib/design/tokens'
import { antdThemeConfig } from '@/lib/design/antdTheme'
import { useTheme } from '@/components/theme/ThemeProvider'
import { useLocale } from '@/lib/i18n/provider'

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
  // Shared with scripts/antd-css.mjs, which writes the stylesheet these
  // settings are painted with; two copies would drift.
  const config = antdThemeConfig(theme, antdThemeTokens(theme))

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
        cssVar: config.cssVar,
        /*
         * Components take their styles from the stylesheet scripts/antd-css.mjs
         * writes (linked in layout.tsx) instead of writing them while they render. The writing cost every server render
         * about a hundred milliseconds on the ledger (15-09) and put some 370 KB
         * of CSS into every page. The theme's variables are still written at
         * runtime, so the palette and the dark theme behave as before.
         */
        zeroRuntime: true,
        token: config.token,
        components: config.components,
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  )
}
