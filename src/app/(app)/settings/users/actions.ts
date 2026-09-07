'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getCurrentUser } from '@/lib/auth/currentUser'
import { createServerSupabase } from '@/lib/supabase/server'

/**
 * A client that answers to nobody.
 *
 * The service role bypasses row-level security entirely, so every path that
 * reaches it must have established who is asking FIRST, using the ordinary
 * signed-in session. That order is the whole safety property: check, then
 * escalate. Reversed, a bug in the check is a way for anybody to create an
 * administrator.
 *
 * It exists only because creating a login and setting a password live in
 * `auth.users`, which no SQL in this project can reach. Everything else about
 * a person — their role, whether their account is open, their name — is done
 * by database functions that check the caller themselves.
 */
function authAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('the server is missing its Supabase credentials')
  return createClient(url, key, { auth: { persistSession: false } })
}

/** Refuses unless the caller is a signed-in administrator. */
async function requireAdmin(): Promise<{ id: string } | null> {
  const user = await getCurrentUser()
  if (!user || user.role !== 'ADMIN') return null
  return { id: user.id }
}

/**
 * A password nobody chose and nobody has to remember.
 *
 * Read aloud once and then replaced, so it is built from an alphabet without
 * the characters people mishear or mistype — no O and 0, no l and 1 — rather
 * than from the widest set possible. A temporary password that cannot be
 * dictated over the counter is a temporary password that gets written down.
 */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(14)
  crypto.getRandomValues(bytes)
  return [...bytes].map((n) => alphabet[n % alphabet.length]).join('')
}

const newUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('that is not an email address'),
  fullName: z.string().trim().min(1, 'a person needs a name').max(120),
  role: z.enum(['KT', 'GS_US', 'OC', 'ADMIN']),
})

export type NewUserResult =
  | { ok: true; password: string }
  | { ok: false; message: string }

/**
 * Adds a colleague.
 *
 * Two steps that cannot be one: Supabase creates the login, then this system
 * records who they are. If the second fails the first is undone, because an
 * account that can sign in and has no profile has no role, sees nothing, and
 * is invisible on the very screen that would let somebody fix it.
 */
export async function createUser(input: unknown): Promise<NewUserResult> {
  const caller = await requireAdmin()
  if (!caller) return { ok: false, message: 'only an administrator may add people' }

  const parsed = newUserSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid details' }
  }
  const { email, fullName, role } = parsed.data
  const password = temporaryPassword()
  const admin = authAdmin()

  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (error) return { ok: false, message: error.message }

  // Written with the administrator's own session, not the service role: the
  // function checks who is asking and records that it was them. The service
  // role is nobody, and "nobody added this person" is not a useful audit row.
  const supabase = await createServerSupabase()
  const { error: profileError } = await supabase.rpc('register_user', {
    p_id: data.user.id, p_full_name: fullName, p_role: role,
  })
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id)
    return { ok: false, message: profileError.message }
  }

  revalidatePath('/settings/users')
  // Handed back exactly once. It is not stored anywhere, here or in the
  // database, so this return value is the only time it exists.
  return { ok: true, password }
}

const resetSchema = z.object({ userId: z.string().uuid() })

/**
 * Issues a new temporary password to somebody who cannot get in.
 *
 * Sets the flag again, so the person chooses their own the moment they are
 * back: otherwise an administrator would know a working password for somebody
 * else's account indefinitely.
 */
export async function resetPassword(input: unknown): Promise<NewUserResult> {
  const caller = await requireAdmin()
  if (!caller) return { ok: false, message: 'only an administrator may reset a password' }

  const parsed = resetSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Invalid request' }

  const password = temporaryPassword()
  const admin = authAdmin()

  const { error } = await admin.auth.admin.updateUserById(parsed.data.userId, { password })
  if (error) return { ok: false, message: error.message }

  const supabase = await createServerSupabase()
  const { error: flagError } = await supabase.rpc('require_new_password', {
    p_id: parsed.data.userId,
  })
  if (flagError) return { ok: false, message: flagError.message }

  revalidatePath('/settings/users')
  return { ok: true, password }
}

export type AdminResult = { ok: true } | { ok: false; message: string }

/**
 * The four changes the database owns.
 *
 * No role check here on purpose. Each function checks the caller itself and
 * refuses in its own words, so the rule holds for anybody who reaches the
 * database — not only for people who came through this screen. What arrives
 * back is the database's sentence, passed on unchanged.
 */
export async function changeRole(input: unknown): Promise<AdminResult> {
  const parsed = z.object({
    userId: z.string().uuid(), role: z.enum(['KT', 'GS_US', 'OC', 'ADMIN']),
  }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Invalid request' }

  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('set_user_role', {
    p_id: parsed.data.userId, p_role: parsed.data.role,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/settings/users')
  return { ok: true }
}

export async function suspendUser(input: unknown): Promise<AdminResult> {
  const parsed = z.object({
    userId: z.string().uuid(),
    reason: z.string().trim().min(1, 'closing an account needs a reason'),
  }).safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error?.issues[0]?.message ?? 'Invalid request' }
  }

  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('suspend_user', {
    p_id: parsed.data.userId, p_reason: parsed.data.reason,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/settings/users')
  return { ok: true }
}

export async function restoreUser(input: unknown): Promise<AdminResult> {
  const parsed = z.object({ userId: z.string().uuid() }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Invalid request' }

  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('restore_user', { p_id: parsed.data.userId })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/settings/users')
  return { ok: true }
}

export async function renameUser(input: unknown): Promise<AdminResult> {
  const parsed = z.object({
    userId: z.string().uuid(), fullName: z.string().trim().min(1).max(120),
  }).safeParse(input)
  if (!parsed.success) return { ok: false, message: 'Invalid request' }

  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('rename_user', {
    p_id: parsed.data.userId, p_full_name: parsed.data.fullName,
  })
  if (error) return { ok: false, message: error.message }
  revalidatePath('/settings/users')
  return { ok: true }
}
