-- 0047_txn_purity_as_a_number.sql
-- Purity on a trading row, as a number rather than as prose.
--
-- Reported by the accountant, from the entry screen:
--
--   "Khong co truong du lieu nhap % vang"
--
-- The screen does have a "Tuoi vang" column. It writes `scrap_detail`, which
-- is free text, and what goes in it looks like "14k/grs" or "18k dây chuyền".
-- That is a useful note and a useless number: nothing can filter on it, total
-- it, or weigh a purchase against what came back from refining. The report was
-- not that the field was missing. It was that the field could not be counted.
--
-- So the note stays where it is, and a number sits beside it.
--
-- A fraction between zero and one, which is what purity already means
-- everywhere else in this system — `refining_lot_line.gold_pct` is bounded the
-- same way by 0039, and the refining screen asks for it as "Tuoi vang (0-1)".
-- One system, one reading. Fourteen-carat gold is 0.583 here exactly as it is
-- on a refining lot, and 58.3 is refused in both places rather than quietly
-- valuing a purchase at a hundred times what it is worth.
--
-- Nothing is derived from it yet: no cost of goods, no weight conversion, no
-- report. Making it arithmetic would move figures in books that are already
-- closed, and that is a separate decision taken with the accountant rather
-- than a side effect of giving them somewhere to write the number down.

ALTER TABLE pc49.gold_txn
  ADD COLUMN IF NOT EXISTS gold_pct numeric(6,4);

ALTER TABLE pc49.gold_txn
  DROP CONSTRAINT IF EXISTS gold_txn_purity_is_a_fraction;

ALTER TABLE pc49.gold_txn
  ADD CONSTRAINT gold_txn_purity_is_a_fraction
  CHECK (gold_pct IS NULL OR (gold_pct > 0 AND gold_pct <= 1));

COMMENT ON COLUMN pc49.gold_txn.gold_pct IS
  'Purity as a fraction between 0 and 1, as on a refining lot. 14k is 0.583. '
  'The prose beside it lives in scrap_detail.';

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0047_txn_purity_as_a_number')
ON CONFLICT (version) DO NOTHING;
