'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const PAYMENT_METHODS = ['CASH', 'BANKWIRE', 'ZELLE', 'CHECK'] as const

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
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
  salesPersonCode: z.string().nullable(),
  scrapDetail: z.string().nullable(),
  remarks: z.string().nullable(),
  payments: z.array(paymentSchema).max(2),
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
      sales_person_code: row.salesPersonCode,
      scrap_detail: row.scrapDetail,
      remarks: row.remarks,
    })
    .select('id')
    .single()

  if (error) return { ok: false, message: error.message }

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
