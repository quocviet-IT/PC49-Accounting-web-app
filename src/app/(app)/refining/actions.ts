'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const receiptSchema = z.object({
  lotId: z.string().uuid(),
  ownerCode: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a receipt needs the day it arrived'),
  // Lấy vàng or lấy tiền — column S of the source sheet. Metal carries a
  // weight, cash carries an amount, and the shape follows the choice.
  settleKind: z.enum(['METAL', 'CASH']).default('METAL'),
  qtyGram: z.number().positive('a receipt of nothing is not a receipt').nullable().default(null),
  unitPrice: z.number().positive().nullable().optional(),
  amountUsd: z.number().positive('taking money means taking an amount')
    .nullable().default(null),
})

export type ReceiptResult = { ok: true } | { ok: false; message: string }

/**
 * Records how an owner was settled: gold back, or money.
 *
 * This is the third stage the source spreadsheet has no column for, and its
 * absence is why nobody could prove a lot had been settled. `receive_refining`
 * owns the rules — the lot must have been assayed, and the owner must actually
 * have a line on it — and moves the lot to RECEIVED on the first receipt.
 *
 * Several receipts against one lot are normal: metal comes back in more than
 * one delivery, and each is recorded as it arrives rather than waiting for the
 * last one.
 *
 * An owner may also take the money instead, which the source sheet has a
 * column for and this system did not. Until it did, a pooled lot whose partner
 * took cash could never be closed.
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
    p_settle_kind: parsed.data.settleKind,
    p_amount_usd: parsed.data.amountUsd,
  })
  // The database's refusals name the lot and its stage, so they are passed on
  // as they are.
  if (error) return { ok: false, message: error.message }

  revalidatePath('/refining')
  return { ok: true }
}

const lotSchema = z.object({
  lotCode: z.string().trim().min(1, 'a lot needs a code').max(40),
  refineryName: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export type LotResult = { ok: true; lotId: string } | { ok: false; message: string }

/**
 * Opens a lot.
 *
 * It starts as a draft with nothing in it: what went into a shipment is
 * assembled line by line, one owner and one description at a time, exactly as
 * the source's own sheet does it. Nothing is frozen until the lot is sent.
 */
export async function createLot(input: unknown): Promise<LotResult> {
  const parsed = lotSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid lot' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('refining_lot')
    .insert({
      lot_code: parsed.data.lotCode,
      refinery_name: parsed.data.refineryName ?? null,
      note: parsed.data.note ?? null,
    })
    .select('id')
    .single()
  if (error) {
    // A duplicate code is the usual mistake and the message from Postgres is
    // not one the accountant can act on.
    if (error.code === '23505') {
      return { ok: false, message: `lot ${parsed.data.lotCode} already exists` }
    }
    return { ok: false, message: error.message }
  }
  revalidatePath('/refining')
  return { ok: true, lotId: data.id }
}

const lineSchema = z.object({
  lotId: z.string().uuid(),
  ownerCode: z.string().trim().min(1, 'every line belongs to somebody'),
  goldTypeCode: z.string().trim().min(1),
  sourceDesc: z.string().trim().max(200).nullable().optional(),
  grossWeightGram: z.number().positive('a line with no weight is not a line'),
  goldPct: z.number().positive().max(1, 'purity is a fraction, so 0.75 rather than 75'),
  assayWeightGram: z.number().positive().nullable().optional(),
})

export type LineResult = { ok: true } | { ok: false; message: string }

/**
 * Adds one line to a lot.
 *
 * The owner sits on the line rather than on the lot, because a shipment is
 * pooled: PC49's metal and a partner's travel together and come back
 * separately. Purity is entered as a fraction because that is what the
 * generated pure weight multiplies by, and 75 where 0.75 was meant would be a
 * hundredfold error nothing downstream would question.
 */
export async function addLotLine(input: unknown): Promise<LineResult> {
  const parsed = lineSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid line' }
  }
  const supabase = await createServerSupabase()

  const { data: existing } = await supabase
    .from('refining_lot_line').select('seq').eq('lot_id', parsed.data.lotId)
  const seq = Math.max(0, ...(existing ?? []).map((r: { seq: number }) => r.seq)) + 1

  const { error } = await supabase.from('refining_lot_line').insert({
    lot_id: parsed.data.lotId,
    seq,
    owner_code: parsed.data.ownerCode,
    gold_type_code: parsed.data.goldTypeCode,
    source_desc: parsed.data.sourceDesc ?? null,
    gross_weight_gram: parsed.data.grossWeightGram,
    gold_pct: parsed.data.goldPct,
    assay_weight_gram: parsed.data.assayWeightGram ?? null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/refining')
  return { ok: true }
}

const advanceSchema = z.object({
  lotId: z.string().uuid(),
  to: z.enum(['SENT', 'ASSAYED', 'CLOSED']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  spotGoldPerOz: z.number().positive().nullable().optional(),
  spotPtPerOz: z.number().positive().nullable().optional(),
})

/**
 * Moves a lot on one stage.
 *
 * The rules belong to the database and stay there: one stage at a time, a send
 * date and a spot price before it can be sent, an assay date before it can be
 * assayed, and no closing while any owner is still owed metal. RECEIVED is not
 * offered here because it is not a decision — recording the first receipt is
 * what moves a lot into it.
 */
export async function advanceLot(input: unknown): Promise<LineResult> {
  const parsed = advanceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const { lotId, to, date, spotGoldPerOz, spotPtPerOz } = parsed.data
  const supabase = await createServerSupabase()

  const change: Record<string, unknown> = { status: to }
  if (to === 'SENT') {
    change.sent_date = date
    change.spot_gold_per_oz_sent = spotGoldPerOz ?? null
    change.spot_pt_per_oz_sent = spotPtPerOz ?? null
  }
  if (to === 'ASSAYED') {
    change.assay_date = date
    change.spot_gold_per_oz_assay = spotGoldPerOz ?? null
  }

  const { error } = await supabase.from('refining_lot').update(change).eq('id', lotId)
  // The database's refusals name the lot and say what is missing, so they are
  // passed on as they are.
  if (error) return { ok: false, message: error.message }

  revalidatePath('/refining')
  return { ok: true }
}

const pickSchema = z.object({
  lotId: z.string().uuid(),
  txnIds: z.array(z.string().uuid()).min(1, 'pick at least one purchase'),
})

export type PickResult = { ok: true; picked: number } | { ok: false; message: string }

/**
 * Puts purchases into a lot.
 *
 * This is the checkbox column of sheet `1.Scrap Gold`, which is how a refining
 * batch is actually assembled: nobody retypes weights, they tick the purchases
 * physically going in the bag and the totals fall out. Picking one that is
 * already in another lot is refused by the table, because gold cannot be sent
 * twice and a screen is not the only way in.
 */
export async function pickPurchases(input: unknown): Promise<PickResult> {
  const parsed = pickSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid selection' }
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('refining_lot_source').insert(
    parsed.data.txnIds.map((txnId) => ({ lot_id: parsed.data.lotId, txn_id: txnId })),
  )
  if (error) return { ok: false, message: error.message }

  revalidatePath('/refining')
  return { ok: true, picked: parsed.data.txnIds.length }
}

const unpickSchema = z.object({
  lotId: z.string().uuid(),
  txnId: z.string().uuid(),
})

/**
 * Takes one back out again, while the lot is still being assembled.
 *
 * Unticking a box, in other words. The purchase returns to the list of scrap
 * that could still be sent somewhere.
 */
export async function unpickPurchase(input: unknown): Promise<PickResult> {
  const parsed = unpickSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('refining_lot_source').delete()
    .eq('lot_id', parsed.data.lotId).eq('txn_id', parsed.data.txnId)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/refining')
  return { ok: true, picked: 0 }
}
