'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const receiptSchema = z.object({
  lotId: z.string().uuid(),
  ownerCode: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a receipt needs the day it arrived'),
  qtyGram: z.number().positive('a receipt of nothing is not a receipt'),
  unitPrice: z.number().positive().nullable().optional(),
})

export type ReceiptResult = { ok: true } | { ok: false; message: string }

/**
 * Records gold coming back from the refinery.
 *
 * This is the third stage the source spreadsheet has no column for, and its
 * absence is why nobody could prove a lot had been settled. `receive_refining`
 * owns the rules — the lot must have been assayed, and the owner must actually
 * have a line on it — and moves the lot to RECEIVED on the first receipt.
 *
 * Several receipts against one lot are normal: metal comes back in more than
 * one delivery, and each is recorded as it arrives rather than waiting for the
 * last one.
 */
export async function recordReceipt(input: unknown): Promise<ReceiptResult> {
  const parsed = receiptSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid receipt' }
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('receive_refining', {
    p_lot_id: parsed.data.lotId,
    p_date: parsed.data.date,
    p_owner_code: parsed.data.ownerCode,
    p_qty_gram: parsed.data.qtyGram,
    p_unit_price: parsed.data.unitPrice ?? null,
  })
  // The database's refusals name the lot and its stage, so they are passed on
  // as they are.
  if (error) return { ok: false, message: error.message }

  revalidatePath('/refining')
  return { ok: true }
}
