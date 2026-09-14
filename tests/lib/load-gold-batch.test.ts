import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb } from '../support/db'
import { loadGoldFile, loadedTxns } from '../../scripts/lib/load-gold-batch.mjs'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 180_000)
afterAll(async () => { await db?.close() })

// The columns the translator writes, in its order (scripts/lib/sheet-rows.mjs).
const HEADER = 'txn_date,txn_type,gold_type_code,uom,qty,unit_price,amount,partner_code,'
  + 'sales,scrap_detail,gold_pct,payments,conv_key,lot_code,deposit_key,remarks'
const csv = (...lines: string[]) => `${[HEADER, ...lines].join('\n')}\n`

describe('a workbook file goes in the way the import screen takes it', () => {
  it('writes what it can, and names the line it could not take and why', async () => {
    const r = await loadGoldFile(db, {
      fileName: 'thang-4.csv',
      text: csv(
        '2026-04-22,PO,SG,GRAM,10,65,-650,Chi Lan,N.Ý,14k/grs,,AP:CASH:650,,,,',
        // Line 164 of the April tab: a sale with a price and no quantity.
        '2026-04-23,SALE,SG,GRAM,,750,0,Chi Lan,,,,,,,,',
      ),
    })
    expect(r).toMatchObject({ rows: 2, committed: 1, rejected: 1 })
    expect(r.reasons).toEqual([{ code: 'MISSING_QTY', n: 1 }])
    // The line in the file counting the header, which is the number somebody
    // with the spreadsheet open goes looking for.
    const turned = await db.query<{ row_no: number }>(
      `SELECT row_no FROM pc49.import_row WHERE batch_id = $1 AND status = 'REJECTED'`,
      [r.batchId])
    expect(turned.rows.map((x) => x.row_no)).toEqual([3])
  })

  it('leaves what it wrote off the books and off the shelf', async () => {
    // The decision of 14-09: in the system, not yet posted, so the batch can
    // still be withdrawn when the two missing workbooks arrive.
    const r = await loadGoldFile(db, {
      fileName: 'thang-2.csv',
      text: csv('2026-02-03,PO,SG,GRAM,5,60,-300,Chi Mai,,10k/grs,,AP:CASH:300,,,,'),
    })
    const t = await loadedTxns(db, [r.batchId])
    expect(t).toMatchObject({ txns: 1, posted: 0, movements: 0 })
    expect(t.firstDoc).toMatch(/^PC49-2602-\d{3}$/)
  })

  it('keeps a comma inside quotes as part of the cell', async () => {
    const r = await loadGoldFile(db, {
      fileName: 'thang-3.csv',
      text: csv('2026-03-05,PO,SG,GRAM,2,60,-120,"Nguyen, Van A",,10k/grs,,AP:CASH:120,,,,'
        + '"Chứng từ gốc 7, ghi tay"'),
    })
    const row = await db.query<{ partner_code: string; remarks: string }>(
      `SELECT t.partner_code, t.remarks FROM pc49.gold_txn t
         JOIN pc49.import_row i ON i.committed_ref = t.id WHERE i.batch_id = $1`, [r.batchId])
    expect(row.rows[0]).toEqual({ partner_code: 'Nguyen, Van A', remarks: 'Chứng từ gốc 7, ghi tay' })
  })
})
