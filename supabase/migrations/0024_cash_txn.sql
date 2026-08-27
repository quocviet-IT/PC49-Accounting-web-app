-- 0024_cash_txn.sql
-- Every movement of money, typed from the cash book or imported from a bank
-- statement, in one table.
--
-- ROCKET'S SIGN CONVENTION IS INVERTED. A negative Amount is money IN; a
-- positive Amount is money OUT. This is not an inference: the source shows
-- "Interest (Received)" as -6.81 and "SERVICE CHARGES FOR THE MONTH OF DECEMBER"
-- as +32.5. The importer inverts, and a test would fail if anyone ever
-- "corrected" it.

DO $$ BEGIN
  CREATE TYPE pc49.cash_direction AS ENUM ('IN', 'OUT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.cash_source AS ENUM ('MANUAL', 'ROCKET_IMPORT', 'GOLD_TXN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.bank_import_batch (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_at      timestamptz NOT NULL DEFAULT now(),
  file_name        text,
  statement_period text,
  row_count        int NOT NULL DEFAULT 0,
  matched_count    int NOT NULL DEFAULT 0,
  unmatched_count  int NOT NULL DEFAULT 0,
  imported_by      uuid
);

CREATE TABLE IF NOT EXISTS pc49.cash_txn (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date           date NOT NULL,
  -- Rocket supplies both a date and an original date; keep the pair.
  original_date      date,
  cash_account_code  text NOT NULL REFERENCES pc49.cash_account (code),
  direction          pc49.cash_direction NOT NULL,
  -- Always positive. Direction carries the sign, so no query has to remember
  -- which way round Rocket had it.
  amount             numeric(18,2) NOT NULL CHECK (amount >= 0),
  description        text,
  rocket_category    text,
  -- The NHI column: the accountant's own note, "Mua khach", "Ban khach",
  -- "Phi ngan hang", "Luong", "Thue luong".
  kt_note            text,
  -- The NHO OC CHECK column: a line the accountant cannot classify alone.
  needs_oc_check     boolean NOT NULL DEFAULT false,
  counterparty       text,
  source             pc49.cash_source NOT NULL DEFAULT 'MANUAL',
  import_batch_id    uuid REFERENCES pc49.bank_import_batch (id),
  journal_entry_id   uuid REFERENCES pc49.journal_entry (id),
  gold_txn_id        uuid REFERENCES pc49.gold_txn (id),
  voided_at          timestamptz,
  void_reason        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  CONSTRAINT cash_txn_void_needs_reason CHECK (
    voided_at IS NULL OR btrim(coalesce(void_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS cash_txn_date_idx    ON pc49.cash_txn (txn_date);
CREATE INDEX IF NOT EXISTS cash_txn_account_idx ON pc49.cash_txn (cash_account_code);
CREATE INDEX IF NOT EXISTS cash_txn_batch_idx   ON pc49.cash_txn (import_batch_id);

-- Statement lines that matched no account. They are held here rather than
-- dropped, because a bank line nobody can place is exactly the thing that ends
-- up explaining a reconciliation difference three weeks later.
CREATE TABLE IF NOT EXISTS pc49.bank_import_row (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES pc49.bank_import_batch (id) ON DELETE CASCADE,
  raw_account_no    text,
  raw_account_name  text,
  txn_date          date,
  raw_amount        numeric(18,2),
  description       text,
  category          text,
  reason            text NOT NULL,
  resolved_at       timestamptz,
  resolved_txn_id   uuid REFERENCES pc49.cash_txn (id)
);

CREATE INDEX IF NOT EXISTS bank_import_row_batch_idx ON pc49.bank_import_row (batch_id);

-- Imports one statement line. Returns the cash_txn id, or null when the line
-- could not be placed and went to the review queue.
CREATE OR REPLACE FUNCTION pc49.import_bank_line(
  p_batch_id     uuid,
  p_account_no   text,
  p_account_name text,
  p_txn_date     date,
  p_raw_amount   numeric,
  p_description  text,
  p_category     text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_code   text;
  v_id     uuid;
BEGIN
  SELECT cash_account_code INTO v_code
    FROM pc49.rocket_account_map
   WHERE (raw_account_no = p_account_no)
      OR (raw_account_name IS NOT NULL AND raw_account_name = p_account_name)
   ORDER BY (raw_account_no = p_account_no) DESC
   LIMIT 1;

  UPDATE pc49.bank_import_batch SET row_count = row_count + 1 WHERE id = p_batch_id;

  IF v_code IS NULL THEN
    INSERT INTO pc49.bank_import_row
      (batch_id, raw_account_no, raw_account_name, txn_date, raw_amount, description,
       category, reason)
    VALUES (p_batch_id, p_account_no, p_account_name, p_txn_date, p_raw_amount, p_description,
            p_category,
            format('no account mapped for %s / %s',
                   coalesce(p_account_no, '(blank)'), coalesce(p_account_name, '(blank)')));
    UPDATE pc49.bank_import_batch SET unmatched_count = unmatched_count + 1
     WHERE id = p_batch_id;
    RETURN NULL;
  END IF;

  -- The inversion. Negative in Rocket means money arrived.
  INSERT INTO pc49.cash_txn
    (txn_date, original_date, cash_account_code, direction, amount, description,
     rocket_category, source, import_batch_id)
  VALUES (p_txn_date, p_txn_date, v_code,
          (CASE WHEN p_raw_amount < 0 THEN 'IN' ELSE 'OUT' END)::pc49.cash_direction,
          abs(p_raw_amount), p_description, p_category, 'ROCKET_IMPORT', p_batch_id)
  RETURNING id INTO v_id;

  UPDATE pc49.bank_import_batch SET matched_count = matched_count + 1 WHERE id = p_batch_id;
  RETURN v_id;
END $$;

ALTER TABLE pc49.cash_txn          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.bank_import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.bank_import_row   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_txn_read ON pc49.cash_txn;
CREATE POLICY cash_txn_read ON pc49.cash_txn
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS cash_txn_write ON pc49.cash_txn;
CREATE POLICY cash_txn_write ON pc49.cash_txn
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS bank_import_batch_read ON pc49.bank_import_batch;
CREATE POLICY bank_import_batch_read ON pc49.bank_import_batch
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS bank_import_batch_write ON pc49.bank_import_batch;
CREATE POLICY bank_import_batch_write ON pc49.bank_import_batch
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS bank_import_row_read ON pc49.bank_import_row;
CREATE POLICY bank_import_row_read ON pc49.bank_import_row
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS bank_import_row_write ON pc49.bank_import_row;
CREATE POLICY bank_import_row_write ON pc49.bank_import_row
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.cash_txn, pc49.bank_import_batch,
                                pc49.bank_import_row TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0024_cash_txn')
ON CONFLICT (version) DO NOTHING;
