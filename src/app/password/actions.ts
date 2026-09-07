'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'

const schema = z.object({
  password: z.string().min(10, 'a password needs at least ten characters'),
})

export type ChangeResult = { ok: true } | { ok: false; message: string }

/**
 * Changing your own password.
 *
 * Done with the holder's own session, never the service role: this is the one
 * place a password is set by the person it belongs to, and it should need
 * nothing more than being signed in. An administrator cannot reach it.
 *
 * Ten characters rather than a thicket of rules about capitals and symbols.
 * The composition rules push people towards `Password1!` and a note on the
 * monitor; length is the part that actually costs an attacker something.
 */
export async function changeMyPassword(input: unknown): Promise<ChangeResult> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid password' }
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: 'nobody is signed in' }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password })
  if (error) return { ok: false, message: error.message }

  // Only after Supabase has accepted it. Clearing the flag first would leave
  // somebody holding a temporary password that nothing asks them to change.
  const { error: flagError } = await supabase.rpc('password_was_changed')
  if (flagError) return { ok: false, message: flagError.message }

  revalidatePath('/', 'layout')
  return { ok: true }
}
