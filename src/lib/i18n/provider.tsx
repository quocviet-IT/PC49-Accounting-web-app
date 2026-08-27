'use client'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { t as translate, type Locale, type MessageKey } from './index'

type Ctx = { locale: Locale; setLocale: (l: Locale) => void; t: (k: MessageKey) => string }
const LocaleContext = createContext<Ctx | null>(null)

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: React.ReactNode
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    document.cookie = `pc49_locale=${next}; path=/; max-age=31536000; samesite=lax`
  }, [])

  const value = useMemo<Ctx>(
    () => ({ locale, setLocale, t: (k) => translate(locale, k) }),
    [locale, setLocale],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): Ctx {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider')
  return ctx
}
