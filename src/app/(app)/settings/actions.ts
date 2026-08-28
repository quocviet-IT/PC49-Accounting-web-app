'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; message: string }

/** A price cell left blank clears the figure rather than storing zero. */
const optionalNumber = z
  .union([z.number(), z.null()])
  .refine((n) => n === null || (Number.isFinite(n) && n >= 0), 'a price cannot be negative')

const goldPriceSchema = z.object({
  priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goldTypeCode: z.string().min(1),
  marketPrice: optionalNumber,
  avgPurchasePrice: optionalNumber,
})

/**
 * Sets one gold type's price for one day.
 *
 * Written a cell at a time rather than a whole grid at once, because that is how
 * the price sheet is filled in: a figure arrives, it gets typed, and the next
 * one arrives later. A save-the-whole-day button would make the accountant
 * responsible for figures they had not touched.
 */
export async function saveGoldPrice(input: unknown): Promise<ActionResult> {
  const parsed = goldPriceSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid price' }
  }
  const { priceDate, goldTypeCode, marketPrice, avgPurchasePrice } = parsed.data
  const supabase = await createServerSupabase()

  // Both figures empty means the day has no price for this type at all, which is
  // a different statement from "the price is zero".
  if (marketPrice === null && avgPurchasePrice === null) {
    const { error } = await supabase.from('gold_price_daily').delete()
      .eq('price_date', priceDate).eq('gold_type_code', goldTypeCode)
    if (error) return { ok: false, message: error.message }
    revalidatePath('/settings/prices')
    return { ok: true }
  }

  const { error } = await supabase.from('gold_price_daily').upsert({
    price_date: priceDate,
    gold_type_code: goldTypeCode,
    market_price: marketPrice,
    avg_purchase_price: avgPurchasePrice,
    source: 'manual',
  }, { onConflict: 'price_date,gold_type_code' })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings/prices')
  return { ok: true }
}

const spotSchema = z.object({
  priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  metal: z.enum(['GOLD', 'PLATINUM']),
  spotPerOz: optionalNumber,
})

/** The market spot price, quoted per ounce the way the market quotes it. */
export async function saveSpotPrice(input: unknown): Promise<ActionResult> {
  const parsed = spotSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid spot price' }
  }
  const { priceDate, metal, spotPerOz } = parsed.data
  const supabase = await createServerSupabase()

  if (spotPerOz === null) {
    const { error } = await supabase.from('spot_price_daily').delete()
      .eq('price_date', priceDate).eq('metal', metal)
    if (error) return { ok: false, message: error.message }
    revalidatePath('/settings/prices')
    return { ok: true }
  }

  const { error } = await supabase.from('spot_price_daily').upsert({
    price_date: priceDate, metal, spot_per_oz: spotPerOz, source: 'manual',
  }, { onConflict: 'price_date,metal' })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/settings/prices')
  return { ok: true }
}

/**
 * Copies a day's prices forward.
 *
 * The gold price does not move on a day nobody traded, and the source sheet
 * carries the previous figure forward by hand. Doing it in one action beats nine
 * retyped numbers, and it only ever fills gaps: a figure already set for the
 * target day is left where it is.
 */
export async function carryPricesForward(input: unknown): Promise<ActionResult> {
  const parsed = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Which day?' }
  const { from, to } = parsed.data
  if (from === to) return { ok: false, message: 'Those are the same day' }

  const supabase = await createServerSupabase()
  const [gold, spot, already, spotAlready] = await Promise.all([
    supabase.from('gold_price_daily')
      .select('gold_type_code, market_price, avg_purchase_price').eq('price_date', from),
    supabase.from('spot_price_daily').select('metal, spot_per_oz').eq('price_date', from),
    supabase.from('gold_price_daily').select('gold_type_code').eq('price_date', to),
    supabase.from('spot_price_daily').select('metal').eq('price_date', to),
  ])

  const held = new Set((already.data ?? []).map((r: { gold_type_code: string }) => r.gold_type_code))
  const rows = (gold.data ?? [])
    .filter((r: { gold_type_code: string }) => !held.has(r.gold_type_code))
    .map((r: { gold_type_code: string; market_price: number; avg_purchase_price: number }) => ({
      price_date: to,
      gold_type_code: r.gold_type_code,
      market_price: r.market_price,
      avg_purchase_price: r.avg_purchase_price,
      source: `carried from ${from}`,
    }))

  const heldSpot = new Set((spotAlready.data ?? []).map((r: { metal: string }) => r.metal))
  const spotRows = (spot.data ?? [])
    .filter((r: { metal: string }) => !heldSpot.has(r.metal))
    .map((r: { metal: string; spot_per_oz: number }) => ({
      price_date: to, metal: r.metal, spot_per_oz: r.spot_per_oz,
      source: `carried from ${from}`,
    }))

  if (rows.length === 0 && spotRows.length === 0) {
    return { ok: false, message: 'nothing to carry: that day is already priced' }
  }
  if (rows.length > 0) {
    const { error } = await supabase.from('gold_price_daily').insert(rows)
    if (error) return { ok: false, message: error.message }
  }
  if (spotRows.length > 0) {
    const { error } = await supabase.from('spot_price_daily').insert(spotRows)
    if (error) return { ok: false, message: error.message }
  }

  revalidatePath('/settings/prices')
  return { ok: true, message: `${rows.length + spotRows.length} carried forward` }
}

const periodSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  close: z.boolean(),
  note: z.string().max(500).optional(),
})

/**
 * Closes or reopens a month.
 *
 * A period with no row is already open, so reopening sets the row back to OPEN
 * rather than deleting it - the table grants no DELETE, and in any case a row
 * saying "open" is a better answer to "what happened to February" than no row
 * at all. The guard on `journal_entry` does the enforcing; this records the
 * decision and who made it.
 */
export async function setPeriodStatus(input: unknown): Promise<ActionResult> {
  const parsed = periodSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Which month?' }
  const { period, close, note } = parsed.data

  const supabase = await createServerSupabase()
  if (!close) {
    const { data, error } = await supabase.from('accounting_period')
      .update({ status: 'OPEN', closed_at: null, closed_by: null, note: note ?? null })
      .eq('period', period).select()
    if (error) return { ok: false, message: error.message }
    if ((data?.length ?? 0) === 0) {
      return { ok: false, message: 'that period was not reopened; only a supervisor may' }
    }
    revalidatePath('/settings/periods')
    return { ok: true }
  }

  const { data: user } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('accounting_period').upsert({
    period,
    status: 'CLOSED',
    closed_at: new Date().toISOString(),
    closed_by: user.user?.id ?? null,
    note: note ?? null,
  }, { onConflict: 'period' }).select()
  if (error) return { ok: false, message: error.message }
  if ((data?.length ?? 0) === 0) {
    return { ok: false, message: 'that period was not closed; only a supervisor may' }
  }

  revalidatePath('/settings/periods')
  return { ok: true }
}

const paramSchema = z.object({
  key: z.string().min(1),
  value: z.number().refine(Number.isFinite, 'that is not a number'),
})

/** Changes one system parameter. Administrator only, enforced by the database. */
export async function saveSystemParam(input: unknown): Promise<ActionResult> {
  const parsed = paramSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid value' }
  }
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.from('system_param')
    .update({ value: parsed.data.value, updated_at: new Date().toISOString() })
    .eq('key', parsed.data.key).select()
  if (error) return { ok: false, message: error.message }
  if ((data?.length ?? 0) === 0) {
    return { ok: false, message: 'that parameter was not changed; only an administrator may' }
  }

  revalidatePath('/settings/reference')
  return { ok: true }
}
