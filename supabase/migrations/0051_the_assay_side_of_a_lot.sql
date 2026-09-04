-- 0051_the_assay_side_of_a_lot.sql
-- What the lot turned out to be worth, not only what it was estimated at.
--
-- Sheet `3.3 MH SCRAP GOLD` values a lot twice, and the system only did the
-- first half. Reading the columns of lot S26.02 across:
--
--   send      F spot ngày gửi · G trọng lượng · H % gold
--             I trọng lượng qui đổi 24k = G × H
--             K tính giá ước lượng      = I × spot/gram × (1 − rate)
--
--   assay     M spot after assay · N trọng lượng nhận khi assay · O % gold after assay
--             P trọng lượng qui đổi 24k = N × O
--             T giá tiền chốt bán       = P × spot/gram × (1 − rate)
--
--   variance  W tuổi vàng   = H − O
--             X trọng lượng = P − I
--             Y giá tiền    = T − K
--
-- I and K were already here. P, T, W, X and Y were not, and they are the half
-- the accountant settles on: T is the figure the lot is actually priced at,
-- and W, X, Y are what the assay changed. Verified against the sheet, the
-- 706.4 g MH line at 73.51%:
--
--   K = 519.27464 × 161.2540193 × 0.995 = 83,316.4472   (matches to the cent)
--   T = 506.371236 × 171.4790997 × 0.995 = 86,397.92323
--   Y = T − K = 3,081.476031
--
-- Nothing is stored. Every one of them is arithmetic over columns already on
-- the row, so a view is the honest place for them: a stored copy is a second
-- answer waiting to disagree with the first.
--
-- The lot gains a platinum spot at assay. It had one for gold and not for
-- platinum, which left a PT line after assay with no rate to value against.

ALTER TABLE pc49.refining_lot
  ADD COLUMN IF NOT EXISTS spot_pt_per_oz_assay numeric(18,6);

CREATE OR REPLACE VIEW pc49.v_refining_lot_line_value AS
  WITH per_gram AS (
    SELECT (SELECT value FROM pc49.system_param WHERE key = 'VALUATION_GRAM_PER_OZ') AS divisor
  )
  SELECT l.id,
         l.lot_id,
         l.seq,
         l.owner_code,
         l.metal,
         l.source_desc,
         l.gross_weight_gram,
         l.gold_pct,
         l.pure_weight_gram,
         l.assay_pct,
         l.assay_weight_gram,
         CASE l.metal
           WHEN 'PLATINUM' THEN lot.spot_pt_per_oz_sent
           ELSE lot.spot_gold_per_oz_sent
         END AS spot_per_oz_sent,
         CASE l.metal
           WHEN 'PLATINUM' THEN lot.fee_pct_pt
           ELSE lot.fee_pct_gold
         END AS loss_pct,

         -- Value conversion divides by 31.1, never by the 31.105 used for weight.
         l.pure_weight_gram
           * (CASE l.metal WHEN 'PLATINUM' THEN lot.spot_pt_per_oz_sent
                           ELSE lot.spot_gold_per_oz_sent END / g.divisor)
           * (1 - (CASE l.metal WHEN 'PLATINUM' THEN lot.fee_pct_pt
                                ELSE lot.fee_pct_gold END) / 100)
           AS estimated_value,

         -- Everything below is appended rather than slotted in beside the
         -- send-side column it mirrors. `CREATE OR REPLACE VIEW` may only add
         -- columns at the end, and dropping the view to get a tidier order
         -- would take whatever comes to depend on it down with it.
         CASE l.metal
           WHEN 'PLATINUM' THEN lot.spot_pt_per_oz_assay
           ELSE lot.spot_gold_per_oz_assay
         END AS spot_per_oz_assay,

         -- P: what the refinery's own weight and purity come to in 24k.
         l.assay_weight_gram * l.assay_pct AS assay_pure_weight_gram,

         -- T: the figure the lot is settled at.
         l.assay_weight_gram * l.assay_pct
           * (CASE l.metal WHEN 'PLATINUM' THEN lot.spot_pt_per_oz_assay
                           ELSE lot.spot_gold_per_oz_assay END / g.divisor)
           * (1 - (CASE l.metal WHEN 'PLATINUM' THEN lot.fee_pct_pt
                                ELSE lot.fee_pct_gold END) / 100)
           AS assay_value,

         -- W: the assay came back purer or poorer than the counter judged it.
         l.gold_pct - l.assay_pct AS purity_variance,

         -- X: and so the 24k weight moved. Where nothing was weighed at the
         -- counter this is simply the assay weight, which is what the sheet
         -- shows for the lines sent without a gross weight.
         l.assay_weight_gram * l.assay_pct - coalesce(l.pure_weight_gram, 0)
           AS weight_variance,

         -- Y: and the money with it.
         l.assay_weight_gram * l.assay_pct
           * (CASE l.metal WHEN 'PLATINUM' THEN lot.spot_pt_per_oz_assay
                           ELSE lot.spot_gold_per_oz_assay END / g.divisor)
           * (1 - (CASE l.metal WHEN 'PLATINUM' THEN lot.fee_pct_pt
                                ELSE lot.fee_pct_gold END) / 100)
         - coalesce(
             l.pure_weight_gram
               * (CASE l.metal WHEN 'PLATINUM' THEN lot.spot_pt_per_oz_sent
                               ELSE lot.spot_gold_per_oz_sent END / g.divisor)
               * (1 - (CASE l.metal WHEN 'PLATINUM' THEN lot.fee_pct_pt
                                    ELSE lot.fee_pct_gold END) / 100), 0)
           AS value_variance

    FROM pc49.refining_lot_line l
    JOIN pc49.refining_lot lot ON lot.id = l.lot_id
   CROSS JOIN per_gram g;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0051_the_assay_side_of_a_lot')
ON CONFLICT (version) DO NOTHING;
