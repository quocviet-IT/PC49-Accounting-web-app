// Một tệp giao dịch vàng vào hệ thống, đi đúng đường của màn hình Nạp dữ liệu.
//
// Dùng chung cho scripts/load-2026.mjs (cơ sở dữ liệu thật, qua pg) và cho test
// (PGlite): cả hai có db.query(sql, params) trả về { rows }.
//
// Màn hình (src/app/(app)/import/actions.ts) đọc tệp bằng parseRecords, gọi
// stage_import_row cho từng dòng với số dòng tính cả tiêu đề, rồi nút "Ghi phần
// nhận được, bỏ lại dòng lỗi" gọi commit_import_batch(lô, true). Ở đây y như
// vậy, trừ một chỗ: cả tệp được stage trong một câu lệnh thay vì một lượt đi về
// qua mạng cho mỗi dòng. Hơn một nghìn lượt tới máy chủ cơ sở dữ liệu là vài phút
// giữ một giao dịch mở.
//
// Không ghi sổ. Ghi sổ là post_import_batch, và nó không được gọi ở đây.
import { parseRecords } from '../../src/lib/import/csv-parse.ts'

/**
 * Stage rồi commit phần nhận được của một tệp giao dịch vàng.
 *
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 * @param {{ fileName: string, text: string, note?: string | null }} file
 * @returns {Promise<{ batchId: string, rows: number, committed: number, rejected: number,
 *                     reasons: { code: string, n: number }[] }>}
 */
export async function loadGoldFile(db, { fileName, text, note = null }) {
  const { rows } = parseRecords(text)
  if (rows.length === 0) throw new Error(`${fileName}: không có dòng nào`)

  const batchId = (await db.query(
    `INSERT INTO pc49.import_batch (source, file_name, note)
     VALUES ('GOLD_TXN', $1, $2) RETURNING id`, [fileName, note])).rows[0].id

  // Số dòng như màn hình ghi: tiêu đề là dòng 1, bản ghi đầu tiên là dòng 2.
  await db.query(
    `SELECT pc49.stage_import_row($1, (r.ord + 1)::int, r.payload)
       FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS r(payload, ord)
      ORDER BY r.ord`,
    [batchId, JSON.stringify(rows)])
  const staged = (await db.query(
    `SELECT count(*)::int AS n FROM pc49.import_row WHERE batch_id = $1`, [batchId])).rows[0].n
  if (staged !== rows.length) {
    throw new Error(`${fileName}: ${rows.length} dòng nhưng chỉ stage được ${staged}`)
  }

  const done = (await db.query(
    `SELECT * FROM pc49.commit_import_batch($1, true)`, [batchId])).rows[0]
  const reasons = (await db.query(
    `SELECT reason_code AS code, count(*)::int AS n FROM pc49.import_row
      WHERE batch_id = $1 AND status = 'REJECTED' GROUP BY 1 ORDER BY 2 DESC, 1`, [batchId])).rows

  return {
    batchId,
    rows: rows.length,
    committed: done.committed,
    rejected: done.left_rejected,
    reasons,
  }
}

/**
 * Những giao dịch các lô này đưa vào, và chúng có chạm tới sổ hay kho không.
 *
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 * @param {string[]} batchIds
 */
export async function loadedTxns(db, batchIds) {
  return (await db.query(
    `SELECT count(*)::int AS txns,
            count(*) FILTER (WHERE t.journal_entry_id IS NOT NULL)::int AS posted,
            (SELECT count(*)::int FROM pc49.inventory_movement m
              WHERE m.source_id IN (SELECT committed_ref FROM pc49.import_row
                                     WHERE batch_id = ANY($1::uuid[]))) AS movements,
            min(t.doc_no) AS "firstDoc", max(t.doc_no) AS "lastDoc",
            min(t.txn_date)::text AS "firstDay", max(t.txn_date)::text AS "lastDay"
       FROM pc49.gold_txn t JOIN pc49.import_row r ON r.committed_ref = t.id
      WHERE r.batch_id = ANY($1::uuid[])`, [batchIds])).rows[0]
}
