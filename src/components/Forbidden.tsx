import { t, type Locale } from '@/lib/i18n'

/**
 * What a screen shows somebody whose role does not open it.
 *
 * The navigation already hides these, so reaching one means a typed URL or a
 * stale link. It says so plainly and stops — the database refuses the same
 * request anyway, and a screen that half-renders would only suggest otherwise.
 */
export function Forbidden({ locale }: { locale?: Locale }) {
  return <p className="pc-note">{t(locale ?? 'vi', 'auth.forbidden')}</p>
}
