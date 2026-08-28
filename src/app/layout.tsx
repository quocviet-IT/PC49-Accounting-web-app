import { AntdRegistry } from '@ant-design/nextjs-registry'
import { cookies } from 'next/headers'
import { LocaleProvider } from '@/lib/i18n/provider'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { Providers } from './providers'
import { noFlashScript, parseThemeMode, THEME_STORAGE_KEY } from '@/lib/domain/theme'
import type { Locale } from '@/lib/i18n'
import './globals.css'

export const metadata = {
  title: 'PC49',
  description: 'Pacific Four Nine — gold trading and accounting',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const locale = (cookieStore.get('pc49_locale')?.value === 'en' ? 'en' : 'vi') as Locale
  // The theme from the cookie the toggle writes. This is what lets the FIRST
  // server-rendered byte carry the right palette; without it a dark reader
  // watches every reload arrive light and turn dark once React catches up.
  const mode = parseThemeMode(cookieStore.get(THEME_STORAGE_KEY)?.value)

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/*
          Sets the theme before anything is painted. It must be inline and
          ahead of React: the server cannot know what this browser stores or
          what its operating system prefers, so without this the first paint is
          light and the reader watches it turn dark a moment later.

          `suppressHydrationWarning` above is for the attribute this writes.
          React renders <html> without it and finds it already set; the warning
          is correct and the mismatch is the entire point.
        */}
        <script dangerouslySetInnerHTML={{ __html: noFlashScript() }} />
      </head>
      <body>
        <AntdRegistry>
          <ThemeProvider initialMode={mode}>
            <LocaleProvider initialLocale={locale}>
              <Providers>{children}</Providers>
            </LocaleProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  )
}
