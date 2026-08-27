'use client'
import { Button } from 'antd'
import { useLocale } from '@/lib/i18n/provider'

export function LocaleSwitch() {
  const { locale, setLocale, t } = useLocale()
  return (
    <Button size="small" onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}>
      {t('locale.switch')}
    </Button>
  )
}
