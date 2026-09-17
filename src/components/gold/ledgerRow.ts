import type { Uom } from '@/lib/domain/units'
import type { MessageKey } from '@/lib/i18n'
import type { ReceiptLine, ReceiptRow } from './types'

// Numbers arrive from the API as numbers or as strings depending on their
// column type, so every figure goes through Number once, here.
const text = (v: unknown) => (v === null || v === undefined ? null : String(v))
const figure = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/**
 * One row of pc49.gold_receipt_ledger (0076), as the screen and the export read it.
 *
 * The items arrive inside the row as JSON, where a figure may be a number or a
 * string depending on its column, so each goes through Number once, here.
 */
export function toReceiptRow(r: Record<string, unknown>): ReceiptRow {
  const lines = (r.lines ?? []) as Record<string, unknown>[]
  const payments = (r.payments ?? []) as { seq: unknown; amount: unknown; method: unknown }[]
  const soldBy = (r.sold_by ?? []) as { code: unknown; sharePct: unknown }[]
  return {
    key: String(r.receipt_key),
    receiptId: text(r.receipt_id),
    txn_date: String(r.txn_date),
    doc_no: text(r.doc_no),
    txn_type: String(r.txn_type),
    partner_code: text(r.partner_code),
    partner_phone: text(r.partner_phone),
    sales_person_code: text(r.sales_person_code),
    remarks: text(r.remarks),
    revision: Number(r.revision ?? 1),
    blockedCode: text(r.blocked_code),
    amount: Number(r.amount ?? 0),
    lines: lines.map(toReceiptLine),
    payments: payments.map((p) => ({ seq: Number(p.seq), amount: Number(p.amount), method: String(p.method) })),
    soldBy: soldBy.map((p) => ({ code: String(p.code), sharePct: Number(p.sharePct) })),
  }
}

function toReceiptLine(l: Record<string, unknown>): ReceiptLine {
  return {
    id: String(l.id),
    lineNo: Number(l.lineNo ?? 1),
    itemDesc: text(l.itemDesc),
    gold_type_code: String(l.goldTypeCode),
    scrap_detail: text(l.scrapDetail),
    gold_pct: figure(l.goldPct),
    uom: l.uom as Uom,
    qty: Number(l.qty),
    unit_price: figure(l.unitPrice),
    amount: Number(l.amount),
    blockedCode: text(l.blockedCode),
  }
}

/**
 * The gold column of a receipt: the gold type when every item is the same one
 * (with the count when there are several), "Nhiều loại (n món)" when they differ.
 */
export function goldSummary(
  row: Pick<ReceiptRow, 'lines'>,
  goldName: (code: string) => string,
  t: (key: MessageKey) => string,
): string {
  const n = row.lines.length
  if (n === 0) return '—'
  if (new Set(row.lines.map((l) => l.gold_type_code)).size > 1) {
    return t('receipt.mixed').replace('{0}', String(n))
  }
  const name = goldName(row.lines[0].gold_type_code)
  return n === 1 ? name : `${name} · ${t('receipt.count').replace('{0}', String(n))}`
}
