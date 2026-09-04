-- 0046_payment_is_not_limited_to_two.sql
-- A transaction may settle in as many ways as it took.
--
-- Reported by the accountant, from the entry screen:
--
--   "Thanh toan chi dang co dinh khach chi duoc thanh toan 2 lan cho 1 don"
--
-- The limit came out of the spreadsheet this system replaced. The Dashboard
-- had Amount-1st and Amount-2nd and nowhere to write a third, so the table
-- copied that shape and wrote it down as a rule: `CHECK (seq IN (1, 2))`. It
-- described the column layout of a sheet, not how anybody pays. A customer
-- settling one order part in cash, part by transfer and the rest by check had
-- the third line pushed into the remarks, where it is prose and no report can
-- add it up.
--
-- Nothing downstream ever depended on there being two. `post_gold_txn` reads
-- the payments with `FOR pay IN SELECT * FROM pc49.gold_txn_payment ... ORDER
-- BY seq LOOP` and writes a journal line for each one it finds, so the ledger
-- has always been able to carry however many there are.
--
-- What the sequence is actually for stays: it has to be a positive number, and
-- `UNIQUE (txn_id, seq)` still holds, so the order the payments were taken in
-- is recorded and no two share a place in it. No ceiling is put back. Any
-- number written here would be the same kind of guess as the two — the
-- application bounds what one request may insert, which is a different concern
-- and belongs where it is.

ALTER TABLE pc49.gold_txn_payment
  DROP CONSTRAINT IF EXISTS gold_txn_payment_seq;

ALTER TABLE pc49.gold_txn_payment
  ADD CONSTRAINT gold_txn_payment_seq CHECK (seq > 0);

INSERT INTO pc49.schema_migrations (version) VALUES ('0046_payment_is_not_limited_to_two')
ON CONFLICT (version) DO NOTHING;
