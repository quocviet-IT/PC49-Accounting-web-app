'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const lineSchema = z.object({
  goldTypeCode: z.string().min(1),
  uom: z.enum(['GRAM', 'OZ', 'LUONG']),
  qty: z.number().refine((n) => n !== 0, 'quantity cannot be zero'),
  unitPrice: z.number().positive(),
  refPrice: z.number().nullable(),
  productDesc: z.string().nullable(),
  confirmed: z.boolean(),
})

const inputSchema = z.object({
  cashTxnId: z.string().uuid(),
  lines: z.array(lineSchema).min(1),
})

export type SaveResult = { ok: true; residual: number } | { ok: false; message: string }

/**
 * Replaces the allocation for one bank transaction.
 *
 * Written as replace-all rather than incremental because the accountant works
 * out the whole transaction at once: two gold lines that only balance together
 * should never be half-saved.
 */
export async function saveAllocation(input: unknown): Promise<SaveResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid allocation' }
  }
  const { cashTxnId, lines } = parsed.data
  const supabase = await createServerSupabase()

  const { data: user } = await supabase.auth.getUser()
  const actor = user.user?.id ?? null

  const { error: clearError } = await supabase
    .from('bank_gold_allocation').delete().eq('cash_txn_id', cashTxnId)
  if (clearError) return { ok: false, message: clearError.message }

  const { error } = await supabase.from('bank_gold_allocation').insert(
    lines.map((l, i) => ({
      cash_txn_id: cashTxnId,
      seq: i + 1,
      gold_type_code: l.goldTypeCode,
      uom: l.uom,
      qty: l.qty,
      unit_price: l.unitPrice,
      ref_price: l.refPrice,
      product_desc: l.productDesc,
      // The database refuses an out-of-band price without this, which is the
      // point: stepping outside the band is the accountant's call to make.
      confirmed_by: l.confirmed ? actor : null,
    })),
  )
  if (error) return { ok: false, message: error.message }

  const { data: summary } = await supabase
    .from('v_bank_allocation').select('residual_cash').eq('cash_txn_id', cashTxnId).single()

  revalidatePath('/bank-conversion')
  return { ok: true, residual: Number(summary?.residual_cash ?? 0) }
}

export type Suggestion = { qty: number; unitPrice: number; refPrice: number; variance: number } | null

/** The whole quantity the day's reference price implies for an amount. */
export async function suggestAllocation(
  amount: number, goldTypeCode: string, date: string,
): Promise<Suggestion> {
  const supabase = await createServerSupabase()
  const { data } = await supabase.rpc('suggest_gold_allocation', {
    p_amount: amount, p_gold_type: goldTypeCode, p_date: date,
  })
  const row = Array.isArray(data) ? data[0] : null
  if (!row || row.qty === null) return null
  return {
    qty: Number(row.qty),
    unitPrice: Number(row.unit_price),
    refPrice: Number(row.ref_price),
    variance: Number(row.variance),
  }
}
