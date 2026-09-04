-- 0052_a_lot_is_made_of_purchases.sql
-- A refining lot is assembled by picking the purchases that go into it.
--
-- This is the half of the process the system never had. In file
-- `7. [HPUS-KT215] US_Scrap Gold Report 2026`, sheet `1.Scrap Gold` is the
-- running journal of scrap bought over the counter, and column P is a
-- checkbox. The accountant's own process notes say what it is for:
--
--   "Mỗi đợt phân kim, US tick vào ô checkbox công thức lấy dữ liệu để tính
--    tổng trọng lượng, số tiền, trung bình % vàng, ước lượng trọng lượng sau
--    quy đổi phân loại theo 2 loại vàng"
--
-- So nobody retypes weights. They tick the purchases that are physically going
-- in the bag, and the totals fall out: gross weight, 24k-equivalent, and the
-- money those purchases cost — grouped into the two grade bands the scrap is
-- sent in. This system asked for the lines to be typed again from scratch,
-- which is both slower than the spreadsheet and a second place for the numbers
-- to disagree with the purchases they came from.
--
-- The link is the whole table. A purchase belongs to at most one lot — gold
-- cannot be sent twice — and that is a unique constraint rather than a rule in
-- a screen, because the screen is not the only way in.

CREATE TABLE IF NOT EXISTS pc49.refining_lot_source (
  lot_id  uuid NOT NULL REFERENCES pc49.refining_lot (id) ON DELETE CASCADE,
  txn_id  uuid NOT NULL REFERENCES pc49.gold_txn (id) ON DELETE CASCADE,
  PRIMARY KEY (lot_id, txn_id),
  -- Sent once. Picking a purchase already in another lot is a mistake worth
  -- refusing, not reconciling later.
  UNIQUE (txn_id)
);

CREATE INDEX IF NOT EXISTS refining_lot_source_lot_idx ON pc49.refining_lot_source (lot_id);

/**
 * The grade band a purchase is sent in.
 *
 * The scrap goes to the refinery in two bags, and the sheet's batch tab totals
 * them separately as `10-18k/grs` and `19-24k/grs`. Eighteen carat is 0.75, so
 * that is where the line falls. A purchase nobody recorded a purity for cannot
 * be put in either bag, and says so rather than being quietly counted as low
 * grade — which would understate the 24k-equivalent the lot is estimated on.
 */
CREATE OR REPLACE FUNCTION pc49.gold_grade_band(p_gold_pct numeric)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN p_gold_pct IS NULL THEN NULL
           WHEN p_gold_pct <= 0.75 THEN '10-18k/grs'
           ELSE '19-24k/grs'
         END
$$;

/**
 * What the picked purchases come to, per lot and per grade band.
 *
 * The same four figures the spreadsheet's batch tab computes, from the same
 * rows: how much was bought, what it is in 24k, what it cost, and the average
 * purity by weight rather than a plain average of percentages — five grams at
 * 99% and five hundred at 65% is not eighty-two percent of anything.
 */
CREATE OR REPLACE VIEW pc49.v_refining_lot_source_summary AS
  SELECT s.lot_id,
         pc49.gold_grade_band(t.gold_pct)                      AS grade_band,
         count(*)::int                                         AS purchase_count,
         sum(t.qty_gram)                                       AS gross_weight_gram,
         sum(t.qty_gram * coalesce(t.gold_pct, 0))             AS pure_weight_gram,
         CASE WHEN sum(t.qty_gram) = 0 THEN NULL
              ELSE sum(t.qty_gram * coalesce(t.gold_pct, 0)) / sum(t.qty_gram)
         END                                                   AS avg_gold_pct,
         -- Purchases carry a negative amount by the sign convention: gold in,
         -- money out. What the bag cost is that money, read as a positive.
         sum(-t.amount)                                        AS total_cost
    FROM pc49.refining_lot_source s
    JOIN pc49.gold_txn t ON t.id = s.txn_id
   WHERE t.voided_at IS NULL
   GROUP BY s.lot_id, pc49.gold_grade_band(t.gold_pct);

/**
 * The purchases that could still go into a lot.
 *
 * Scrap bought, not yet picked for any lot, and not cancelled. This is the
 * list the checkbox column sits beside in the spreadsheet.
 */
CREATE OR REPLACE VIEW pc49.v_refining_available_purchase AS
  SELECT t.id,
         t.txn_date,
         t.partner_code,
         t.gold_type_code,
         t.scrap_detail,
         t.gold_pct,
         pc49.gold_grade_band(t.gold_pct) AS grade_band,
         t.qty_gram,
         t.amount
    FROM pc49.gold_txn t
   WHERE t.txn_type IN ('PO', 'PO_VENDOR')
     AND t.voided_at IS NULL
     AND t.qty_gram > 0
     -- Which types go to the refinery is already recorded, in the flow rules
     -- seeded from the Link sheet: SG and PT are the two whose TRANSFER_OUT is
     -- noted "Phan kim". Reading it here rather than adding a second list
     -- keeps one answer to the question.
     AND t.gold_type_code IN (SELECT gold_type_code FROM pc49.gold_flow_rule
                               WHERE txn_type = 'TRANSFER_OUT' AND note = 'Phan kim')
     AND NOT EXISTS (SELECT 1 FROM pc49.refining_lot_source s WHERE s.txn_id = t.id);

-- ---- Who may see and write it ------------------------------------------------

ALTER TABLE pc49.refining_lot_source ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS refining_lot_source_read ON pc49.refining_lot_source;
CREATE POLICY refining_lot_source_read ON pc49.refining_lot_source
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS refining_lot_source_write ON pc49.refining_lot_source;
CREATE POLICY refining_lot_source_write ON pc49.refining_lot_source
  FOR ALL USING (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'GS_US', 'ADMIN'));

GRANT SELECT, INSERT, DELETE ON pc49.refining_lot_source TO authenticated;

-- The views too, or the screen reads an empty list and the picker looks like a
-- feature that does not work rather than one nobody may see.
GRANT SELECT ON pc49.v_refining_lot_source_summary,
                pc49.v_refining_available_purchase TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0052_a_lot_is_made_of_purchases')
ON CONFLICT (version) DO NOTHING;
