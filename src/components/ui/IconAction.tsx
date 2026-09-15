'use client'

import type { MouseEventHandler, ReactNode } from 'react'
import { Button } from 'antd'

/**
 * An action drawn as an icon alone.
 *
 * For the actions repeated on every row of a table, where a word on each one
 * pushed the column off the right of the screen. The name still travels with
 * the icon: as a label beside it for somebody pointing at it or tabbing to it,
 * and as the accessible name for a screen reader and for the browser checks
 * that press buttons by name. An icon with no name is a button nobody can be
 * sure about.
 *
 * The label is drawn by the stylesheet from `data-tip` (`.pc-icon-action-tip`),
 * not by Ant Design's Tooltip. A page of the ledger carries a hundred of these,
 * and the hundred Tooltip components were the most expensive thing on its rows
 * to render on the server: fifty rows took 228–296 ms with them and 195 ms
 * without, measured on 15-09.
 */
export function IconAction({
  icon, label, onClick, danger = false, disabled = false, disabledReason, loading = false,
}: {
  icon: ReactNode
  /** What the action does, in words; never shown beside the icon. */
  label: string
  onClick?: MouseEventHandler<HTMLElement>
  danger?: boolean
  disabled?: boolean
  /** Why it cannot be pressed, shown instead of the name while disabled. */
  disabledReason?: string | null
  loading?: boolean
}) {
  return (
    <span className="pc-icon-action-tip" data-tip={disabled && disabledReason ? disabledReason : label}>
      <Button
        type="text"
        size="small"
        className="pc-icon-action"
        icon={icon}
        aria-label={label}
        danger={danger}
        disabled={disabled}
        loading={loading}
        onClick={onClick}
      />
    </span>
  )
}
