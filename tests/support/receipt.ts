/**
 * The paper receipt from the counter on 17-09, as the screen sends it: six
 * pieces bought from one customer, 8,361.00 in all.
 */
export type Item = {
  itemDesc: string
  goldTypeCode: string
  qty: number
  goldPct: number | null
  total: number
  scrapDetail: string | null
}

export const SIX_ITEMS: Item[] = [
  { itemDesc: 'Nhẫn 24K (vụn)', goldTypeCode: 'SG', qty: 9.4, goldPct: 0.987, total: 950, scrapDetail: '19-24k/grs' },
  { itemDesc: 'Mũ 24K (vụn)', goldTypeCode: 'SG', qty: 7.5, goldPct: 0.981, total: 825, scrapDetail: '19-24k/grs' },
  { itemDesc: 'Thỏi RCM', goldTypeCode: 'GRAIN', qty: 15.6, goldPct: 0.998, total: 1900, scrapDetail: null },
  { itemDesc: 'Bi 24K (vụn)', goldTypeCode: 'SG', qty: 37.5, goldPct: 0.99, total: 4125, scrapDetail: '19-24k/grs' },
  { itemDesc: 'Xu Suisse 24K', goldTypeCode: 'GRAIN', qty: 5, goldPct: 0.99, total: 525, scrapDetail: null },
  { itemDesc: 'Mặt dây 14K (vụn)', goldTypeCode: 'SG', qty: 0.6, goldPct: 0.597, total: 36, scrapDetail: '10-18k/grs' },
]

/** An item as a purchase line: the price per gram worked out from the receipt's amount, to eight places. */
export function purchaseLine(item: Item) {
  return {
    itemDesc: item.itemDesc,
    goldTypeCode: item.goldTypeCode,
    uom: 'GRAM',
    qty: item.qty,
    unitPrice: Math.round((item.total / item.qty) * 1e8) / 1e8,
    amount: -item.total,
    scrapDetail: item.scrapDetail,
    goldPct: item.goldPct,
  }
}

/** The whole receipt as the payload save_gold_receipt takes, with anything overridden. */
export function receiptPayload(over: Record<string, unknown> = {}, items: Item[] = SIX_ITEMS): string {
  return JSON.stringify({
    txnDate: '2026-06-02',
    txnType: 'PO',
    partnerCode: 'NGUYEN VAN A',
    remarks: 'phieu 6 mon',
    salesPeople: [{ code: 'L.Thanh', sharePct: 80 }, { code: 'P.Minh', sharePct: 20 }],
    payments: [{ amount: 5000, method: 'CASH' }, { amount: 3361, method: 'BANKWIRE' }],
    lines: items.map(purchaseLine),
    ...over,
  })
}
