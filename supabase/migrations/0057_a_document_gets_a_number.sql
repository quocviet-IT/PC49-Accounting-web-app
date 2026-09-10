-- 0057_a_document_gets_a_number.sql
-- Every transaction and every refining lot is numbered by the system.
--
-- From the accountant's questionnaire (B2): the number should look like
-- PC49-2606-01. The source sheet has a "Document N." column and it is blank on
-- every one of the ~180 rows a month, because numbering by hand is the first
-- thing that gets dropped on a busy day. So nothing is asked for: a row with no
-- number is given the next one for its month, and a row that arrives with a
-- number — an import from the old workbooks, say — keeps it.
--
-- Three digits, not the two in the example. June 2026 ran to 180 rows.
--
-- A correction is the same document, corrected: it carries the number of the
-- row it replaces rather than taking a new one, so a search for PC49-2606-041
-- finds the transaction and its history, not two unrelated rows.
--
-- Lots the same way (C4: "phần mềm tự đánh số được"). The source used four
-- different shapes in four months — S26.01, 26.03-01, 26.04.01, TF0101 — and
-- the first of them is the one BC 201 is organised around, so that is the one
-- minted: S<YY>.<NN>, counting within the year.
--
-- The counters are rows that are locked and advanced in one statement, which
-- is what makes two saves in the same second get two numbers rather than one.

CREATE TABLE IF NOT EXISTS pc49.doc_counter (
  period   text PRIMARY KEY,          -- 'YYMM'
  last_no  int  NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pc49.lot_counter (
  year     int PRIMARY KEY,           -- four-digit
  last_no  int NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION pc49.next_doc_no(p_date date)
RETURNS text LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_period text := to_char(p_date, 'YYMM');
  v_no     int;
BEGIN
  INSERT INTO pc49.doc_counter (period, last_no) VALUES (v_period, 1)
  ON CONFLICT (period) DO UPDATE SET last_no = pc49.doc_counter.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN 'PC49-' || v_period || '-' || lpad(v_no::text, 3, '0');
END $$;

CREATE OR REPLACE FUNCTION pc49.next_lot_code(p_date date)
RETURNS text LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_year int := extract(year FROM p_date)::int;
  v_no   int;
BEGIN
  INSERT INTO pc49.lot_counter (year, last_no) VALUES (v_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_no = pc49.lot_counter.last_no + 1
  RETURNING last_no INTO v_no;
  RETURN 'S' || to_char(p_date, 'YY') || '.' || lpad(v_no::text, 2, '0');
END $$;

CREATE OR REPLACE FUNCTION pc49.gold_txn_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF NEW.doc_no IS NOT NULL AND btrim(NEW.doc_no) <> '' THEN
    RETURN NEW;
  END IF;
  IF NEW.corrects_txn_id IS NOT NULL THEN
    SELECT doc_no INTO NEW.doc_no FROM pc49.gold_txn WHERE id = NEW.corrects_txn_id;
    IF NEW.doc_no IS NOT NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.doc_no := pc49.next_doc_no(NEW.txn_date);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_txn_number ON pc49.gold_txn;
CREATE TRIGGER gold_txn_number
  BEFORE INSERT ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_number();

CREATE OR REPLACE FUNCTION pc49.refining_lot_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF NEW.lot_code IS NULL OR btrim(NEW.lot_code) = '' THEN
    NEW.lot_code := pc49.next_lot_code(coalesce(NEW.sent_date, current_date));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS refining_lot_code ON pc49.refining_lot;
CREATE TRIGGER refining_lot_code
  BEFORE INSERT ON pc49.refining_lot
  FOR EACH ROW EXECUTE FUNCTION pc49.refining_lot_code();

-- The counters are the system's; nobody edits them from a screen.
ALTER TABLE pc49.doc_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.lot_counter ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON pc49.doc_counter, pc49.lot_counter TO authenticated;

DROP POLICY IF EXISTS doc_counter_rw ON pc49.doc_counter;
CREATE POLICY doc_counter_rw ON pc49.doc_counter
  FOR ALL USING (pc49.effective_role() IS NOT NULL) WITH CHECK (pc49.effective_role() IS NOT NULL);
DROP POLICY IF EXISTS lot_counter_rw ON pc49.lot_counter;
CREATE POLICY lot_counter_rw ON pc49.lot_counter
  FOR ALL USING (pc49.effective_role() IS NOT NULL) WITH CHECK (pc49.effective_role() IS NOT NULL);

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0057_a_document_gets_a_number')
ON CONFLICT (version) DO NOTHING;
