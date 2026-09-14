'use client'

import type { ReactNode } from 'react'
import { Button, Input } from 'antd'
import { Search, RotateCcw } from 'lucide-react'
import { useLocale } from '@/lib/i18n/provider'
import { FilterBar } from './FilterBar'

export function ListToolbar({ search, onSearch, placeholder, children, count, total, onReset }: {
  search: string; onSearch: (value: string) => void; placeholder?: string
  children?: ReactNode; count: number; total: number; onReset?: () => void
}) {
  const { t } = useLocale()
  return <FilterBar actions={<span className="pc-result-count" role="status">
    {count.toLocaleString()} {t('ui.of')} {total.toLocaleString()} {t('ui.results')}
  </span>}>
    <Input className="pc-list-search" allowClear value={search}
      aria-label={placeholder ?? t('ui.search')} placeholder={placeholder ?? t('ui.searchHint')}
      prefix={<Search size={16} aria-hidden />} onChange={(e) => onSearch(e.target.value)} />
    {children}
    {onReset && <Button icon={<RotateCcw size={15} aria-hidden />} onClick={onReset}>{t('ui.reset')}</Button>}
  </FilterBar>
}
