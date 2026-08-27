import { AntdRegistry } from '@ant-design/nextjs-registry'
import { cookies } from 'next/headers'
import { LocaleProvider } from '@/lib/i18n/provider'
import type { Locale } from '@/lib/i18n'

export const metadata = { title: 'PC49' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const locale = (cookieStore.get('pc49_locale')?.value === 'en' ? 'en' : 'vi') as Locale
  return (
    <html lang={locale}>
      <body style={{ margin: 0 }}>
        <AntdRegistry>
          <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
        </AntdRegistry>
      </body>
    </html>
  )
}
