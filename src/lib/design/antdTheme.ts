import type { ResolvedTheme } from './tokens'

/** The font stack every Ant Design component is told to use. */
export const ANTD_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

type Tokens = { token: object; components: { Layout: object } }

/**
 * Everything Ant Design is told about one theme, bar its algorithm.
 *
 * Shared by the providers, which theme the app as it runs, and by
 * scripts/antd-css.mjs, which writes the stylesheet the components read in
 * zero-runtime mode. Two copies would drift, and a stylesheet generated from a
 * theme the app no longer uses paints the wrong colours without any error.
 *
 * The cssVar key differs by theme on purpose; providers.tsx says why.
 */
export function antdThemeConfig<T extends Tokens>(theme: ResolvedTheme, tokens: T) {
  return {
    cssVar: { key: theme === 'dark' ? 'pc-dark' : 'pc-light' },
    // No hash class in the selectors. The stylesheet is written once, by a
    // script that is neither the development server nor the production build,
    // and has to match the page in both; a hash is only there to keep two
    // copies of antd on one page apart, and this app has one.
    hashed: false,
    token: { ...tokens.token, borderRadius: 8, fontFamily: ANTD_FONT, fontSize: 14, wireframe: false },
    components: {
      ...tokens.components,
      // A dimension rather than a colour, so it lives here with the other
      // non-colour settings. Spreading keeps the colours the tokens set.
      Layout: { ...tokens.components.Layout, headerHeight: 56 },
    },
  }
}
