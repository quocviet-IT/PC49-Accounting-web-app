'use client'

import { Tag } from 'antd'

/**
 * The colour of each transaction type, by what the type does.
 *
 * Grouped rather than one colour each: eleven colours are a legend nobody
 * remembers, five groups are read at a glance down a column. Green for a sale
 * matches money coming in; a purchase is blue rather than red, because buying
 * stock is the business working, not money being lost.
 */
const COLOUR: Record<string, string> = {
  PO: 'blue',
  PO_VENDOR: 'blue',
  SALE: 'green',
  PICKUP: 'green',
  DEPOSIT: 'gold',
  CANCEL: 'gold',
  TRANSFER_IN: 'purple',
  TRANSFER_OUT: 'purple',
  RA_RP: 'purple',
  ON_THE_WAY: 'purple',
  MEMO: 'default',
}

export function txnTypeColor(type: string): string {
  return COLOUR[type] ?? 'default'
}

export function TxnTypeTag({ type }: { type: string }) {
  return <Tag color={txnTypeColor(type)} className="pc-txn-type">{type}</Tag>
}
