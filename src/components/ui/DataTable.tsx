'use client'

import type { ReactNode } from 'react'
import { Empty, Table, Typography, type TableProps } from 'antd'
import { useLocale } from '@/lib/i18n/provider'

export type DataTableProps<RecordType extends object> = TableProps<RecordType> & {
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  /**
   * Whether this table is held to the width of its box. Default: it is.
   *
   * `false` restores Ant Design's `x: 'max-content'`, and is for a table that
   * genuinely is a matrix — one whose column count is data rather than design.
   */
  fit?: boolean
}

/**
 * The table every list on this screen set is drawn with.
 *
 * Held to its box by default: the columns that declare a width take it, the
 * ones that do not share what is left, and nothing scrolls sideways. The
 * hand-rolled table this replaces sized itself by its contents, so a day with
 * a long remark pushed the actions column off the right of the screen — you
 * could not press Huỷ on a row until you scrolled to find it.
 *
 * A fixed layout is what makes a declared width binding. Under `auto`, which
 * is what rc-table falls back to, a width is a hint the browser may overrule
 * and the elastic columns are not elastic at all.
 */
export function DataTable<RecordType extends object>({
  emptyTitle,
  emptyDescription,
  emptyAction,
  locale,
  scroll,
  fit = true,
  // Accounting work means comparing many rows at once, so lists are dense by
  // default; a screen can still ask for a roomier table.
  size = 'small',
  ...props
}: DataTableProps<RecordType>) {
  const { t } = useLocale()

  return (
    <div className={`pc-data-table${fit ? ' pc-table--fit' : ''}`}>
      <Table<RecordType>
        {...props}
        size={size}
        tableLayout={props.tableLayout ?? (fit ? 'fixed' : undefined)}
        // Under `fit` the row total IS the box, so there is nothing to scroll
        // sideways and `scroll.x` must not be set — setting it is what makes
        // every column shrink to its content and the table drift off the side.
        scroll={
          fit
            ? (scroll?.y === undefined ? undefined : { y: scroll.y })
            : { x: 'max-content', ...scroll }
        }
        locale={{
          ...locale,
          emptyText: locale?.emptyText ?? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null}>
              <Typography.Text strong>{emptyTitle ?? t('common.empty')}</Typography.Text>
              {emptyDescription && (
                <Typography.Paragraph type="secondary" className="pc-empty-description">
                  {emptyDescription}
                </Typography.Paragraph>
              )}
              {emptyAction}
            </Empty>
          ),
        }}
      />
    </div>
  )
}
