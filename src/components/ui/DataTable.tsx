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

/** The narrowest a column that declares no width may be drawn. */
const ELASTIC_MIN_WIDTH = 120

/**
 * The narrowest a fitted table may be: every declared width, plus a floor for
 * each column that declares none.
 *
 * Under a fixed layout the undeclared columns share whatever the declared ones
 * leave, and nothing stopped that being nothing. On the transaction list eight
 * declared columns came to 936px, so on a 1280px laptop the customer and remark
 * columns got 33px each, and at 1024px none at all — the only two columns of
 * prose on the screen, reduced to "Chi" and "v…".
 */
function minimumWidth<RecordType>(columns: TableProps<RecordType>['columns']): number {
  return (columns ?? []).reduce<number>((sum, column) => {
    if ('children' in column && column.children?.length) {
      return sum + minimumWidth<RecordType>(column.children)
    }
    return sum + (typeof column.width === 'number' ? column.width : ELASTIC_MIN_WIDTH)
  }, 0)
}

/**
 * The table every list on this screen set is drawn with.
 *
 * Held to its box by default: the columns that declare a width take it, and the
 * ones that do not share what is left — down to a floor, below which the
 * table's own frame scrolls instead of a column being squeezed away. The
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
  pagination,
  ...props
}: DataTableProps<RecordType>) {
  const { t } = useLocale()

  return (
    <div className={`pc-data-table${fit ? ' pc-table--fit' : ''}`}>
      <Table<RecordType>
        {...props}
        pagination={pagination === false ? false : {
          defaultPageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          hideOnSinglePage: false,
          showTotal: (total, range) => `${range[0]}–${range[1]} / ${total} ${t('ui.rows')}`,
          ...pagination,
        }}
        size={size}
        tableLayout={props.tableLayout ?? (fit ? 'fixed' : undefined)}
        // Under `fit` the table is given a number, never 'max-content'. rc-table
        // turns a numeric x into `width: x; min-width: 100%` on the table and
        // `overflow-x: auto` on its frame: a wide screen still fills the box, a
        // narrow one scrolls the frame. 'max-content' is what made every column
        // shrink to its content and the table drift off the side.
        scroll={
          fit
            ? { x: minimumWidth<RecordType>(props.columns), ...(scroll?.y === undefined ? {} : { y: scroll.y }) }
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
