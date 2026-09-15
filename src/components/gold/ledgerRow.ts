import type { Uom } from '@/lib/domain/units'
import type { LedgerRow } from './types'

const text = (v: unknown) => (v === null || v === undefined ? null : String(v))
const figure = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/**
 * One row of pc49.gold_txn_ledger (0068), as the screen and the export read it.
 *
 * Numbers arrive from the API as numbers or as strings depending on their
 * column type, so every figure goes through Number here once rather than at
 * each place it is used.
 */
export function toLedgerRow(r: Record<string, unknown>): LedgerRow {
  const payments = (r.payments ?? []) as { seq: unknown; amount: unknown; method: unknown }[]
  const soldBy = (r.sold_by ?? []) as { code: unknown; sharePct: unknown }[]
  return {
    id: String(r.id),
    txn_date: String(r.txn_date),
    doc_no: text(r.doc_no),
    txn_type: String(r.txn_type),
    partner_code: text(r.partner_code),
    partner_phone: text(r.partner_phone),
    sales_person_code: text(r.sales_person_code),
    gold_type_code: String(r.gold_type_code),
    scrap_detail: text(r.scrap_detail),
    gold_pct: figure(r.gold_pct),
    uom: r.uom as Uom,
    qty: Number(r.qty),
    unit_price: figure(r.unit_price),
    amount: Number(r.amount),
    remarks: text(r.remarks),
    payments: payments.map((p) => ({ seq: Number(p.seq), amount: Number(p.amount), method: String(p.method) })),
    soldBy: soldBy.map((p) => ({ code: String(p.code), sharePct: Number(p.sharePct) })),
    revision: Number(r.revision ?? 1),
    blockedReason: text(r.blocked_reason),
  }
}
