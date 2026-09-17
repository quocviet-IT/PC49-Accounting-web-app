'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { TXN_TYPES } from '@/components/gold/types'
import { MAX_RECEIPT_LINES, SINGLE_LINE_TYPES } from '@/components/gold/receiptLine'
import { MAX_CONVERSION_LINES } from '@/components/gold/conversionLine'

const PAYMENT_METHODS = ['CASH', 'BANKWIRE', 'ZELLE', 'CHECK'] as const

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
})

/**
 * One member of staff on an order, and what part of it is theirs.
 *
 * The share is a percent, and the shares on an order must come to a hundred.
 * The database says so too — this is here so the accountant reads the reason
 * on the row they are typing rather than a constraint name from Postgres.
 */
const salesShareSchema = z.object({
  code: z.string().min(1),
  sharePct: z.number().positive().max(100),
})

/**
 * What came back from a save.
 *
 * `warning` is not an error. The financial part either committed or it did
 * not; a warning means it committed and something beside it did not, which is
 * a different sentence and deserves a different one on screen. The handoff of
 * 05-09-2026 asked for exactly this: never report "could not save" after the
 * money has been recorded, only because a telephone number would not file.
 */
export type SaveResult =
  | { ok: true; id: string; docNo: string | null; repeated: boolean; warning?: string }
  | { ok: false; message: string }

/** One item of a receipt, signed and priced as it will be stored. */
const receiptLineSchema = z.object({
  itemDesc: z.string().trim().max(120).nullable().default(null),
  goldTypeCode: z.string().min(1),
  uom: z.enum(['GRAM', 'OZ', 'LUONG']),
  qty: z.number().refine((n) => n !== 0, 'quantity cannot be zero'),
  unitPrice: z.number().nullable(),
  amount: z.number(),
  scrapDetail: z.string().nullable(),
  goldPct: z.number().positive().max(1, 'purity is a fraction, so 0.583 rather than 58.3')
    .nullable().default(null),
})

const receiptFields = z.object({
  // Stable for the life of one receipt on screen, so a retry after a lost
  // answer is recognised as the same intention rather than a second receipt.
  requestKey: z.string().uuid(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  txnType: z.enum(TXN_TYPES),
  partnerCode: z.string().nullable(),
  partnerPhone: z.string().trim().max(40).nullable().default(null),
  salesPeople: z.array(salesShareSchema).max(10)
    .refine((list) => new Set(list.map((p) => p.code)).size === list.length,
      'the same person is on this order twice')
    .refine((list) => list.length === 0
      || Math.abs(list.reduce((sum, p) => sum + p.sharePct, 0) - 100) < 0.005,
      'the shares on an order must come to 100 percent'),
  remarks: z.string().nullable(),
  payments: z.array(paymentSchema).max(20),
  lines: z.array(receiptLineSchema).min(1).max(MAX_RECEIPT_LINES),
})

// Worded with the database's code, so the screen translates it the same way
// whichever of the two refused.
const ONE_ITEM = 'RECEIPT_SINGLE: a deposit or a pickup is one item'
const oneItemWhenTied = (r: { txnType: string; lines: unknown[] }) =>
  !SINGLE_LINE_TYPES.has(r.txnType) || r.lines.length === 1

const receiptSchema = receiptFields.refine(oneItemWhenTied, ONE_ITEM)
const receiptCorrectionSchema = receiptFields.extend({
  original: z.string().uuid(),
  expectedRevision: z.number().int(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
}).refine(oneItemWhenTied, ONE_ITEM)

type ReceiptInput = z.infer<typeof receiptFields>

/** What the database is sent: the receipt without its key and the customer's number. */
function receiptPayload(r: ReceiptInput) {
  return {
    txnDate: r.txnDate,
    txnType: r.txnType,
    partnerCode: r.partnerCode,
    remarks: r.remarks,
    salesPeople: r.salesPeople,
    payments: r.payments,
    lines: r.lines,
  }
}

/**
 * Files the customer and their number beside the receipt.
 *
 * Beside the money, not inside it: a telephone number that would not file is a
 * warning against a receipt that saved, never a failed save (05-09 handoff).
 */
async function fileCustomer(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  code: string | null, phone: string | null,
): Promise<string | undefined> {
  if (!code) return undefined
  const partner: { code: string; phone?: string } = { code }
  if (phone) partner.phone = phone
  const { error } = await supabase.from('partner').upsert(partner, { onConflict: 'code' })
  return error?.message
}

/**
 * Saves a receipt of one or more items and posts every item (0074).
 *
 * One call and one database transaction: the receipt, its items, the payments
 * divided between them and the postings are all written, or none is.
 */
export async function saveReceipt(input: unknown): Promise<SaveResult> {
  const parsed = receiptSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid receipt' }
  }
  const r = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('save_gold_receipt', {
    p_request_key: r.requestKey,
    p_payload: receiptPayload(r),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { receiptId: string; docNo: string | null; repeated: boolean }
  const warning = await fileCustomer(supabase, r.partnerCode, r.partnerPhone)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.receiptId, docNo: result.docNo, repeated: result.repeated, warning }
}

/**
 * Replaces a receipt, every item of it, with the corrected one (0075).
 *
 * `original` is the key the ledger listed: a receipt, or a transaction from
 * before receipts. Nothing is written until this is called, and the reversal
 * and the replacement happen together. The revision is the one the screen was
 * showing; if somebody has changed the receipt since, the answer is CONFLICT.
 */
export async function correctReceipt(input: unknown): Promise<SaveResult> {
  const parsed = receiptCorrectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid correction' }
  }
  const r = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('correct_gold_receipt', {
    p_request_key: r.requestKey,
    p_original: r.original,
    p_expected_revision: r.expectedRevision,
    p_reason: r.reason,
    p_reversal_date: r.reversalDate,
    p_payload: receiptPayload(r),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { receiptId: string; docNo: string | null; repeated: boolean }
  const warning = await fileCustomer(supabase, r.partnerCode, r.partnerPhone)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.receiptId, docNo: result.docNo, repeated: result.repeated, warning }
}

const receiptVoidSchema = z.object({
  key: z.string().uuid(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export type ReceiptVoidResult = { ok: true; lines: number } | { ok: false; message: string }

/**
 * Cancels a receipt, every item of it (0075).
 *
 * Each item is reversed by void_gold_txn exactly as a single transaction is:
 * the posting reversed rather than deleted, the stock given back as a movement.
 */
export async function voidReceipt(input: unknown): Promise<ReceiptVoidResult> {
  const parsed = receiptVoidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('void_gold_receipt', {
    p_original: parsed.data.key,
    p_reason: parsed.data.reason,
    p_on_date: parsed.data.onDate ?? null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/gold-transactions')
  return { ok: true, lines: Number(data ?? 0) }
}

/** One line of a conversion's side: which gold, in its own unit, how much, unsigned. */
const conversionLineSchema = z.object({
  goldTypeCode: z.string().min(1),
  uom: z.enum(['GRAM', 'OZ', 'LUONG']),
  qty: z.number().positive('quantity must be more than zero'),
})

const conversionFields = z.object({
  // Stable for the life of one conversion on screen, as a receipt's is.
  requestKey: z.string().uuid(),
  convDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['TRANSFER', 'RA_RP']),
  partnerCode: z.string().nullable(),
  note: z.string().nullable(),
  varianceReason: z.string().trim().nullable().default(null),
  out: z.array(conversionLineSchema).min(1).max(MAX_CONVERSION_LINES),
  in: z.array(conversionLineSchema).min(1).max(MAX_CONVERSION_LINES),
})

const conversionCorrectionSchema = conversionFields.extend({
  original: z.string().uuid(),
  expectedRevision: z.number().int(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
})

/** What the database is sent: the conversion without its key. */
function conversionPayload(c: z.infer<typeof conversionFields>) {
  return {
    convDate: c.convDate,
    kind: c.kind,
    partnerCode: c.partnerCode,
    note: c.note,
    varianceReason: c.varianceReason,
    out: c.out,
    in: c.in,
  }
}

/**
 * Saves a conversion: the gold that went out, the gold that came in, weighed
 * against each other and posted leg by leg, in one transaction (0078).
 */
export async function saveConversion(input: unknown): Promise<SaveResult> {
  const parsed = conversionFields.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid conversion' }
  }
  const c = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('save_gold_conversion', {
    p_request_key: c.requestKey,
    p_payload: conversionPayload(c),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { conversionId: string; docNo: string | null; repeated: boolean }
  // Filing the partner keeps the suggestions converging on one spelling.
  const warning = await fileCustomer(supabase, c.partnerCode, null)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.conversionId, docNo: result.docNo, repeated: result.repeated, warning }
}

/**
 * Replaces a conversion, every leg of it, with the corrected one (0079). The
 * revision is the one the screen was showing; CONFLICT if it has moved since.
 */
export async function correctConversion(input: unknown): Promise<SaveResult> {
  const parsed = conversionCorrectionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid correction' }
  }
  const c = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('correct_gold_conversion', {
    p_request_key: c.requestKey,
    p_original: c.original,
    p_expected_revision: c.expectedRevision,
    p_reason: c.reason,
    p_reversal_date: c.reversalDate,
    p_payload: conversionPayload(c),
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { conversionId: string; docNo: string | null; repeated: boolean }
  const warning = await fileCustomer(supabase, c.partnerCode, null)
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.conversionId, docNo: result.docNo, repeated: result.repeated, warning }
}

/** Cancels a conversion, every leg of it (0079). */
export async function voidConversion(input: unknown): Promise<ReceiptVoidResult> {
  const parsed = receiptVoidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('void_gold_conversion', {
    p_original: parsed.data.key,
    p_reason: parsed.data.reason,
    p_on_date: parsed.data.onDate ?? null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/gold-transactions')
  return { ok: true, lines: Number(data ?? 0) }
}
