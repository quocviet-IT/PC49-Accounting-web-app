import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Pencil } from 'lucide-react'
import { IconAction } from '@/components/ui/IconAction'
import { TxnTypeTag, txnTypeColor } from '@/components/gold/TxnTypeTag'
import { LEDGER_TXN_TYPES } from '@/components/gold/ledgerQuery'

describe('an action shown as an icon', () => {
  it('keeps its name for anybody who cannot see the icon', () => {
    const html = renderToStaticMarkup(<IconAction icon={<Pencil size={16} />} label="Sửa" />)
    expect(html).toContain('aria-label="Sửa"')
    // The name is not printed beside the icon; the icon stands for it.
    expect(html).not.toMatch(/>Sửa</)
  })

  it('reads as dangerous when it destroys something, and can be disabled', () => {
    const html = renderToStaticMarkup(
      <IconAction icon={<Pencil size={16} />} label="Huỷ" danger disabled />)
    expect(html).toContain('ant-btn-dangerous')
    expect(html).toContain('disabled')
  })
})

describe('the colour of a transaction type', () => {
  it('groups every type the ledger knows', () => {
    const groups = Object.fromEntries(LEDGER_TXN_TYPES.map((t) => [t, txnTypeColor(t)]))
    expect(groups).toEqual({
      PO: 'blue', PO_VENDOR: 'blue',
      SALE: 'green', PICKUP: 'green',
      DEPOSIT: 'gold', CANCEL: 'gold',
      TRANSFER_IN: 'purple', TRANSFER_OUT: 'purple', RA_RP: 'purple', ON_THE_WAY: 'purple',
      MEMO: 'default',
    })
  })

  it('falls back to plain for a type it has never seen', () => {
    expect(txnTypeColor('SOMETHING_NEW')).toBe('default')
  })

  it('draws the type in its group colour', () => {
    const html = renderToStaticMarkup(<TxnTypeTag type="SALE" />)
    expect(html).toContain('ant-tag-green')
    expect(html).toContain('SALE')
  })
})
