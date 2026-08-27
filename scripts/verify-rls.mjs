// Signs in as each test user and checks what they can actually see through
// PostgREST with row level security enforced. This is the end-to-end check the
// PGlite suite cannot make, because PGlite runs as superuser.
// Run: npm run verify:rls
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY

const USERS = [
  { email: 'kt@pc49.test',    password: 'pc49-test-KT-2026',    role: 'KT' },
  { email: 'gsus@pc49.test',  password: 'pc49-test-GSUS-2026',  role: 'GS_US' },
  { email: 'oc@pc49.test',    password: 'pc49-test-OC-2026',    role: 'OC' },
  { email: 'admin@pc49.test', password: 'pc49-test-ADMIN-2026', role: 'ADMIN' },
]

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)}${detail}`)
}

// A direct connection, used only to clear up after the write checks below.
const admin49 = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await admin49.connect()

// Anonymous callers must see nothing at all.
{
  const sb = createClient(url, pub)
  const r = await sb.schema('pc49').from('gold_type').select('code').limit(1)
  check('anonymous cannot read gold_type', !!r.error, r.error ? '' : `got ${JSON.stringify(r.data)}`)
}

for (const u of USERS) {
  const sb = createClient(url, pub, { auth: { persistSession: false } })
  const { error: signInError } = await sb.auth.signInWithPassword({ email: u.email, password: u.password })
  check(`${u.role} can sign in`, !signInError, signInError?.message ?? '')
  if (signInError) continue

  const { data: session } = await sb.auth.getUser()
  const own = await sb.schema('pc49').from('app_user')
    .select('role').eq('id', session.user.id).single()
  check(`${u.role} reads own profile and role matches`,
    !own.error && own.data?.role === u.role,
    own.error?.message ?? `got ${own.data?.role}`)

  // Only an administrator may see other people's rows.
  const all = await sb.schema('pc49').from('app_user').select('id')
  const visible = all.data?.length ?? 0
  check(`${u.role} sees ${u.role === 'ADMIN' ? 'every user' : 'only itself'}`,
    u.role === 'ADMIN' ? visible === 4 : visible === 1,
    `${visible} row(s)`)

  const gold = await sb.schema('pc49').from('gold_type').select('code')
  check(`${u.role} reads reference data`, !gold.error && (gold.data?.length ?? 0) === 9,
    gold.error?.message ?? `${gold.data?.length} rows`)

  // Only ADMIN may change a system parameter.
  const upd = await sb.schema('pc49').from('system_param')
    .update({ unit: 'gram/oz' }).eq('key', 'VALUATION_GRAM_PER_OZ').select()
  const changed = !upd.error && (upd.data?.length ?? 0) > 0
  check(`${u.role} ${u.role === 'ADMIN' ? 'may' : 'may not'} change a system parameter`,
    u.role === 'ADMIN' ? changed : !changed)

  // Loading history rewrites the books, so only the accountant and an
  // administrator may open a batch. Everyone may read one: knowing that a load
  // happened is not the same as being able to run one.
  const opened = await sb.schema('pc49').from('import_batch')
    .insert({ source: 'OPENING_CASH', file_name: `rls-check-${u.role}.xlsx` }).select()
  const mayLoad = u.role === 'KT' || u.role === 'ADMIN'
  const didOpen = !opened.error && (opened.data?.length ?? 0) > 0
  check(`${u.role} ${mayLoad ? 'may' : 'may not'} open an import batch`,
    mayLoad ? didOpen : !didOpen, opened.error?.message?.slice(0, 40) ?? '')
  if (didOpen) {
    await admin49.query('DELETE FROM pc49.import_batch WHERE id = $1', [opened.data[0].id])
  }

  const read = await sb.schema('pc49').from('import_batch').select('id')
  check(`${u.role} may read the list of batches`, !read.error, read.error?.message ?? '')

  await sb.auth.signOut()
}

await admin49.end()

// Suspending a user must remove every permission.
{
  const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  const admin = createClient(url, secret, { auth: { persistSession: false } })
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 })
  const kt = data.users.find((x) => x.email === 'kt@pc49.test')
  await db.query('UPDATE pc49.app_user SET suspended_at = now() WHERE id = $1', [kt.id])

  const sb = createClient(url, pub, { auth: { persistSession: false } })
  await sb.auth.signInWithPassword({ email: 'kt@pc49.test', password: 'pc49-test-KT-2026' })
  const gold = await sb.schema('pc49').from('gold_type').select('code')
  check('a suspended user loses access to reference data',
    !gold.error && (gold.data?.length ?? 0) === 0,
    gold.error?.message ?? `${gold.data?.length} rows`)
  await sb.auth.signOut()

  await db.query('UPDATE pc49.app_user SET suspended_at = NULL WHERE id = $1', [kt.id])
  await db.end()
}

console.log(failures === 0 ? '\nALL RLS CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
