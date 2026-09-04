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
export type SaveResult = { ok: true; id: string } | { ok: false; message: string }

/**
 * Saves one transaction and posts the ledger entries it implies.
 *
 * The accountant types a row at a time, so this saves a row at a time: a failure
 * on row nine must not throw away rows one to eight. The database refuses
 * anything that breaks a flow rule or the sign convention, and the message it
 * returns is what the accountant sees.
 */
export async function saveTransaction(input: unknown): Promise<SaveResult> {
  const parsed = rowSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid row' }
  }
  const row = parsed.data
  const supabase = await createServerSupabase()

  const { data: txn, error } = await supabase
    .from('gold_txn')
    .insert({
      txn_date: row.txnDate,
      txn_type: row.txnType,
      gold_type_code: row.goldTypeCode,
      uom: row.uom,
      qty: row.qty,
      unit_price: row.unitPrice,
      amount: row.amount,
      partner_code: row.partnerCode,
      // Left for the trigger to fill from the shares below, so the column and
      // the split cannot say different things about who sold this.
      sales_person_code: null,
      scrap_detail: row.scrapDetail,
      gold_pct: row.goldPct,
      remarks: row.remarks,
    })
    .select('id')
    .single()

  if (error) return { ok: false, message: error.message }

  // Naming a customer on a row is what puts them in the catalogue: nobody has
  // to enter a list before they can trade. A number given here is written
  // against the customer, so it is there next time whoever serves them opens
  // the screen. A blank leaves whatever is on file alone — this records a
  // number, it does not delete one, and an empty box is far more often "I did
  // not type it" than "she no longer has a telephone".
  if (row.partnerCode) {
    const partner: { code: string; phone?: string } = { code: row.partnerCode }
    if (row.partnerPhone) partner.phone = row.partnerPhone
    const { error: partnerError } = await supabase
      .from('partner')
      .upsert(partner, { onConflict: 'code' })
    // Not fatal. A transaction that posted correctly must not be reported as
    // failed because the address book could not be updated.
    if (partnerError) console.error('partner not recorded:', partnerError.message)
  }

  // In one statement, so the deferred check that the shares come to a hundred
  // sees the whole split rather than the first name on its own.
  if (row.salesPeople.length > 0) {
    const { error: whoError } = await supabase.from('gold_txn_sales_person').insert(
      row.salesPeople.map((p) => ({
        txn_id: txn.id,
        sales_person_code: p.code,
        share_pct: p.sharePct,
      })),
    )
    if (whoError) return { ok: false, message: whoError.message }
  }

  if (row.payments.length > 0) {
    const direction = row.amount >= 0 ? 'AR' : 'AP'
    const { error: payError } = await supabase.from('gold_txn_payment').insert(
      row.payments.map((p, i) => ({
        txn_id: txn.id,
        seq: i + 1,
        direction,
        amount: p.amount,
        method: p.method,
      })),
    )
    if (payError) return { ok: false, message: payError.message }
  }

  const { error: postError } = await supabase.rpc('post_gold_txn', { p_txn_id: txn.id })
  if (postError) return { ok: false, message: postError.message }

  revalidatePath('/gold-transactions')
  return { ok: true, id: txn.id }
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
