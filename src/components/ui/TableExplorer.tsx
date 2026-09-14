'use client'

import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { Empty, Pagination } from 'antd'
import { useLocale } from '@/lib/i18n/provider'
import { matchesSearch, pageSlice } from '@/lib/ui/list'
import { ListToolbar } from './ListToolbar'

type NodeProps = { children?: ReactNode; value?: string | number; colSpan?: number }

function searchableText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (isValidElement<NodeProps>(node)) return searchableText(node.props.children) + ' ' + (node.props.value ?? '')
  return Children.toArray(node).map((child) => isValidElement<NodeProps>(child)
    ? searchableText(child.props.children) + ' ' + (child.props.value ?? '') : String(child ?? '')).join(' ')
}

/** Paging for semantic report tables; full-period footers remain untouched. */
export function TableExplorer({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const table = Children.toArray(children).find((node) => isValidElement(node) && node.type === 'table') as ReactElement<NodeProps> | undefined
  if (!table) return <>{children}</>
  const parts = Children.toArray(table.props.children)
  const body = parts.find((node) => isValidElement(node) && node.type === 'tbody') as ReactElement<NodeProps> | undefined
  if (!body) return <div className="pc-table-explorer__scroll">{children}</div>
  const rows = Children.toArray(body.props.children).filter(isValidElement)
  const filtered = rows.filter((row) => matchesSearch(query, [searchableText(row)]))
  const page = pageSlice(filtered, current, pageSize)
  const hasSummary = parts.some((part) => isValidElement(part) && part.type === 'tfoot')
  const updated = cloneElement(table, {}, parts.map((part) => part === body
    ? cloneElement(body, {}, page.rows) : part))

  return <div className="pc-table-explorer">
    <ListToolbar search={query} onSearch={(value) => { setQuery(value); setCurrent(1) }} count={filtered.length} total={rows.length}
      onReset={query ? () => { setQuery(''); setCurrent(1) } : undefined} />
    <div className="pc-table-explorer__scroll">{updated}</div>
    {filtered.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('common.empty')} />}
    <div className="pc-table-explorer__footer">
      {hasSummary && <p>{t('ui.totalScope')}</p>}
      <Pagination current={page.page} total={filtered.length} pageSize={pageSize} showSizeChanger
        pageSizeOptions={[10, 20, 50, 100]} onChange={(next, size) => { setCurrent(size === pageSize ? next : 1); setPageSize(size) }}
        showTotal={(total, range) => `${range[0]}–${range[1]} / ${total} ${t('ui.rows')}`} />
    </div>
  </div>
}
