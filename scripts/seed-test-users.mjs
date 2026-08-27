// Creates one test user per role and gives each a pc49.app_user row.
// Run: npm run seed:users
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
const dbUrl = process.env.SUPABASE_DB_URL
if (!url || !secret || !dbUrl) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL')
  process.exit(1)
}

const USERS = [
  { email: 'kt@pc49.test',    password: 'pc49-test-KT-2026',    full_name: 'Ke toan VN',    role: 'KT' },
  { email: 'gsus@pc49.test',  password: 'pc49-test-GSUS-2026',  full_name: 'US Supervisor', role: 'GS_US' },
  { email: 'oc@pc49.test',    password: 'pc49-test-OC-2026',    full_name: 'Owner',         role: 'OC' },
  { email: 'admin@pc49.test', password: 'pc49-test-ADMIN-2026', full_name: 'Administrator', role: 'ADMIN' },
]

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } })
const db = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await db.connect()

const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 })
const byEmail = new Map((existing?.users ?? []).map((u) => [u.email, u]))

for (const u of USERS) {
  let user = byEmail.get(u.email)
  if (user) {
    console.log(`exists  ${u.email}`)
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
    })
    if (error) { console.error(`FAILED  ${u.email}: ${error.message}`); process.exit(1) }
    user = data.user
    console.log(`created ${u.email}`)
  }
  await db.query(
    `INSERT INTO pc49.app_user (id, full_name, role) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET full_name = excluded.full_name, role = excluded.role`,
    [user.id, u.full_name, u.role],
  )
}

const r = await db.query('SELECT full_name, role::text FROM pc49.app_user ORDER BY role::text')
console.table(r.rows)
await db.end()
