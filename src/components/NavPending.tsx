'use client'

import { useLinkStatus } from 'next/link'

/**
 * The mark beside a menu item while its screen is on its way.
 *
 * It has to sit inside the `<Link>` it reports on, because that is where
 * `useLinkStatus` reads from.
 */
export function NavPending() {
  const { pending } = useLinkStatus()
  return <NavPendingMark pending={pending} />
}

/** Always rendered at a fixed size and faded in, so the label never shifts. */
export function NavPendingMark({ pending }: { pending: boolean }) {
  return <span aria-hidden="true" className={`pc-nav-pending${pending ? ' is-pending' : ''}`} />
}
