// Nạp sổ vàng 2026 vào cơ sở dữ liệu thật, chưa ghi sổ.
//
//   npm run load:2026 -- --dry-run    chạy hết, in con số, rồi hoàn tác
//   npm run load:2026                 chạy thật
//
// Mỗi tệp import-csv/01-gold-txn-*.csv đi đúng đường của màn hình Nạp dữ liệu
// (scripts/lib/load-gold-batch.mjs). Không gọi post_import_batch: theo quyết định
// ngày 14-09, giao dịch vào hệ thống nhưng chưa ghi sổ, để còn rút ra nạp lại được
// (withdraw_import_batch) khi đủ BC 201 và GENERAL REPORT. Tồn đầu và lô phân kim
// chưa nạp. Xem docs/superpowers/plans/2026-09-10-nap-giao-dich-vang-2026.md.
//
// Cả lần chạy là một giao dịch cơ sở dữ liệu: tệp nào hỏng thì không tệp nào vào.
// Tệp đã có lô nạp commit cùng tên thì dừng, không nạp hai lần.
import pg from 'pg'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGoldFile, loadedTxns } from './lib/load-gold-batch.mjs'

const DRY_RUN = process.argv.includes('--dry-run')
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CSV_DIR = join(ROOT, 'import-csv')
const NOTE = 'scripts/load-2026.mjs: giao dịch 2026, chưa ghi sổ (quyết định 14-09)'

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.error('Missing environment variable: SUPABASE_DB_URL')
  process.exit(1)
}

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await db.connect()

async function main() {
  // Bộ nạp cần 0062–0067: thanh toán và sales, phiên quy đổi, ô trống, hai luồng
  // vàng. Nạp khi thiếu chúng thì giao dịch vào mà không có tiền đi kèm.
  const applied = new Set(
    (await db.query('SELECT version FROM pc49.schema_migrations')).rows.map((r) => r.version))
  const missing = (await readdir(join(ROOT, 'supabase', 'migrations')))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .filter((v) => !applied.has(v))
  if (missing.length > 0) {
    throw new Error(`chưa áp migration ${missing.join(', ')}; chạy npm run migrate trước`)
  }

  const files = (await readdir(CSV_DIR))
    .filter((f) => /^01-gold-txn-\d{4}-\d{2}\.csv$/.test(f))
    .sort()
  if (files.length === 0) throw new Error(`không có tệp giao dịch nào trong ${CSV_DIR}`)

  const loaded = await db.query(
    `SELECT file_name FROM pc49.import_batch
      WHERE committed_at IS NOT NULL AND file_name = ANY($1)`, [files])
  if (loaded.rows.length > 0) {
    throw new Error(`đã nạp rồi: ${loaded.rows.map((r) => r.file_name).join(', ')}; `
      + 'rút lô đó ra trước nếu muốn nạp lại')
  }

  await db.query('BEGIN')
  // Không đứng chờ mãi sau một khoá của người đang nhập liệu trên màn hình.
  await db.query(`SET LOCAL lock_timeout = '15s'`)

  const summary = []
  const batches = []
  for (const file of files) {
    const r = await loadGoldFile(db, {
      fileName: file, text: await readFile(join(CSV_DIR, file), 'utf8'), note: NOTE,
    })
    batches.push(r.batchId)
    summary.push({
      'Tệp': file,
      'Dòng': r.rows,
      'Vào': r.committed,
      'Bị trả': r.rejected,
      'Lý do': r.reasons.map((x) => `${x.code} ${x.n}`).join(', '),
    })
  }
  console.table(summary)

  const t = await loadedTxns(db, batches)
  console.log(`Giao dịch: ${t.txns}, ngày ${t.firstDay} → ${t.lastDay}, `
    + `số chứng từ ${t.firstDoc} → ${t.lastDoc}`)
  if (t.posted !== 0 || t.movements !== 0) {
    throw new Error(`${t.posted} giao dịch đã ghi sổ và ${t.movements} biến động kho; `
      + 'lần nạp này không được ghi sổ')
  }

  if (DRY_RUN) {
    await db.query('ROLLBACK')
    console.log('\nCHẠY THỬ: đã hoàn tác, không ghi gì vào cơ sở dữ liệu.')
  } else {
    await db.query('COMMIT')
    console.log(`\nĐÃ NẠP: ${t.txns} giao dịch, chưa ghi sổ.`)
  }
}

try {
  await main()
} catch (err) {
  await db.query('ROLLBACK').catch(() => {})
  console.error(`DỪNG: ${err.message}`)
  process.exitCode = 1
} finally {
  await db.end()
}
