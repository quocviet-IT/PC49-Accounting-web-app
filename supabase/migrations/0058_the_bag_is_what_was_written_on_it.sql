-- 0058_the_bag_is_what_was_written_on_it.sql
-- Scrap goes to the refinery in the bag the counter wrote on it, not the bag
-- its measured purity would put it in.
--
-- 0052 sorted purchases into the two bags by `gold_pct`, at 0.75. Three things
-- from the accountant's answers say that is the wrong column:
--
--   B5  "10k 14k 16-18k, 23-24k là ghi nhận cũ. Từ tháng 6 đổi sang hình
--        thức ghi nhận mới 10-18k/grs, 19-24k/grs" — the bag IS the label.
--   H4  "Tuổi vàng như 18k, 24k; còn phần trăm là hàm lượng vàng" — the
--        karat stamped on a piece and its measured content are two different
--        things, and the bags go by the first.
--   K1  "Phải lấy số từ file Scrap Gold sau khi tick" — what was ticked is
--        what goes, as written.
--
-- And the data agrees. Of 354 scrap purchases in the source, 304 carry no
-- percentage at all — 81% of the weight — so the old rule left most of every
-- lot with no bag and `linesFromPicked` then dropped them without a word. Of
-- the 50 that do carry one, 8 disagree with the 0.75 rule: a 95 g piece
-- stamped 10-18k that measured 75.5%, an 11 g piece stamped 16-18k that
-- measured 90%. The stamp decided the bag; the meter did not.
--
-- So the bag is read off `scrap_detail`, and the four labels used before June
-- fold into the two used since: anything up to 18k is the low bag, anything
-- from 19k up is the high one. Measured purity still matters — it is what the
-- send is priced on — but it is averaged over the purchases that have it,
-- weighted by their grams, and offered as the bag's starting figure. The
-- person packing the bag may overwrite it with the X-ray reading (B9a: the
-- send row is written "lúc cân gói hàng để gửi").

/**
 * The bag a scrap label belongs in.
 *
 * Takes every karat figure in the label and judges by the highest: '16-18k'
 * is 18, '23-24k' is 24, '10-18k/grs' is 18. Case and the '/grs' suffix are
 * ignored, so '18K' off a handwritten receipt reads the same as '18k/grs'. A
 * label with no karat in it has no bag, and says so with NULL rather than a
 * guess — nothing downstream may put unlabelled scrap in a bag on its own.
 */
CREATE OR REPLACE FUNCTION pc49.scrap_band(p_detail text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  WITH k AS (
    SELECT max(m[1]::int) AS karat
      FROM regexp_matches(lower(coalesce(p_detail, '')), '(\d{1,2})\s*k', 'g') AS m
  )
  SELECT CASE
           WHEN karat IS NULL THEN NULL
           WHEN karat <= 18 THEN '10-18k/grs'
           ELSE '19-24k/grs'
         END
    FROM k
$$;

-- The same two views 0052 defined, reading the bag off the label. Same
-- columns in the same order, so nothing that selects from them moves.
CREATE OR REPLACE VIEW pc49.v_refining_lot_source_summary AS
  SELECT s.lot_id,
         pc49.scrap_band(t.scrap_detail)                       AS grade_band,
         count(*)::int                                         AS purchase_count,
         sum(t.qty_gram)                                       AS gross_weight_gram,
         -- What the bag would be in 24k IF its measured average held across
         -- the whole of it. Extrapolated on purpose: the alternative — count
         -- unmeasured grams as zero — understates the estimate the send is
         -- priced on, and 81% of the grams are unmeasured.
         CASE WHEN sum(t.qty_gram) FILTER (WHERE t.gold_pct IS NOT NULL) > 0
              THEN sum(t.qty_gram)
                   * sum(t.qty_gram * t.gold_pct) FILTER (WHERE t.gold_pct IS NOT NULL)
                   / sum(t.qty_gram) FILTER (WHERE t.gold_pct IS NOT NULL)
              ELSE NULL END                                    AS pure_weight_gram,
         CASE WHEN sum(t.qty_gram) FILTER (WHERE t.gold_pct IS NOT NULL) > 0
              THEN sum(t.qty_gram * t.gold_pct) FILTER (WHERE t.gold_pct IS NOT NULL)
                   / sum(t.qty_gram) FILTER (WHERE t.gold_pct IS NOT NULL)
              ELSE NULL END                                    AS avg_gold_pct,
         sum(-t.amount)                                        AS total_cost,
         -- Appended, not slotted in: CREATE OR REPLACE VIEW may only add
         -- columns at the end. Scrap gold and platinum never share a bag.
         t.gold_type_code                                      AS gold_type_code
    FROM pc49.refining_lot_source s
    JOIN pc49.gold_txn t ON t.id = s.txn_id
   WHERE t.voided_at IS NULL
   GROUP BY s.lot_id, pc49.scrap_band(t.scrap_detail), t.gold_type_code;

CREATE OR REPLACE VIEW pc49.v_refining_available_purchase AS
  SELECT t.id,
         t.txn_date,
         t.partner_code,
         t.gold_type_code,
         t.scrap_detail,
         t.gold_pct,
         pc49.scrap_band(t.scrap_detail) AS grade_band,
         t.qty_gram,
         t.amount
    FROM pc49.gold_txn t
   WHERE t.txn_type IN ('PO', 'PO_VENDOR')
     AND t.voided_at IS NULL
     AND t.qty_gram > 0
     AND t.gold_type_code IN (SELECT gold_type_code FROM pc49.gold_flow_rule
                               WHERE txn_type = 'TRANSFER_OUT' AND note = 'Phan kim')
     AND NOT EXISTS (SELECT 1 FROM pc49.refining_lot_source s WHERE s.txn_id = t.id);

-- The purity-based rule goes, so nothing can quietly go back to it.
DROP FUNCTION IF EXISTS pc49.gold_grade_band(numeric);

GRANT SELECT ON pc49.v_refining_lot_source_summary,
                pc49.v_refining_available_purchase TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0058_the_bag_is_what_was_written_on_it')
ON CONFLICT (version) DO NOTHING;
