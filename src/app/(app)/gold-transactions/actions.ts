'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

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

const rowSchema = z.object({
  // Stable for the life of one row on screen, so that a retry after a lost
  // answer is recognised as the same intention rather than a second one.
  requestKey: z.string().uuid(),
  txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  txnType: z.enum([
    'PO', 'PO_VENDOR', 'SALE', 'DEPOSIT', 'PICKUP',
    'TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP', 'ON_THE_WAY', 'CANCEL', 'MEMO',
  ]),
  goldTypeCode: z.string().min(1),
  uom: z.enum(['GRAM', 'OZ', 'LUONG']),
  qty: z.number().refine((n) => n !== 0, 'quantity cannot be zero'),
  unitPrice: z.number().nullable(),
  amount: z.number(),
  partnerCode: z.string().nullable(),
  // The customer's telephone number, which is a fact about the customer and
  // is stored against them rather than on this row.
  partnerPhone: z.string().trim().max(40).nullable().default(null),
  salesPeople: z.array(salesShareSchema).max(10)
    .refine((list) => new Set(list.map((p) => p.code)).size === list.length,
      'the same person is on this order twice')
    .refine((list) => list.length === 0
      || Math.abs(list.reduce((sum, p) => sum + p.sharePct, 0) - 100) < 0.005,
      'the shares on an order must come to 100 percent'),
  scrapDetail: z.string().nullable(),
  // A fraction, as on a refining lot: 14k is 0.583. The bound is the whole
  // point — 58.3 is a perfectly good number and a hundredfold error.
  goldPct: z.number().positive().max(1, 'purity is a fraction, so 0.583 rather than 58.3')
    .nullable().default(null),
  remarks: z.string().nullable(),
  // Was two, matching a `CHECK (seq IN (1, 2))` that migration 0046 removed —
  // both copied from a spreadsheet with two payment columns. What is left here
  // is a bound on what one request may insert, not a statement about how many
  // ways an order can be settled. The database no longer has an opinion on
  // that, and neither should this number pretend to.
  payments: z.array(paymentSchema).max(20),
})

export type TxnRowInput = z.infer<typeof rowSchema>

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
  | { ok: true; id: string; repeated: boolean; warning?: string }
  | { ok: false; message: string }

/**
 * Saves one transaction and posts the ledger entries it implies.
 *
 * One call, and it is one database transaction. It used to be five separate
 * requests — the row, the customer, the sales split, the payments, the posting
 * — each committing on its own, so a failure at the fourth left a transaction
 * on the books with no payments and no journal entry while the screen said it
 * had not saved. Pressing the button again then wrote a second one.
 *
 * The request key makes retrying safe. When the answer is lost on the way back
 * the accountant cannot know whether the money was recorded, and the only
 * thing they can do is try again; with the key, trying again returns the first
 * answer instead of writing the day twice.
 *
 * The amount is no longer sent as fact. The database works it out from the
 * quantity and the price and refuses a figure that disagrees, because the
 * number that reaches the ledger should not be one a screen can choose.
 */
export async function saveTransaction(input: unknown): Promise<SaveResult> {
  const parsed = rowSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid row' }
  }
  const row = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('save_gold_transaction', {
    p_request_key: row.requestKey,
    p_payload: {
      txnDate: row.txnDate,
      txnType: row.txnType,
      goldTypeCode: row.goldTypeCode,
      uom: row.uom,
      qty: row.qty,
      unitPrice: row.unitPrice,
      amount: row.amount,
      partnerCode: row.partnerCode,
      scrapDetail: row.scrapDetail,
      goldPct: row.goldPct,
      remarks: row.remarks,
      payments: row.payments,
      salesPeople: row.salesPeople,
    },
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { txnId: string; repeated: boolean }

  // Beside the money, not inside it. Filing the customer is worth doing and is
  // not worth throwing away a purchase for, so its failure is carried back as
  // a warning against a row that did save.
  let warning: string | undefined
  if (row.partnerCode) {
    const partner: { code: string; phone?: string } = { code: row.partnerCode }
    if (row.partnerPhone) partner.phone = row.partnerPhone
    const { error: partnerError } = await supabase
      .from('partner').upsert(partner, { onConflict: 'code' })
    if (partnerError) warning = partnerError.message
  }

  revalidatePath('/gold-transactions')
  return { ok: true, id: result.txnId, repeated: result.repeated, warning }
}


const correctionSchema = rowSchema.extend({
  originalId: z.string().uuid(),
  expectedRevision: z.number().int(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
})

/**
 * Replaces a posted transaction with a corrected one.
 *
 * Nothing is written until this is called. Pressing Sửa used to reverse the
 * original immediately and only then offer a draft to type, so closing the tab
 * between the two left the books with the old row cancelled and nothing in its
 * place. Now the original stays live and posted while the correction is being
 * typed, and the reversal and the replacement happen together or not at all.
 *
 * The revision is the one the screen was showing. If somebody else has changed
 * the row since, the database says CONFLICT rather than quietly overwriting
 * work this screen never saw.
 */
export async function correctTransaction(input: unknown): Promise<SaveResult> {
  const parsed = correctionSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid correction' }
  }
  const row = parsed.data
  const supabase = await createServerSupabase()

  const { data, error } = await supabase.rpc('correct_gold_transaction', {
    p_request_key: row.requestKey,
    p_original_id: row.originalId,
    p_expected_revision: row.expectedRevision,
    p_reason: row.reason,
    p_reversal_date: row.reversalDate,
    p_payload: {
      txnDate: row.txnDate,
      txnType: row.txnType,
      goldTypeCode: row.goldTypeCode,
      uom: row.uom,
      qty: row.qty,
      unitPrice: row.unitPrice,
      amount: row.amount,
      partnerCode: row.partnerCode,
      scrapDetail: row.scrapDetail,
      goldPct: row.goldPct,
      remarks: row.remarks,
      payments: row.payments,
      salesPeople: row.salesPeople,
    },
  })
  if (error) return { ok: false, message: error.message }

  const result = data as { txnId: string; repeated: boolean }
  revalidatePath('/gold-transactions')
  return { ok: true, id: result.txnId, repeated: result.repeated }
}

const voidSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, 'say why in a few words'),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
})

export type VoidResult = { ok: true; reversed: boolean } | { ok: false; message: string }

/**
 * Cancels a transaction.
 *
 * The whole job is done inside `void_gold_txn`: the posting is reversed rather
 * than deleted, the stock is given back as a movement rather than removed, and
 * the reason is recorded. Doing any of that here would be a second place the
 * books could be corrected from, and the two would drift.
 */
export async function voidTransaction(input: unknown): Promise<VoidResult> {
  const parsed = voidSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('void_gold_txn', {
    p_txn_id: parsed.data.id,
    p_reason: parsed.data.reason,
    p_on_date: parsed.data.onDate ?? null,
  })
  // The database's refusals name the month that is closed, or the pickup that
  // has to go first. They are written for the accountant, so they are passed on
  // as they are.
  if (error) return { ok: false, message: error.message }

  revalidatePath('/gold-transactions')
  return { ok: true, reversed: data !== null }
}
