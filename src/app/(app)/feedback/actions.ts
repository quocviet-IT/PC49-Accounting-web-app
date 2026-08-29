'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const SCREENSHOT_BUCKET = 'feedback-screenshots'

const fileSchema = z.object({
  kind: z.enum(['BROKEN', 'WRONG_NUMBER', 'SUGGESTION']),
  impact: z.enum(['BLOCKING', 'SLOWS_WORK', 'MINOR']),
  description: z.string().trim().min(5, 'a sentence or two, so somebody can act on it').max(4000),
  pageUrl: z.string().max(500),
  pageRoute: z.string().max(200),
  pageTitle: z.string().max(200).optional(),
  // A PNG data URL from the browser, or nothing when the reporter chose not to
  // send one. Capped well under the bucket's 5 MB so an oversized capture is
  // refused here rather than after a round trip.
  screenshot: z.string().max(7_000_000).nullable().optional(),
})

export type FileResult =
  | { ok: true; screenshotStored: boolean; screenshotProblem?: string }
  | { ok: false; message: string }

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

  const { data: filed, error } = await supabase.from('feedback_report').insert({
    kind: parsed.data.kind,
    impact: parsed.data.impact,
    description: parsed.data.description,
    page_url: parsed.data.pageUrl,
    page_route: parsed.data.pageRoute,
    page_title: parsed.data.pageTitle ?? null,
    reporter_id: auth.user.id,
    reporter_role: profile?.role ?? null,
  }).select('id').single()
  if (error) return { ok: false, message: error.message }

  const shot = await attachScreenshot(supabase, filed.id, parsed.data.screenshot ?? null)

  revalidatePath('/feedback')
  return { ok: true, ...shot }
}

/**
 * Puts the picture in the bucket and points the report at it.
 *
 * In that order, and it matters: the storage policy only accepts a path whose
 * first segment is a report this person filed, so the row has to exist before
 * the upload can. A failure therefore costs the picture and never the words.
 *
 * The reporter is told when the picture did not make it. Reporting only that it
 * was not stored, without saying why, is how a screenshot somebody believes
 * they sent turns into a report nobody can act on.
 */
async function attachScreenshot(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  reportId: string,
  dataUrl: string | null,
): Promise<{ screenshotStored: boolean; screenshotProblem?: string }> {
  if (!dataUrl) return { screenshotStored: false }

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
  if (base64 === dataUrl) {
    return { screenshotStored: false, screenshotProblem: 'the capture was not a PNG' }
  }

  const path = `${reportId}/${crypto.randomUUID()}.png`
  const upload = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, Buffer.from(base64, 'base64'), { contentType: 'image/png', upsert: false })
  if (upload.error) {
    return { screenshotStored: false, screenshotProblem: upload.error.message }
  }

  // The report has no UPDATE policy, so the link goes through a function that
  // runs as its owner and checks for itself that the report is this reporter's
  // and has no picture yet. It raises rather than returning quietly: a link
  // that silently does nothing is how a stored picture ends up referenced by
  // nothing and nobody is told.
  const { error: linkError } = await supabase.rpc('attach_feedback_screenshot', {
    p_report_id: reportId,
    p_path: path,
  })
  if (linkError) {
    // An unreferenced file is litter in the client's storage. It cannot be
    // removed as the reporter — there is no delete policy — so it is reported
    // instead of left silently behind.
    return { screenshotStored: false, screenshotProblem: linkError.message }
  }

  return { screenshotStored: true }
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
  return { ok: true, screenshotStored: false }
}
