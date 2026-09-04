-- 0048_more_than_one_person_on_an_order.sql
-- An order may be credited to more than one member of staff.
--
-- Reported by the accountant, from the entry screen:
--
--   "1 don hang he thong chi dang ghi nhan duoc 1 nhan vien"
--
-- `gold_txn.sales_person_code` is a single column, so structurally it holds
-- one person. Two working a sale together had to pick one, and whoever was
-- left off does not appear in any figure taken from these rows.
--
-- The share is a percent and the shares on an order must come to a hundred.
-- That is the whole reason to write them down: a name on an order says who was
-- there, a share says what it is worth, and a set of shares that does not add
-- up is a commission run that pays out more or less than the order earned. The
-- check is deferred to the end of the transaction, because the rows go in one
-- at a time and an order is only half-shared in the middle of writing it.
--
-- Percent rather than the fraction purity uses, because the sum tells the two
-- apart: 60 and 40 come to a hundred, 0.6 and 0.4 come to one and are refused.
-- The unit cannot be silently mistaken the way 58.3 for 0.583 can, which is
-- what 0039 had to go back and fix.
--
-- `gold_txn.sales_person_code` stays, and stays true. It is what the
-- spreadsheet import writes, what the rows loaded from the old workbooks
-- carry, and what a reader who wants one name expects to find. Two triggers
-- keep it and this table saying the same thing rather than drifting: a row
-- written with a name and no shares gets a hundred-percent share, and a change
-- to the shares writes the leading name back. Neither can loop — the first
-- fires only on INSERT of a transaction, the second only writes the column.

CREATE TABLE IF NOT EXISTS pc49.gold_txn_sales_person (
  txn_id             uuid NOT NULL REFERENCES pc49.gold_txn (id) ON DELETE CASCADE,
  sales_person_code  text NOT NULL REFERENCES pc49.sales_person (code),
  share_pct          numeric(6,2) NOT NULL DEFAULT 100
                       CHECK (share_pct > 0 AND share_pct <= 100),
  PRIMARY KEY (txn_id, sales_person_code)
);

CREATE INDEX IF NOT EXISTS gold_txn_sales_person_txn_idx
  ON pc49.gold_txn_sales_person (txn_id);
CREATE INDEX IF NOT EXISTS gold_txn_sales_person_who_idx
  ON pc49.gold_txn_sales_person (sales_person_code);

-- ---- The shares on one order come to a hundred ------------------------------

CREATE OR REPLACE FUNCTION pc49.gold_txn_shares_total_a_hundred()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_txn   uuid := COALESCE(NEW.txn_id, OLD.txn_id);
  v_total numeric;
  v_rows  int;
BEGIN
  SELECT count(*), COALESCE(sum(share_pct), 0)
    INTO v_rows, v_total
    FROM pc49.gold_txn_sales_person WHERE txn_id = v_txn;

  -- No rows at all is allowed: plenty of transactions have nobody on them, and
  -- removing the last share is how somebody corrects a name typed by mistake.
  IF v_rows = 0 THEN RETURN NULL; END IF;

  IF abs(v_total - 100) > 0.005 THEN
    RAISE EXCEPTION
      'the shares on an order must come to 100 percent, these come to %', v_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS gold_txn_shares_total ON pc49.gold_txn_sales_person;
CREATE CONSTRAINT TRIGGER gold_txn_shares_total
  AFTER INSERT OR UPDATE OR DELETE ON pc49.gold_txn_sales_person
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_shares_total_a_hundred();

-- ---- Keeping the column and the table saying the same thing ------------------

/**
 * A transaction written with a name and no shares gets one share of the whole.
 *
 * This is the road the spreadsheet import takes: it writes `sales_person_code`
 * and knows nothing about shares. Without this the imported rows would be the
 * only ones missing from a commission figure.
 */
CREATE OR REPLACE FUNCTION pc49.gold_txn_seed_sales_share()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF NEW.sales_person_code IS NULL THEN RETURN NULL; END IF;
  -- Only when the name is one this system knows. The old workbooks carry
  -- initials that were never in the staff list, and a foreign key that refused
  -- them would refuse the import of a real day's trading over a spelling.
  IF NOT EXISTS (SELECT 1 FROM pc49.sales_person WHERE code = NEW.sales_person_code) THEN
    RETURN NULL;
  END IF;
  INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct)
  VALUES (NEW.id, NEW.sales_person_code, 100)
  ON CONFLICT (txn_id, sales_person_code) DO NOTHING;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS gold_txn_seed_share ON pc49.gold_txn;
CREATE TRIGGER gold_txn_seed_share
  AFTER INSERT ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_seed_sales_share();

/**
 * The leading name goes back into the column.
 *
 * Largest share first, and the code alphabetically to break a tie, so the
 * answer does not depend on the order the rows happened to be written in.
 */
CREATE OR REPLACE FUNCTION pc49.gold_txn_lead_sales_person()
RETURNS trigger
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_txn  uuid := COALESCE(NEW.txn_id, OLD.txn_id);
  v_lead text;
BEGIN
  SELECT sales_person_code INTO v_lead
    FROM pc49.gold_txn_sales_person
   WHERE txn_id = v_txn
   ORDER BY share_pct DESC, sales_person_code
   LIMIT 1;

  UPDATE pc49.gold_txn SET sales_person_code = v_lead
   WHERE id = v_txn AND sales_person_code IS DISTINCT FROM v_lead;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS gold_txn_share_lead ON pc49.gold_txn_sales_person;
CREATE TRIGGER gold_txn_share_lead
  AFTER INSERT OR UPDATE OR DELETE ON pc49.gold_txn_sales_person
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_lead_sales_person();

-- ---- Who may see and write it ------------------------------------------------

ALTER TABLE pc49.gold_txn_sales_person ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gold_txn_sales_person_read ON pc49.gold_txn_sales_person;
CREATE POLICY gold_txn_sales_person_read ON pc49.gold_txn_sales_person
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS gold_txn_sales_person_write ON pc49.gold_txn_sales_person;
CREATE POLICY gold_txn_sales_person_write ON pc49.gold_txn_sales_person
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON pc49.gold_txn_sales_person TO authenticated;

-- ---- What is already recorded -----------------------------------------------
--
-- Every transaction that names somebody the staff list knows gets that person
-- at a hundred percent, which is what the single column always meant.
--
-- Last, after every ALTER above. The deferred check leaves pending trigger
-- events on this table until the transaction commits, and Postgres will not
-- alter a table that has any — so a backfill written higher up takes the
-- migration down with "cannot ALTER TABLE ... pending trigger events".

INSERT INTO pc49.gold_txn_sales_person (txn_id, sales_person_code, share_pct)
SELECT t.id, t.sales_person_code, 100
  FROM pc49.gold_txn t
  JOIN pc49.sales_person s ON s.code = t.sales_person_code
 WHERE t.sales_person_code IS NOT NULL
ON CONFLICT (txn_id, sales_person_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0048_more_than_one_person_on_an_order')
ON CONFLICT (version) DO NOTHING;
