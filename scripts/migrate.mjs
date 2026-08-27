import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

await client.query('CREATE SCHEMA IF NOT EXISTS pc49')
await client.query(`CREATE TABLE IF NOT EXISTS pc49.schema_migrations (
  version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)

const applied = new Set(
  (await client.query('SELECT version FROM pc49.schema_migrations')).rows.map((r) => r.version),
)

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
let count = 0
for (const file of files) {
  const version = file.replace(/\.sql$/, '')
  if (applied.has(version)) {
    console.log(`skip  ${version}`)
    continue
  }
  const sql = await readFile(path.join(dir, file), 'utf8')
  console.log(`apply ${version}`)
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query(
      'INSERT INTO pc49.schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
      [version],
    )
    await client.query('COMMIT')
    count += 1
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(`FAILED ${version}: ${err.message}`)
    await client.end()
    process.exit(1)
  }
}
console.log(`Applied ${count} migration(s).`)
await client.end()
