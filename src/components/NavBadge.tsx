'use client'

import type { ReactNode } from 'react'
import { Badge } from 'antd'

/**
 * How many things behind a menu entry are waiting for this reader (spec
 * 2026-09-18): beside its name, and as a dot on its icon for a folded menu.
 *
 * Nothing is drawn for nothing. A badge that reads 0 is an alarm going off
 * every time somebody glances at the menu, and it teaches them to stop looking.
 */
export function NavCount({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null
  return (
    <span className="pc-nav-count" aria-label={label} title={label}>
      <Badge count={count} size="small" />
    </span>
  )
}

export function NavDot({ count, label, children }: {
  count: number
  label: string
  children: ReactNode
}) {
  if (count <= 0) return <>{children}</>
  return <Badge dot title={label}>{children}</Badge>
}
