import { PGlite } from '@electric-sql/pglite'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * A real PostgreSQL instance (PGlite/WASM) with the parts of Supabase our
 * migrations depend on stubbed in, then every migration applied in order.
 *
 * This exists so migrations are executed rather than merely inspected as text.
 */
const SUPABASE_STUB = `
  CREATE SCHEMA IF NOT EXISTS auth;

  CREATE TABLE IF NOT EXISTS auth.users (
    id    uuid PRIMARY KEY,
    email text UNIQUE
  );

  -- Supabase exposes the signed-in user's id this way. Tests set the claim
  -- with set_config('request.jwt.claim.sub', '<uuid>', true).
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE AS $fn$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $fn$;

  DO $do$ BEGIN
    CREATE ROLE authenticated;
  EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

  DO $do$ BEGIN
    CREATE ROLE anon;
  EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

  -- PostgREST connects as this role and switches to anon or authenticated per
  -- request. Migrations configure its exposed schemas, so it has to exist here.
  DO $do$ BEGIN
    CREATE ROLE authenticator;
  EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
`

export async function migrationFiles(): Promise<string[]> {
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  return files.map((f) => path.join(dir, f))
}

export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create()
  await db.exec(SUPABASE_STUB)
  for (const file of await migrationFiles()) {
    const sql = await readFile(file, 'utf8')
    try {
      await db.exec(sql)
    } catch (err) {
      throw new Error(`${path.basename(file)} failed to apply: ${(err as Error).message}`)
    }
  }
  return db
}

/** Runs `fn` as if the given user were signed in, for testing RLS policies. */
export async function asUser<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false)`)
  try {
    return await fn()
  } finally {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`)
  }
}

/**
 * Runs `fn` the way the application runs it: as `authenticated`, with the
 * user's id in the JWT claim.
 *
 * `asUser` above only sets the claim, so it still executes as the database
 * owner — which is exempt from both table grants and row-level security. That
 * is fine for testing what a function computes and useless for testing what a
 * function is allowed to touch. A triage function that could not write to the
 * audit log passed eleven tests under `asUser` and failed on the first real
 * click, because owner-me was allowed and authenticated-me was not.
 *
 * Use this wherever a test's point is permission rather than arithmetic.
 */
export async function asRole<T>(db: PGlite, userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', false)`)
  await db.exec(`SET ROLE authenticated`)
  try {
    return await fn()
  } finally {
    // RESET, not SET ROLE postgres: the owner's name is not ours to assume.
    await db.exec(`RESET ROLE`)
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '', false)`)
  }
}
