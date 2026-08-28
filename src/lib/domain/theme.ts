/**
 * Which theme the app is in, and how that is decided.
 *
 * Three modes, not two. Light and dark are the reader's own choice; "system"
 * defers to the machine and is the default, because most people have already
 * told their operating system which they prefer and should not have to say it
 * again here.
 *
 * The choice is expressed as one attribute on `<html>`. The stylesheet selects
 * dark on `:root[data-theme="dark"]` rather than on a `prefers-color-scheme`
 * media query, and that is the reason why: a media query cannot be overridden
 * by a click. Following the system is done by *writing* `dark` into the
 * attribute, so exactly one thing decides which block applies.
 *
 * Pure: no React, no DOM, no storage API.
 */

export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/** The two themes anything can actually be rendered in. */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'pc49.theme'
export const THEME_ATTRIBUTE = 'data-theme'

/** What `mode` means right now, given what the machine says it prefers. */
export function resolveTheme(mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return mode
}

/**
 * A stored preference, narrowed to something usable. Anything unrecognised
 * means "system": storage is editable by hand and outlives the release that
 * wrote it, and an unreadable preference must not leave the app with no theme.
 */
export function parseThemeMode(stored: string | null | undefined): ThemeMode {
  return THEME_MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : 'system'
}

/**
 * The script that sets the theme before anything is painted.
 *
 * It has to run inline, in the document head, ahead of React — otherwise the
 * first paint is the light theme and a dark reader watches it turn dark a
 * moment later, on every navigation that reloads. That flash is the one thing
 * a theme switch is judged on.
 *
 * Wrapped in try/catch because it runs unguarded: Safari in private mode throws
 * on `localStorage` outright, and a throw here is a blank document rather than
 * a wrong colour.
 */
export function noFlashScript(): string {
  return (
    'try{' +
    `var m=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
    "var d=m==='dark'||((m==null||m==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);" +
    `document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},d?'dark':'light');` +
    '}catch(e){}'
  )
}

/**
 * The preference as a cookie, which is what lets the SERVER know the theme.
 *
 * localStorage never leaves the browser. With only it, the server always
 * renders light and corrects after hydration, so a dark reader watches every
 * reload arrive light. The cookie rides the request and the first
 * server-rendered byte is already right.
 */
export function themeCookie(mode: ThemeMode): string {
  return `${THEME_STORAGE_KEY}=${mode}; Path=/; Max-Age=31536000; SameSite=Lax`
}
