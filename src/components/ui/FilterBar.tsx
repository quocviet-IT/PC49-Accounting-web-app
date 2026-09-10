'use client'

import type { ReactNode } from 'react'

/**
 * The strip above a list: what is being looked at, and what can be done about
 * it.
 *
 * Two sides on purpose. Controls that change WHICH rows are shown go on the
 * left, where somebody looks when the list is not what they expected; actions
 * that write something go on the right, away from them. Mixing the two is how
 * a date picker ends up beside a Save button.
 */
export function FilterBar({
  children, actions,
}: {
  /** Controls that change what the list shows. */
  children?: ReactNode
  /** Buttons that do something to it. */
  actions?: ReactNode
}) {
  return (
    <div className="pc-filter-bar">
      <div className="pc-filter-bar__controls">{children}</div>
      {actions && <div className="pc-filter-bar__actions">{actions}</div>}
    </div>
  )
}
