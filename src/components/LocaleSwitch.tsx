'use client'
import { Button } from 'antd'
import { Languages } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'

export function LocaleSwitch() {
  const { locale, setLocale, t } = useLocale()
  return (
    <Button size="small" icon={<Languages size={14} aria-hidden />} onClick={() => setLocale(locale === 'vi' ? 'en' : 'vi')}>
      {t('locale.switch')}
    </Button>
  )
}
