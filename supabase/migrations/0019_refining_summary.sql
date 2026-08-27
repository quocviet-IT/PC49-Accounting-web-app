-- 0019_refining_summary.sql
-- What a lot is worth, who owns how much of it, and what the price did while it
-- was away.
--
-- Value is computed here rather than stored, so it can never go stale against
-- the weights and rates it derives from.

-- Per line: the spot that applies to its metal, and the estimated value the
-- source computes, reproduced exactly:
--
--   estimated value = 24K-equivalent weight x spot per gram x (1 - loss rate)
--
-- Verified against lot S26.02: 519.27464 x 161.2540193 x 0.995 = 83,316.4472.
CREATE OR REPLACE VIEW pc49.v_refining_lot_line_value AS
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
                           ELSE lot.spot_gold_per_oz_sent END
              / (SELECT value FROM pc49.system_param WHERE key = 'VALUATION_GRAM_PER_OZ'))
           * (1 - (CASE l.metal WHEN 'PLATINUM' THEN lot.fee_pct_pt
                                ELSE lot.fee_pct_gold END) / 100)
           AS estimated_value
    FROM pc49.refining_lot_line l
    JOIN pc49.refining_lot lot ON lot.id = l.lot_id;

-- Per lot per owner. PC49's inventory is this view filtered to PC49: a pooling
-- partner's metal shares the lot but never the books.
CREATE OR REPLACE VIEW pc49.v_refining_owner_share AS
  WITH totals AS (
    SELECT lot_id, sum(coalesce(assay_weight_gram, gross_weight_gram, 0)) AS lot_gram
      FROM pc49.refining_lot_line GROUP BY lot_id
  )
  SELECT l.lot_id,
         l.owner_code,
         sum(coalesce(l.assay_weight_gram, l.gross_weight_gram, 0)) AS assay_weight_gram,
         sum(coalesce(l.pure_weight_gram, 0))                       AS pure_weight_gram,
         CASE WHEN t.lot_gram = 0 THEN 0
              ELSE sum(coalesce(l.assay_weight_gram, l.gross_weight_gram, 0))
                   / t.lot_gram * 100 END                           AS share_pct,
         coalesce(sum(r.qty_gram), 0)                               AS received_gram
    FROM pc49.refining_lot_line l
    JOIN totals t ON t.lot_id = l.lot_id
    LEFT JOIN LATERAL (
      SELECT sum(qty_gram) AS qty_gram FROM pc49.refining_receipt rr
       WHERE rr.lot_id = l.lot_id AND rr.owner_code = l.owner_code
    ) r ON true
   GROUP BY l.lot_id, l.owner_code, t.lot_gram;

CREATE OR REPLACE VIEW pc49.v_refining_lot_summary AS
  SELECT lot.id AS lot_id,
         lot.lot_code,
         lot.status,
         lot.sent_date,
         lot.assay_date,
         lot.received_date,
         sum(coalesce(l.gross_weight_gram, 0))  AS total_gross_gram,
         sum(coalesce(l.pure_weight_gram, 0))   AS total_pure_gram,
         sum(coalesce(l.assay_weight_gram, 0))  AS total_assay_gram,
         sum(coalesce(l.assay_weight_gram, 0)) - sum(coalesce(l.gross_weight_gram, 0))
           AS weight_variance_gram,
         (SELECT coalesce(sum(qty_gram), 0) FROM pc49.refining_receipt r WHERE r.lot_id = lot.id)
           AS received_gram,
         -- What the price did while the lot was away. RECORDED, NOT POSTED: the
         -- US team has not yet said at which moment the definitive valuation is
         -- taken, so no journal entry is generated from this. Both spot prices
         -- and both weights are captured, so whatever they decide can be applied
         -- to lots already in the system.
         (lot.spot_gold_per_oz_assay - lot.spot_gold_per_oz_sent)
           / (SELECT value FROM pc49.system_param WHERE key = 'VALUATION_GRAM_PER_OZ')
           AS spot_variance_per_gram,
         (lot.spot_gold_per_oz_assay - lot.spot_gold_per_oz_sent)
           / (SELECT value FROM pc49.system_param WHERE key = 'VALUATION_GRAM_PER_OZ')
           * sum(coalesce(l.assay_weight_gram, 0))
           AS spot_variance_value
    FROM pc49.refining_lot lot
    LEFT JOIN pc49.refining_lot_line l ON l.lot_id = lot.id
   GROUP BY lot.id;

GRANT SELECT ON pc49.v_refining_lot_line_value,
                pc49.v_refining_owner_share,
                pc49.v_refining_lot_summary TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0019_refining_summary')
ON CONFLICT (version) DO NOTHING;
