import { describe, it, expect } from 'vitest'
import {
  TXN_COLUMNS, locateColumns, toImportRows, assignConversionKeys, dropCarriedOver, toCsv,
} from '../../scripts/lib/sheet-rows.mjs'

/** The two header rows of a month tab. April sits one column to the left. */
function tab(shift: number) {
  const names = ['Date', 'Document N.', 'Sales Person', 'Customer name /Vendor', 'Contact',
    'Description', 'Detail-scrap gold', ...(shift ? [] : ['']), 'Unit', 'Qty', 'Unit Price',
    'Amount', 'Type', 'AP', 'Payment method', '', 'Payment method', 'AP (Total Amount)',
    'AR(Receive money directly)', 'Pmt.method', '', 'Pmt. method', 'AR (Total Amount)',
    'AR_Deposit', 'Payment method', '', 'Pmt. Method', 'Pickup Date', 'Other(Adjust)',
    'Total Deposit Amount', 'Balance', 'AP-Vendor', 'Remarks']
  // The second header row names the amount columns the first row leaves blank.
  const second = names.map(() => '')
  const label = (after: string, gap: number, text: string) => {
    second[names.indexOf(after) + gap] = text
  }
  label('AP', 0, 'PO 1')
  label('AP', 2, 'PO 2')
  label('AR(Receive money directly)', 0, 'Sales-1st')
  label('AR(Receive money directly)', 2, 'Sales-2nd')
  label('AR_Deposit', 0, 'Amount-1st')
  label('AR_Deposit', 2, 'Amount-2nd (Pick-up)')
  return [['PC49 Sale 01.2026'], ['SUBTOTAL'], names, second]
}

const noMoney = { amount: '', method: '' }

/** A purchase as the reader gives it: dates already ISO, numbers already numbers. */
const po = {
  sheetRow: 12, date: '2026-01-04', doc: '', sales: 'B.Khanh', customer: 'Chị Loan',
  desc: 'Scrap gold', detail: '16-18k/grs', unit: 'Gram', qty: 6.5, price: 65.38461538,
  amount: -425, type: 'PO', pickupDate: null as string | null, remarks: '',
  pay: {
    po1: { amount: -425 as number | string, method: 'Cash' }, po2: noMoney,
    s1: noMoney as { amount: number | string; method: string }, s2: noMoney,
    a1: noMoney as { amount: number | string; method: string },
    a2: noMoney as { amount: number | string; method: string },
  },
}

describe('finding the columns', () => {
  it('finds a column by what it is called, wherever the tab put it', () => {
    // A fixed column letter would read April's quantities as unit prices
    // without a word of complaint.
    const normal = locateColumns(tab(0))
    const april = locateColumns(tab(1))
    expect(april.unit).toBe(normal.unit - 1)
    expect(april.qty).toBe(normal.qty - 1)
    expect(april.price).toBe(normal.price - 1)
    expect(april.date).toBe(0)
  })

  it('does not take Unit Price for Unit', () => {
    const c = locateColumns(tab(0))
    expect(c.price).toBe(c.unit + 2)
  })

  it('names a heading it cannot find instead of guessing', () => {
    const broken = tab(0)
    broken[2] = broken[2].map((h) => (h === 'Qty' ? 'Quantity?' : h))
    expect(() => locateColumns(broken)).toThrow(/Qty/)
  })
})

describe('a sheet row becomes what the loader reads', () => {
  it('writes a purchase with its money and its people', () => {
    const [row] = toImportRows(po)
    expect(row).toMatchObject({
      txn_date: '2026-01-04', txn_type: 'PO', gold_type_code: 'SG', uom: 'GRAM',
      qty: '6.5', amount: '-425', partner_code: 'Chị Loan', sales: 'B.Khanh',
      scrap_detail: '16-18k/grs', payments: 'AP:CASH:425',
      conv_key: '', lot_code: '', deposit_key: '',
    })
    expect(Object.keys(row)).toEqual(TXN_COLUMNS)
  })

  it('keeps the names in a shared sale in the order they were written', () => {
    const [row] = toImportRows({ ...po, sales: ' N.Ý / T.Quỳnh ' })
    expect(row.sales).toBe('N.Ý/T.Quỳnh')
  })

  it('splits a pickup into the deposit taken and the gold handed over', () => {
    const pickup = {
      ...po, sheetRow: 40, date: '2026-01-16', customer: 'Kelvin Tran', desc: 'Rong Phung',
      detail: '', unit: 'Lượng', qty: -1, price: 5615, amount: 5615, type: 'Pickup',
      pickupDate: '2026-01-17',
      pay: { ...po.pay, po1: noMoney,
        a1: { amount: 2500, method: 'Cash' }, a2: { amount: 3115, method: 'Zelle' } },
    }
    const [deposit, handed] = toImportRows(pickup)
    // Both carry the sale sign. A deposit with a positive quantity puts the
    // luong back on the shelf it was sold from (see import-gold.test.ts).
    expect(deposit).toMatchObject({ txn_date: '2026-01-16', txn_type: 'DEPOSIT',
      qty: '-1', amount: '0', payments: 'AR:CASH:2500', partner_code: 'Kelvin Tran' })
    expect(handed).toMatchObject({ txn_date: '2026-01-17', txn_type: 'PICKUP',
      qty: '-1', amount: '5615', payments: 'AR:ZELLE:3115', partner_code: 'Kelvin Tran' })
    expect(deposit.deposit_key).not.toBe('')
    expect(handed.deposit_key).toBe(deposit.deposit_key)
  })

  it('writes a transfer by its direction, with the customer cell as a note', () => {
    const out = { ...po, desc: 'Rong Phung', detail: '', unit: 'Lượng', qty: -5, amount: 26500,
      type: 'Transfer', customer: 'Memo Nini', pay: { ...po.pay, po1: noMoney } }
    const [a] = toImportRows(out)
    const [b] = toImportRows({ ...out, qty: 26 })
    expect(a).toMatchObject({ txn_type: 'TRANSFER_OUT', partner_code: '', payments: '' })
    expect(a.remarks).toContain('Memo Nini')
    expect(b.txn_type).toBe('TRANSFER_IN')
  })

  it('treats a conversion to Rong Phung and a memo the same way', () => {
    const base = { ...po, desc: 'Grain', detail: '', qty: -2700, amount: 0,
      customer: 'Transfer 2700gr vàng Grain ra 72L VRP', pay: { ...po.pay, po1: noMoney } }
    const [raRp] = toImportRows({ ...base, type: 'Ra RP' })
    const [memo] = toImportRows({ ...base, type: 'Memo', customer: 'MH' })
    expect(raRp).toMatchObject({ txn_type: 'RA_RP', partner_code: '' })
    expect(raRp.remarks).toContain('72L VRP')
    expect(memo).toMatchObject({ txn_type: 'MEMO', partner_code: '' })
    expect(memo.remarks).toContain('MH')
  })

  it('keeps the name on a sale even when it reads like a note', () => {
    // The design sends a note-like cell to remarks only for transfers and
    // memos. On a sale the cell is who bought it.
    const [row] = toImportRows({ ...po, type: 'Sale', qty: -3, amount: 900,
      customer: 'Gởi Shawn bán',
      pay: { ...po.pay, po1: noMoney, s1: { amount: 900, method: 'Cash' } } })
    expect(row).toMatchObject({
      txn_type: 'SALE', partner_code: 'Gởi Shawn bán', payments: 'AR:CASH:900' })
  })

  it('keeps the document number the sheet gave, since the system numbers its own', () => {
    const [row] = toImportRows({ ...po, doc: 'TF0101' })
    expect(row.remarks).toContain('TF0101')
  })

  it('leaves a missing gold type missing, for the loader to turn back', () => {
    const [row] = toImportRows({ ...po, desc: '', unit: '' })
    expect(row).toMatchObject({ gold_type_code: '', uom: '' })
  })

  it('stops at a kind of row nobody has said how to read', () => {
    expect(() => toImportRows({ ...po, type: 'Consign' })).toThrow(/row 12.*Consign/)
  })
})

describe('a conversion is only a conversion when the day weighs the same', () => {
  const t = (type: string, gold: string, uom: string, qty: string, date = '2026-01-05') =>
    ({ txn_date: date, txn_type: type, gold_type_code: gold, uom, qty, conv_key: '', lot_code: '' })

  it('gives the rows of a balanced day one key', () => {
    const rows = assignConversionKeys([
      t('TRANSFER_OUT', 'GRAIN', 'GRAM', '-975'), t('TRANSFER_IN', 'RP', 'LUONG', '26')])
    expect(rows[0].conv_key).not.toBe('')
    expect(rows[1].conv_key).toBe(rows[0].conv_key)
  })

  it('leaves a day that does not weigh the same without one', () => {
    const rows = assignConversionKeys([
      t('TRANSFER_OUT', 'GRAIN', 'GRAM', '-975'), t('TRANSFER_IN', 'RP', 'LUONG', '25')])
    expect(rows.map((r) => r.conv_key)).toEqual(['', ''])
  })

  it('weighs ounces at 31.105', () => {
    // 3 oz is 93.315 g by weight and 93.3 g at the valuation divisor, so this
    // day balances only when the ounce is weighed rather than valued.
    const rows = assignConversionKeys([
      t('TRANSFER_OUT', 'GRAIN', 'GRAM', '-93.315'), t('TRANSFER_IN', 'CS', 'OZ', '3')])
    expect(rows[0].conv_key).not.toBe('')
  })

  it('keeps separate days apart', () => {
    const rows = assignConversionKeys([
      t('TRANSFER_OUT', 'GRAIN', 'GRAM', '-975', '2026-01-05'),
      t('TRANSFER_IN', 'RP', 'LUONG', '26', '2026-01-06')])
    expect(rows.map((r) => r.conv_key)).toEqual(['', ''])
  })

  it('leaves scrap and platinum to their refining lot', () => {
    const rows = assignConversionKeys([
      t('TRANSFER_OUT', 'SG', 'GRAM', '-195.36'), t('TRANSFER_OUT', 'PT', 'GRAM', '-112.77')])
    expect(rows.map((r) => r.conv_key)).toEqual(['', ''])
  })

  it('does not touch purchases and sales on the same day', () => {
    const rows = assignConversionKeys([t('PO', 'RP', 'LUONG', '1'), t('SALE', 'RP', 'LUONG', '-1')])
    expect(rows.map((r) => r.conv_key)).toEqual(['', ''])
  })
})

describe('a row carried into the next month is loaded once', () => {
  // Fifteen rows of the 2026 workbooks appear twice: in the tab of their own
  // date and again, cell for cell, in the next month's tab — open deposits and
  // unpaid sales the accountant keeps in view. Loading every tab as written
  // books each of them twice.
  const row = (over: Record<string, string>) => ({
    txn_date: '2026-01-22', txn_type: 'SALE', gold_type_code: 'ML', uom: 'OZ', qty: '-5',
    unit_price: '4745.8', amount: '23729', partner_code: 'Kelvin Tran', sales: 'L.Thanh',
    scrap_detail: '', gold_pct: '', payments: '', conv_key: '', lot_code: '',
    deposit_key: '', remarks: '', ...over,
  })

  it('drops the copy from the later tab and keeps the original', () => {
    const { tabs, dropped } = dropCarriedOver({ '01': [row({})], '02': [row({})] })
    expect(tabs['01']).toHaveLength(1)
    expect(tabs['02']).toHaveLength(0)
    expect(dropped).toEqual([{ tab: '02', from: '01', row: row({}) }])
  })

  it('drops a carried deposit together with the pickup that follows it', () => {
    const deposit = (key: string) => row({ txn_date: '2026-01-28', txn_type: 'DEPOSIT', gold_type_code: 'RP',
      uom: 'LUONG', qty: '-1', amount: '0', payments: 'AR:CASH:3500', deposit_key: key })
    const pickup = (key: string) => row({ txn_date: '2026-02-02', txn_type: 'PICKUP', gold_type_code: 'RP',
      uom: 'LUONG', qty: '-1', amount: '6440', payments: 'AR:ZELLE:2940', deposit_key: key })
    // The key is built from the sheet row, so the two copies do not share it.
    const { tabs, dropped } = dropCarriedOver({
      '01': [deposit('dep-2026-01-28-180'), pickup('dep-2026-01-28-180')],
      '02': [deposit('dep-2026-01-28-7'), pickup('dep-2026-01-28-7'), row({ txn_date: '2026-02-03' })],
    })
    expect(tabs['01']).toHaveLength(2)
    expect(tabs['02'].map((r) => r.txn_date)).toEqual(['2026-02-03'])
    expect(dropped.map((d) => d.row.txn_type)).toEqual(['DEPOSIT', 'PICKUP'])
  })

  it('keeps a row dated in an earlier month that has no original there', () => {
    // Entered late, not copied: nothing else records it.
    const { tabs, dropped } = dropCarriedOver({ '01': [], '02': [row({})] })
    expect(tabs['02']).toHaveLength(1)
    expect(dropped).toEqual([])
  })

  it('keeps a copy that differs in any cell', () => {
    // A carried sale that has since been paid is a settlement to look at,
    // not a duplicate to throw away.
    const { tabs } = dropCarriedOver({ '01': [row({})], '02': [row({ payments: 'AR:CASH:23729' })] })
    expect(tabs['02']).toHaveLength(1)
  })

  it('never drops two identical rows inside one tab', () => {
    // Two customers can buy the same coin on the same day at the same price.
    const { tabs } = dropCarriedOver({ '01': [row({}), row({})] })
    expect(tabs['01']).toHaveLength(2)
  })
})

describe('writing the file', () => {
  it('quotes what a spreadsheet would otherwise split', () => {
    const csv = toCsv([{ a: 'Chị Thủy, Cù', b: 'say "hi"', c: 'two\nlines' }], ['a', 'b', 'c'])
    expect(csv).toBe('a,b,c\n"Chị Thủy, Cù","say ""hi""","two\nlines"\n')
  })
})
