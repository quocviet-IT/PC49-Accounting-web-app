-- 0041_received_gram_counted_once.sql
-- Counts what the refinery sent back once, not once per line in the lot.
--
-- `v_refining_owner_share` joined the receipts through a LATERAL that already
-- summed them for the whole lot and owner, and then summed that again across
-- the lot's lines. A two-line lot reported double what came back; a five-line
-- lot, five times.
--
-- What that costs is the figure beside it. "Still owed" is the owner's share
-- less what has been received, so an inflated receipt makes a lot look settled
-- while the refinery is still holding metal — and settled is the state where
-- nobody looks again. A lot of three lines with a third returned reads as
-- fully back.
--
-- Fixed by asking for the receipts once per owner instead of once per line:
-- inside a grouped query, `l.lot_id` and `l.owner_code` are the group keys, so
-- a correlated subquery against them is evaluated per group, which is what the
-- figure means.

CREATE OR REPLACE VIEW pc49.v_refining_owner_share AS
  WITH totals AS (
    SELECT lot_id,
           sum(coalesce(assay_weight_gram, gross_weight_gram, 0)) AS lot_gram
      FROM pc49.refining_lot_line
     GROUP BY lot_id
  )
  SELECT l.lot_id,
         l.owner_code,
         sum(coalesce(l.assay_weight_gram, l.gross_weight_gram, 0)) AS assay_weight_gram,
         sum(coalesce(l.pure_weight_gram, 0))                       AS pure_weight_gram,
         CASE WHEN t.lot_gram = 0 THEN 0
              ELSE sum(coalesce(l.assay_weight_gram, l.gross_weight_gram, 0))
                     / t.lot_gram * 100
         END AS share_pct,
         coalesce((SELECT sum(rr.qty_gram)
                     FROM pc49.refining_receipt rr
                    WHERE rr.lot_id = l.lot_id
                      AND rr.owner_code = l.owner_code), 0) AS received_gram
    FROM pc49.refining_lot_line l
    JOIN totals t ON t.lot_id = l.lot_id
   GROUP BY l.lot_id, l.owner_code, t.lot_gram;

GRANT SELECT ON pc49.v_refining_owner_share TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0041_received_gram_counted_once')
ON CONFLICT (version) DO NOTHING;
