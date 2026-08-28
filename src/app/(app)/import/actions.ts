'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

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
