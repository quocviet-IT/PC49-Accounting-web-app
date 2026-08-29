-- 0039_purity_is_a_fraction.sql
-- Purity on a refining line is a fraction between zero and one.
--
-- `pure_weight_gram` is generated as `gross_weight_gram * gold_pct`, so the
-- fraction is the only reading that produces a weight. The screen says so —
-- "Tuoi vang (0-1)" — and nothing else did.
--
-- Fourteen-carat gold is 0.583. Typed as 58.3, the way it is said aloud and the
-- way it is written in every scrap book, a lot of 739 grams becomes 45 kilos of
-- pure gold: a hundred times over, valued against the spot price, on the
-- dashboard, in the refining report, and in the stock that comes back. Nothing
-- refuses it, because 58.3 is a perfectly good number.
--
-- Bounded here rather than in the form, because the form is not the only way in
-- and because this is a fact about the column rather than about one screen.
-- Zero is excluded too: a line with no gold in it is not a line.

ALTER TABLE pc49.refining_lot_line
  DROP CONSTRAINT IF EXISTS refining_lot_line_purity_is_a_fraction;

ALTER TABLE pc49.refining_lot_line
  ADD CONSTRAINT refining_lot_line_purity_is_a_fraction
  CHECK (gold_pct IS NULL OR (gold_pct > 0 AND gold_pct <= 1));

-- The assay comes back in the same terms, and is multiplied the same way.
ALTER TABLE pc49.refining_lot_line
  DROP CONSTRAINT IF EXISTS refining_lot_line_assay_is_a_fraction;

ALTER TABLE pc49.refining_lot_line
  ADD CONSTRAINT refining_lot_line_assay_is_a_fraction
  CHECK (assay_pct IS NULL OR (assay_pct > 0 AND assay_pct <= 1));

INSERT INTO pc49.schema_migrations (version) VALUES ('0039_purity_is_a_fraction')
ON CONFLICT (version) DO NOTHING;
