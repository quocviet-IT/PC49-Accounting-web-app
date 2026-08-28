'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { parseRecords } from '@/lib/import/csv-parse'

const batchSchema = z.object({
  batchId: z.string().uuid(),
  allowPartial: z.boolean().optional(),
})

export type ActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/**
 * Commits a reviewed batch.
 *
 * The database is the one that decides whether this batch is fit to commit, and
 * it refuses a batch with rejected rows unless partial is asked for out loud.
 * Its refusal is passed back word for word: it names the count, which is what
 * the accountant needs in order to go and look.
 */
export async function commitBatch(input: unknown): Promise<ActionResult> {
  const parsed = batchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Which batch?' }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('commit_import_batch', {
    p_batch_id: parsed.data.batchId,
    p_allow_partial: parsed.data.allowPartial ?? false,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/import')
  const row = Array.isArray(data) ? data[0] : data
  const written = Number(row?.committed ?? 0)
  const left = Number(row?.left_rejected ?? 0)
  return {
    ok: true,
    message: left > 0
      ? `${written} rows written, ${left} left behind`
      : `${written} rows written`,
  }
}

/** Takes a committed batch back out, if nothing has been built on top of it. */
export async function withdrawBatch(input: unknown): Promise<ActionResult> {
  const parsed = batchSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Which batch?' }

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('withdraw_import_batch', {
    p_batch_id: parsed.data.batchId,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/import')
  return { ok: true, message: `${Number(data ?? 0)} rows withdrawn` }
}

const stageSchema = z.object({
  source: z.enum([
    'GOLD_PRICE', 'SPOT_PRICE', 'OPENING_INVENTORY', 'OPENING_CASH',
    'GOLD_TXN', 'JOURNAL', 'REFINING_LOT',
  ]),
  fileName: z.string().max(200),
  sheetName: z.string().max(200).optional(),
  csv: z.string().min(1, 'that file is empty').max(8_000_000),
})

export type StageResult =
  | { ok: true; batchId: string; total: number; valid: number; rejected: number }
  | { ok: false; message: string }

/**
 * Stages a file for review.
 *
 * Nothing is written to the books here. Every row goes to `stage_import_row`,
 * which judges it and keeps the reason if it cannot be taken — the point of the
 * whole package is that somebody looks at what was turned back before anything
 * is committed.
 *
 * The row number recorded is the line in the file, counting the header, so a
 * rejection can be pointed at in the spreadsheet the accountant still has open.
 */
export async function stageFile(input: unknown): Promise<StageResult> {
  const parsed = stageSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid file' }
  }

  const { headers, rows } = parseRecords(parsed.data.csv)
  if (rows.length === 0) return { ok: false, message: 'that file has no rows in it' }
  if (headers.length === 0) return { ok: false, message: 'that file has no header row' }

  const supabase = await createServerSupabase()
  const { data: batch, error: batchError } = await supabase
    .from('import_batch')
    .insert({
      source: parsed.data.source,
      file_name: parsed.data.fileName,
      sheet_name: parsed.data.sheetName ?? null,
    })
    .select('id')
    .single()
  if (batchError) return { ok: false, message: batchError.message }

  let valid = 0
  let rejected = 0
  for (const [i, row] of rows.entries()) {
    const { data, error } = await supabase.rpc('stage_import_row', {
      p_batch_id: batch.id,
      // +2: the header is line one, and the first record is line two.
      p_row_no: i + 2,
      p_payload: row,
    })
    if (error) return { ok: false, message: error.message }
    if (data === 'REJECTED') rejected += 1
    else valid += 1
  }

  revalidatePath('/import')
  return { ok: true, batchId: batch.id, total: rows.length, valid, rejected }
}

const expectedSchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a figure belongs to a date'),
  metric: z.enum(['INVENTORY_GRAM', 'CASH_BALANCE', 'LEDGER_DEBIT', 'LEDGER_CREDIT']),
  metricKey: z.string().trim().min(1, 'which gold type or which account?'),
  expected: z.number().refine(Number.isFinite, 'that is not a number'),
  sourceNote: z.string().trim().max(200).nullable().optional(),
})

export type ExpectedResult = { ok: true } | { ok: false; message: string }

/**
 * States what the spreadsheet says a figure closed at.
 *
 * This is the half of the reconciliation the loader cannot work out for itself,
 * and until now it could only be written in SQL — so the comparison existed and
 * nobody could set it up. Recorded before the detail is loaded, which is the
 * whole point: the system is then asked whether the detail adds up to it,
 * rather than being trusted to have got there.
 */
export async function setExpectedFigure(input: unknown): Promise<ExpectedResult> {
  const parsed = expectedSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid figure' }
  }
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('import_expected_figure').upsert({
    as_of: parsed.data.asOf,
    metric: parsed.data.metric,
    metric_key: parsed.data.metricKey,
    expected: parsed.data.expected,
    source_note: parsed.data.sourceNote ?? null,
  }, { onConflict: 'as_of,metric,metric_key' })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/import')
  return { ok: true }
}

/** Removes a figure somebody stated by mistake. */
export async function clearExpectedFigure(input: unknown): Promise<ExpectedResult> {
  const parsed = z.object({
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    metric: z.string().min(1),
    metricKey: z.string().min(1),
  }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Which figure?' }

  const supabase = await createServerSupabase()
  const { error } = await supabase.from('import_expected_figure').delete()
    .eq('as_of', parsed.data.asOf)
    .eq('metric', parsed.data.metric)
    .eq('metric_key', parsed.data.metricKey)
  if (error) return { ok: false, message: error.message }

  revalidatePath('/import')
  return { ok: true }
}
