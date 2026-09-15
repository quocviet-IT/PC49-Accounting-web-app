'use client'

import type { MouseEventHandler, ReactNode } from 'react'
import { Button, Tooltip } from 'antd'

/**
 * An action drawn as an icon alone.
 *
 * For the actions repeated on every row of a table, where a word on each one
 * pushed the column off the right of the screen. The name still travels with
 * the icon: as a tooltip for somebody pointing at it, and as the accessible
 * name for a screen reader and for the browser checks that press buttons by
 * name. An icon with no name is a button nobody can be sure about.
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
    <Tooltip title={disabled && disabledReason ? disabledReason : label}>
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
    </Tooltip>
  )
}
