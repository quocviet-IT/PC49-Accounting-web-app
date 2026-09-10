'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { SCRAP_BANDS } from '@/components/gold/types'

export type Result = { ok: true } | { ok: false; message: string }

const uuid = z.string().uuid()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date is needed')

function refresh(lotId?: string) {
  revalidatePath('/refining')
  if (lotId) revalidatePath(`/refining/${lotId}`)
}

// ---------------------------------------------------------------- the lot

const newLotSchema = z.object({
  refineryName: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
})

export type NewLotResult = { ok: true; lotId: string; lotCode: string } | { ok: false; message: string }

/**
 * Opens a lot. Its code is minted by the database (0057, C4: "phần mềm tự
 * đánh số được"), so nothing is asked for beyond who it is going to.
 */
export async function createLot(input: unknown): Promise<NewLotResult> {
  const parsed = newLotSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid lot' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('refining_lot')
    .insert({
      lot_code: '',
      refinery_name: parsed.data.refineryName ?? null,
      note: parsed.data.note ?? null,
    })
    .select('id, lot_code')
    .single()
  if (error) return { ok: false, message: error.message }
  refresh(data.id)
  return { ok: true, lotId: data.id, lotCode: data.lot_code }
}

// ----------------------------------------------------- picking purchases

const pickSchema = z.object({
  lotId: uuid,
  txnIds: z.array(uuid).min(1, 'pick at least one purchase'),
})

/**
 * Puts purchases into a lot — the checkbox column of sheet 1.Scrap Gold.
 *
 * Picking one already in another lot is refused by the table: gold cannot be
 * sent twice, and a screen is not the only way in.
 */
export async function pickPurchases(input: unknown): Promise<Result> {
  const parsed = pickSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid selection' }
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('refining_lot_source').insert(
    parsed.data.txnIds.map((txnId) => ({ lot_id: parsed.data.lotId, txn_id: txnId })),
  )
  if (error) return { ok: false, message: error.message }
  refresh(parsed.data.lotId)
  return { ok: true }
}

const unpickSchema = z.object({ lotId: uuid, txnIds: z.array(uuid).min(1) })

/** Takes purchases back out again while the lot is still being assembled. */
export async function unpickPurchases(input: unknown): Promise<Result> {
  const parsed = unpickSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('refining_lot_source').delete()
    .eq('lot_id', parsed.data.lotId).in('txn_id', parsed.data.txnIds)
  if (error) return { ok: false, message: error.message }
  refresh(parsed.data.lotId)
  return { ok: true }
}

// -------------------------------------------------------------- the bags

const bagSchema = z.object({
  lotId: uuid,
  ownerCode: z.string().trim().min(1, 'every bag belongs to somebody').default('PC49'),
  goldTypeCode: z.string().trim().min(1),
  sourceDesc: z.string().trim().max(200).nullable().optional(),
  grossWeightGram: z.number().positive('a bag with no weight is not a bag'),
  // A fraction, as everywhere else: 0.75, not 75. Optional — most scrap has
  // no measured purity until the refinery reports it.
  goldPct: z.number().positive().max(1, 'purity is a fraction, so 0.75 rather than 75')
    .nullable().optional(),
})

/**
 * One bag, written by hand.
 *
 * For what did not come through the picker: bullion sent alongside the scrap
 * ("18CS", "6ML"), or a partner's bag travelling in the same shipment. The
 * owner sits on the bag rather than the lot for exactly that reason.
 */
export async function addBag(input: unknown): Promise<Result> {
  const parsed = bagSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid bag' }
  }
  const supabase = await createServerSupabase()
  const { data: existing } = await supabase
    .from('refining_lot_line').select('seq').eq('lot_id', parsed.data.lotId)
  const seq = Math.max(0, ...(existing ?? []).map((r: { seq: number }) => r.seq)) + 1

  const { error } = await supabase.from('refining_lot_line').insert({
    lot_id: parsed.data.lotId,
    seq,
    owner_code: parsed.data.ownerCode,
    metal: parsed.data.goldTypeCode === 'PT' ? 'PLATINUM' : 'GOLD',
    gold_type_code: parsed.data.goldTypeCode,
    source_desc: parsed.data.sourceDesc ?? null,
    gross_weight_gram: parsed.data.grossWeightGram,
    gold_pct: parsed.data.goldPct ?? null,
  })
  if (error) return { ok: false, message: error.message }
  refresh(parsed.data.lotId)
  return { ok: true }
}

const updateBagSchema = z.object({
  lotId: uuid,
  lineId: uuid,
  grossWeightGram: z.number().positive().optional(),
  goldPct: z.number().positive().max(1).nullable().optional(),
  sourceDesc: z.string().trim().max(200).nullable().optional(),
})

/**
 * What was written on the bag when it was packed (B9a: the send row is
 * written "lúc cân gói hàng"). The weight and purity the picker offered are a
 * starting point; the scale and the X-ray at packing have the last word.
 */
export async function updateBag(input: unknown): Promise<Result> {
  const parsed = updateBagSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid bag' }
  }
  const { lotId, lineId, ...rest } = parsed.data
  const change: Record<string, unknown> = {}
  if (rest.grossWeightGram !== undefined) change.gross_weight_gram = rest.grossWeightGram
  if (rest.goldPct !== undefined) change.gold_pct = rest.goldPct
  if (rest.sourceDesc !== undefined) change.source_desc = rest.sourceDesc
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('refining_lot_line').update(change)
    .eq('id', lineId).eq('lot_id', lotId)
  if (error) return { ok: false, message: error.message }
  refresh(lotId)
  return { ok: true }
}

export async function deleteBag(input: unknown): Promise<Result> {
  const parsed = z.object({ lotId: uuid, lineId: uuid }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Invalid request' }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('refining_lot_line').delete()
    .eq('id', parsed.data.lineId).eq('lot_id', parsed.data.lotId)
  if (error) return { ok: false, message: error.message }
  refresh(parsed.data.lotId)
  return { ok: true }
}

/**
 * Turns what was picked into bags — one per grade per metal.
 *
 * The last step of the spreadsheet's batch tab, done by the system: the
 * ticked purchases become the rows that leave the vault, and the totals stop
 * being a calculation and become the bags. Each bag's purity is the picked
 * purchases' average weighted by grams, over those that have one (0058);
 * where none do the bag goes without, to be measured at packing.
 *
 * Re-running replaces the bags this made before and leaves hand-written ones
 * alone, so ticking one more purchase does not double the lot.
 */
export async function bagsFromPicked(input: unknown): Promise<Result & { made?: number }> {
  const parsed = z.object({ lotId: uuid }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Invalid request' }
  const { lotId } = parsed.data
  const supabase = await createServerSupabase()

  const { data: bands, error: bandError } = await supabase
    .from('v_refining_lot_source_summary')
    .select('grade_band, gold_type_code, gross_weight_gram, avg_gold_pct')
    .eq('lot_id', lotId)
  if (bandError) return { ok: false, message: bandError.message }

  const usable = (bands ?? []).filter(
    (b: { grade_band: string | null }) => b.grade_band !== null)
  if (usable.length === 0) {
    return { ok: false, message: 'nothing picked carries a grade to bag it by' }
  }

  // The bags this action made before are the house's, labelled with a band.
  const { error: clearError } = await supabase.from('refining_lot_line').delete()
    .eq('lot_id', lotId).eq('owner_code', 'PC49').in('source_desc', [...SCRAP_BANDS])
  if (clearError) return { ok: false, message: clearError.message }

  const { data: existing } = await supabase
    .from('refining_lot_line').select('seq').eq('lot_id', lotId)
  let seq = Math.max(0, ...(existing ?? []).map((r: { seq: number }) => r.seq))

  const rows = usable.map((b: {
    grade_band: string; gold_type_code: string; gross_weight_gram: number; avg_gold_pct: number | null
  }) => {
    seq += 1
    return {
      lot_id: lotId,
      seq,
      owner_code: 'PC49',
      metal: b.gold_type_code === 'PT' ? 'PLATINUM' : 'GOLD',
      gold_type_code: b.gold_type_code,
      source_desc: b.grade_band,
      gross_weight_gram: Number(b.gross_weight_gram),
      gold_pct: b.avg_gold_pct === null ? null : Number(b.avg_gold_pct),
    }
  })

  const { error } = await supabase.from('refining_lot_line').insert(rows)
  if (error) return { ok: false, message: error.message }
  refresh(lotId)
  return { ok: true, made: rows.length }
}

// ------------------------------------------------------------- the stages

const sendSchema = z.object({
  lotId: uuid,
  date: day,
  spotGoldPerOz: z.number().positive().nullable().optional(),
  spotPtPerOz: z.number().positive().nullable().optional(),
})

/**
 * The gold leaves. 0056 books the transfers; the status trigger stamps the
 * loss rates and insists on a date and a spot.
 *
 * The spot is that day's from the price table unless one is typed — the
 * accountant records it there every morning ("Cập nhật giá"), from A-Mark,
 * and this is the figure the estimate is priced on.
 */
export async function sendLot(input: unknown): Promise<Result> {
  const parsed = sendSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request' }
  }
  const { lotId, date } = parsed.data
  const supabase = await createServerSupabase()
  const spot = await spotFor(supabase, date)
  const gold = parsed.data.spotGoldPerOz ?? spot.GOLD
  const pt = parsed.data.spotPtPerOz ?? spot.PLATINUM
  if (gold === null && pt === null) {
    return { ok: false, message: `no spot price recorded for ${date}; set it on Giá vàng or type it here` }
  }
  const { error } = await supabase.from('refining_lot').update({
    status: 'SENT', sent_date: date,
    spot_gold_per_oz_sent: gold, spot_pt_per_oz_sent: pt,
  }).eq('id', lotId)
  if (error) return { ok: false, message: error.message }
  refresh(lotId)
  return { ok: true }
}

const assaySchema = z.object({
  lotId: uuid,
  date: day,
  spotGoldPerOz: z.number().positive().nullable().optional(),
  spotPtPerOz: z.number().positive().nullable().optional(),
  lines: z.array(z.object({
    lineId: uuid,
    assayWeightGram: z.number().positive(),
    assayPct: z.number().positive().max(1),
  })),
})

/**
 * The refinery's answer, per bag, in one statement (0059).
 */
export async function recordAssay(input: unknown): Promise<Result> {
  const parsed = assaySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid assay' }
  }
  const { lotId, date, lines } = parsed.data
  const supabase = await createServerSupabase()
  const spot = await spotFor(supabase, date)
  const { error } = await supabase.rpc('record_assay', {
    p_lot_id: lotId,
    p_date: date,
    p_spot_gold: parsed.data.spotGoldPerOz ?? spot.GOLD,
    p_spot_pt: parsed.data.spotPtPerOz ?? spot.PLATINUM,
    p_lines: lines,
  })
  if (error) return { ok: false, message: error.message }
  refresh(lotId)
  return { ok: true }
}

const receiptSchema = z.object({
  lotId: uuid,
  ownerCode: z.string().min(1),
  date: day,
  settleKind: z.enum(['METAL', 'CASH']).default('METAL'),
  qtyGram: z.number().positive().nullable().default(null),
  unitPrice: z.number().positive().nullable().optional(),
  amountUsd: z.number().positive().nullable().default(null),
})

/**
 * How an owner was settled: metal back (which 0056 books into the vault for
 * the house), or the money instead (0050). Several per lot are normal.
 */
export async function recordReceipt(input: unknown): Promise<Result> {
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
  if (error) return { ok: false, message: error.message }
  refresh(parsed.data.lotId)
  return { ok: true }
}

export async function closeLot(input: unknown): Promise<Result> {
  const parsed = z.object({ lotId: uuid }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Invalid request' }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('refining_lot')
    .update({ status: 'CLOSED' }).eq('id', parsed.data.lotId)
  if (error) return { ok: false, message: error.message }
  refresh(parsed.data.lotId)
  return { ok: true }
}

// ---------------------------------------------------------------- helpers

/** The day's spot per ounce, per metal, from the price table; null where unset. */
async function spotFor(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>, date: string,
): Promise<{ GOLD: number | null; PLATINUM: number | null }> {
  const { data } = await supabase.from('spot_price_daily')
    .select('metal, spot_per_oz').eq('price_date', date)
  const out: { GOLD: number | null; PLATINUM: number | null } = { GOLD: null, PLATINUM: null }
  for (const r of (data ?? []) as { metal: 'GOLD' | 'PLATINUM'; spot_per_oz: number }[]) {
    out[r.metal] = Number(r.spot_per_oz)
  }
  return out
}

/** Read by the send dialog to offer the day's figure before it is confirmed. */
export async function spotOn(date: string): Promise<{ GOLD: number | null; PLATINUM: number | null }> {
  const supabase = await createServerSupabase()
  return spotFor(supabase, date)
}
