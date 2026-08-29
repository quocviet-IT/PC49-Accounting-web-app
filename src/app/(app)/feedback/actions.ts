'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const fileSchema = z.object({
  kind: z.enum(['BROKEN', 'WRONG_NUMBER', 'SUGGESTION']),
  impact: z.enum(['BLOCKING', 'SLOWS_WORK', 'MINOR']),
  description: z.string().trim().min(5, 'a sentence or two, so somebody can act on it').max(4000),
  pageUrl: z.string().max(500),
  pageRoute: z.string().max(200),
  pageTitle: z.string().max(200).optional(),
})

export type FileResult = { ok: true } | { ok: false; message: string }

/**
 * Files a report.
 *
 * The page it came from is taken from the browser rather than typed, because
 * the reporter should not have to describe where they were — and because what
 * they would write ("the gold page") is never the address that reproduces it.
 */
export async function fileReport(input: unknown): Promise<FileResult> {
  const parsed = fileSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid report' }
  }
  const supabase = await createServerSupabase()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, message: 'sign in first' }
  const { data: profile } = await supabase
    .from('app_user').select('role').eq('id', auth.user.id).maybeSingle()

  const { error } = await supabase.from('feedback_report').insert({
    kind: parsed.data.kind,
    impact: parsed.data.impact,
    description: parsed.data.description,
    page_url: parsed.data.pageUrl,
    page_route: parsed.data.pageRoute,
    page_title: parsed.data.pageTitle ?? null,
    reporter_id: auth.user.id,
    reporter_role: profile?.role ?? null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/feedback')
  return { ok: true }
}

const triageSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['NEW', 'LOOKING', 'FIXED', 'DECLINED']),
  note: z.string().trim().max(2000).nullable().optional(),
})

/**
 * Moves a report between queues.
 *
 * The rule that a declined report needs a reason lives in the database, so it
 * holds however the status is changed. Its refusal is passed on as it is: it is
 * written for whoever is doing the triage.
 */
export async function triageReport(input: unknown): Promise<FileResult> {
  const parsed = triageSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Which report?' }

  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('set_feedback_status', {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_note: parsed.data.note ?? null,
  })
  if (error) return { ok: false, message: error.message }

  revalidatePath('/feedback')
  return { ok: true }
}
