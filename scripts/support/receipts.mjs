/**
 * Takes a check's receipts off the day it wrote them on.
 *
 * Called after the check has deleted its lines, which point at the receipts.
 * A correction points at the receipt it replaced, so that link goes first.
 * Production never deletes a receipt; this exists so a check does not leave
 * its practice receipts in the client's books.
 */
export async function removeReceipts(db, day, partner = null) {
  const where = partner === null ? 'txn_date = $1' : 'txn_date = $1 AND partner_code = $2'
  const params = partner === null ? [day] : [day, partner]
  await db.query(`UPDATE pc49.gold_receipt SET corrects_receipt_id = NULL WHERE ${where}`, params)
  await db.query(`DELETE FROM pc49.gold_receipt WHERE ${where}`, params)
  await db.query(`DELETE FROM pc49.audit_log WHERE entity_type = 'gold_receipt'
                   AND entity_id NOT IN (SELECT id::text FROM pc49.gold_receipt)`)
}
