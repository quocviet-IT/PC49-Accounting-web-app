'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServerSupabase } from '@/lib/supabase/server'
import { isoDate, money, parseRecords, value } from '@/lib/import/csv-parse'

export type ImportResult =
  | {
      ok: true
      /** Lines that found an account and became cash transactions. */
      matched: number
      /** Lines held for review because no account could be placed. */
      unmatched: number
      /** Lines the file itself could not answer for: no date, or no amount. */
      unreadable: number
    }
  | { ok: false; message: string }

const inputSchema = z.object({
  fileName: z.string().max(200),
  period: z.string().max(40).optional(),
  csv: z.string().min(1, 'that file is empty').max(8_000_000),
})

/** The columns the importer needs. Everything else in the export is ignored. */
const REQUIRED = ['Date', 'Account Number', 'Amount']

/**
 * Imports a Rocket statement.
 *
 * The inversion — a negative Amount is money in — belongs to `import_bank_line`
 * and stays there. Reading the file must not quietly do it first, or the two
 * would fight and the sign would depend on which ran last.
 *
 * A line whose account cannot be placed is not dropped: the database holds it
 * in a review queue, because a bank line nobody can place is exactly the thing
 * that ends up explaining a reconciliation difference three weeks later.
 */
export async function importBankStatement(input: unknown): Promise<ImportResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid file' }
  }

  const { headers, rows } = parseRecords(parsed.data.csv)
  if (rows.length === 0) return { ok: false, message: 'that file has no rows in it' }

  const have = new Set(headers.map((h) => h.toLowerCase()))
  const missing = REQUIRED.filter((h) => !have.has(h.toLowerCase()))
  if (missing.length > 0) {
    // Naming them beats "invalid format": the usual cause is somebody exporting
    // the working sheet rather than the statement.
    return {
      ok: false,
      message: `this file has no ${missing.join(', ')} column — export the statement itself, not the working sheet`,
    }
  }

  const supabase = await createServerSupabase()
  const { data: batch, error: batchError } = await supabase
    .from('bank_import_batch')
    .insert({ file_name: parsed.data.fileName, statement_period: parsed.data.period ?? null })
    .select('id')
    .single()
  if (batchError) return { ok: false, message: batchError.message }

  let matched = 0
  let unmatched = 0
  let unreadable = 0

  for (const row of rows) {
    const date = isoDate(value(row, 'Date'))
    const amount = money(value(row, 'Amount'))
    // A row with no date or no amount is not a transaction, and guessing either
    // would put a real figure on a made-up day.
    if (date === null || amount === null) { unreadable += 1; continue }

    const { data, error } = await supabase.rpc('import_bank_line', {
      p_batch_id: batch.id,
      p_account_no: value(row, 'Account Number') || null,
      p_account_name: value(row, 'Account Name') || null,
      p_txn_date: date,
      p_raw_amount: amount,
      p_description: value(row, 'Description') || value(row, 'Name') || null,
      p_category: value(row, 'Category') || null,
    })
    if (error) return { ok: false, message: error.message }
    if (data) matched += 1
    else unmatched += 1
  }

  revalidatePath('/cash')
  return { ok: true, matched, unmatched, unreadable }
}
