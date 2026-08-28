'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore,
} from 'react'
import {
  parseThemeMode, resolveTheme, themeCookie, THEME_ATTRIBUTE, THEME_STORAGE_KEY,
  type ResolvedTheme, type ThemeMode,
} from '@/lib/domain/theme'

type ThemeContextValue = {
  /** What the reader chose: light, dark, or follow the machine. */
  mode: ThemeMode
  /** What that means right now. */
  theme: ResolvedTheme
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme was called outside ThemeProvider')
  return value
}

export function ThemeProvider({
  initialMode, children,
}: { initialMode: ThemeMode; children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode)

  // The machine's preference is an external store, not React state: it is read
  // from the browser and changes without us. Subscribing to it directly means
  // somebody whose laptop switches at sunset sees the app follow, and it avoids
  // the cascading render that setting state inside an effect would cause.
  const systemPrefersDark = useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(prefers-color-scheme: dark)')
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    // The server cannot know; the inline head script has already set the
    // attribute correctly by the time this matters.
    () => false,
  )

  const theme = resolveTheme(mode, systemPrefersDark)

  // The attribute is what every stylesheet rule selects on. The inline script
  // in the document head sets it before first paint; this keeps it true after.
  useEffect(() => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
    document.documentElement.style.colorScheme = theme
  }, [theme])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    // Both, and both are needed. Storage is what the no-flash script reads
    // before React exists; the cookie is what lets the server render the right
    // theme in its first byte.
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* private mode */ }
    document.cookie = themeCookie(next)
  }, [])

  // A preference set in another tab should not leave this one disagreeing.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) setModeState(parseThemeMode(event.newValue))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const value = useMemo(() => ({ mode, theme, setMode }), [mode, theme, setMode])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
