-- 0029_data_import.sql
-- Loading 2026 out of the spreadsheets, one reviewable batch at a time.
--
-- The volume is small - a few thousand rows for the year - so nothing here is
-- built for speed. It is built for the thing that actually makes this hard: the
-- source contains #REF!, #VALUE!, "khong tim thay", customer codes that do not
-- follow one rule, and two reports that disagree about AR and AP. A loader that
-- swallows any of that produces books nobody can trust and nobody can audit.
--
-- So: every row is staged and judged before anything is written, a rejected row
-- keeps its reason, and a batch is only committed once somebody has looked.

-- Bank statements are deliberately absent. They already have a loader of their
-- own - import_bank_line, with Rocket's inverted sign and its review queue for
-- lines that map to no account - and a second path for the same file would drift
-- from the first the moment either changed.
DO $$ BEGIN
  CREATE TYPE pc49.import_source AS ENUM (
    'GOLD_PRICE', 'SPOT_PRICE', 'OPENING_INVENTORY', 'OPENING_CASH',
    'GOLD_TXN', 'JOURNAL', 'REFINING_LOT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.import_row_status AS ENUM ('VALID', 'REJECTED', 'COMMITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.import_batch (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source           pc49.import_source NOT NULL,
  file_name        text,
  sheet_name       text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  committed_at     timestamptz,
  committed_by     uuid,
  note             text
);

CREATE TABLE IF NOT EXISTS pc49.import_row (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id    uuid NOT NULL REFERENCES pc49.import_batch (id) ON DELETE CASCADE,
  -- The row number in the sheet, so a rejection can be pointed at.
  row_no      int NOT NULL,
  payload     jsonb NOT NULL,
  status      pc49.import_row_status NOT NULL,
  reason      text,
  committed_ref uuid,
  UNIQUE (batch_id, row_no),
  CONSTRAINT import_row_rejected_needs_reason CHECK (
    status <> 'REJECTED' OR btrim(coalesce(reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS import_row_batch_idx  ON pc49.import_row (batch_id);
CREATE INDEX IF NOT EXISTS import_row_status_idx ON pc49.import_row (status);

-- What a spreadsheet leaves behind when a formula breaks. Any of these in a cell
-- means the sheet did not know the answer either, so neither do we.
CREATE OR REPLACE FUNCTION pc49.spreadsheet_error_in(p_payload jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT v
    FROM jsonb_each_text(p_payload) AS e(k, v)
   WHERE v ~ '^#(REF|VALUE|N/A|DIV/0|NAME|NULL|NUM)'
      OR lower(v) LIKE '%khong tim thay%'
      OR lower(v) LIKE '%không tìm thấy%'
   LIMIT 1
$$;

-- Stages one row and judges it. Returns the status it was given, so the caller
-- can count as it goes.
CREATE OR REPLACE FUNCTION pc49.stage_import_row(
  p_batch_id uuid, p_row_no int, p_payload jsonb)
RETURNS pc49.import_row_status
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_source  pc49.import_source;
  v_reason  text;
  v_bad     text;
  v_status  pc49.import_row_status := 'VALID';
BEGIN
  SELECT source INTO v_source FROM pc49.import_batch WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import batch % does not exist', p_batch_id;
  END IF;

  v_bad := pc49.spreadsheet_error_in(p_payload);
  IF v_bad IS NOT NULL THEN
    v_reason := format('the sheet holds %s in this row; it did not know the answer either', v_bad);
  END IF;

  -- Referential checks, so a row naming something the system has never heard of
  -- is caught here rather than at insert time with a foreign key message the
  -- accountant cannot act on.
  IF v_reason IS NULL AND p_payload ? 'gold_type_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.gold_type
                      WHERE code = p_payload ->> 'gold_type_code') THEN
    v_reason := format('no gold type called %s', p_payload ->> 'gold_type_code');
  END IF;

  IF v_reason IS NULL AND p_payload ? 'account_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.account
                      WHERE code = p_payload ->> 'account_code') THEN
    v_reason := format('no account called %s', p_payload ->> 'account_code');
  END IF;

  IF v_reason IS NULL AND p_payload ? 'cash_account_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.cash_account
                      WHERE code = p_payload ->> 'cash_account_code') THEN
    v_reason := format('no cash account called %s', p_payload ->> 'cash_account_code');
  END IF;

  IF v_reason IS NULL AND v_source = 'GOLD_TXN'
     AND coalesce(p_payload ->> 'qty', '') = '' THEN
    v_reason := 'a gold transaction with no quantity';
  END IF;

  IF v_reason IS NOT NULL THEN
    v_status := 'REJECTED';
  END IF;

  INSERT INTO pc49.import_row (batch_id, row_no, payload, status, reason)
  VALUES (p_batch_id, p_row_no, p_payload, v_status, v_reason)
  ON CONFLICT (batch_id, row_no) DO UPDATE
    SET payload = excluded.payload, status = excluded.status, reason = excluded.reason;

  RETURN v_status;
END $$;

CREATE OR REPLACE VIEW pc49.v_import_batch_summary AS
  SELECT b.id AS batch_id,
         b.source,
         b.file_name,
         b.sheet_name,
         b.started_at,
         b.committed_at,
         count(r.*)                                                   AS row_count,
         count(*) FILTER (WHERE r.status = 'VALID')                   AS valid_count,
         count(*) FILTER (WHERE r.status = 'REJECTED')                AS rejected_count,
         count(*) FILTER (WHERE r.status = 'COMMITTED')               AS committed_count
    FROM pc49.import_batch b
    LEFT JOIN pc49.import_row r ON r.batch_id = b.id
   GROUP BY b.id;

-- What the spreadsheet says the answer is. Recorded before the detail is loaded,
-- so the system can be asked whether the detail adds up to it rather than being
-- trusted to have got there.
CREATE TABLE IF NOT EXISTS pc49.import_expected_figure (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of       date NOT NULL,
  metric      text NOT NULL,
  metric_key  text NOT NULL,
  expected    numeric(18,4) NOT NULL,
  source_note text,
  UNIQUE (as_of, metric, metric_key)
);

-- The post-load reconciliation. Every line the accountant needs to sign off,
-- with what the sheet said, what the system computes, and the gap.
CREATE OR REPLACE FUNCTION pc49.import_reconciliation(p_as_of date)
RETURNS TABLE (
  metric      text,
  metric_key  text,
  expected    numeric,
  actual      numeric,
  difference  numeric,
  agrees      boolean
)
LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  WITH computed AS (
    SELECT 'INVENTORY_GRAM' AS metric, gold_type_code AS metric_key,
           sum(qty_gram) AS actual
      FROM pc49.inventory_movement
     WHERE owner_code = 'PC49' AND bucket = 'ON_HAND' AND move_date <= p_as_of
     GROUP BY gold_type_code

    UNION ALL
    SELECT 'CASH_BALANCE', a.code, pc49.cash_balance(a.code, p_as_of)
      FROM pc49.cash_account a WHERE a.is_active

    UNION ALL
    SELECT 'LEDGER_DEBIT', 'ALL',
           coalesce(sum(CASE WHEN l.debit_account IS NOT NULL THEN l.amount_usd ELSE 0 END), 0)
      FROM pc49.journal_line l JOIN pc49.journal_entry e ON e.id = l.entry_id
     WHERE e.posted_at IS NOT NULL AND e.voided_at IS NULL AND e.entry_date <= p_as_of

    UNION ALL
    SELECT 'LEDGER_CREDIT', 'ALL',
           coalesce(sum(CASE WHEN l.credit_account IS NOT NULL THEN l.amount_usd ELSE 0 END), 0)
      FROM pc49.journal_line l JOIN pc49.journal_entry e ON e.id = l.entry_id
     WHERE e.posted_at IS NOT NULL AND e.voided_at IS NULL AND e.entry_date <= p_as_of
  )
  SELECT coalesce(x.metric, c.metric),
         coalesce(x.metric_key, c.metric_key),
         x.expected,
         coalesce(c.actual, 0),
         coalesce(c.actual, 0) - x.expected,
         x.expected IS NOT NULL AND abs(coalesce(c.actual, 0) - x.expected) < 0.005
    FROM computed c
    FULL OUTER JOIN (
      SELECT metric, metric_key, expected FROM pc49.import_expected_figure
       WHERE as_of = p_as_of
    ) x ON x.metric = c.metric AND x.metric_key = c.metric_key
   WHERE x.expected IS NOT NULL
   ORDER BY 1, 2
$$;

ALTER TABLE pc49.import_batch           ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.import_row             ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.import_expected_figure ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batch_read ON pc49.import_batch;
CREATE POLICY import_batch_read ON pc49.import_batch
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS import_batch_write ON pc49.import_batch;
CREATE POLICY import_batch_write ON pc49.import_batch
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS import_row_read ON pc49.import_row;
CREATE POLICY import_row_read ON pc49.import_row
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS import_row_write ON pc49.import_row;
CREATE POLICY import_row_write ON pc49.import_row
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS import_expected_read ON pc49.import_expected_figure;
CREATE POLICY import_expected_read ON pc49.import_expected_figure
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS import_expected_write ON pc49.import_expected_figure;
CREATE POLICY import_expected_write ON pc49.import_expected_figure
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON pc49.import_batch, pc49.import_row,
                                        pc49.import_expected_figure TO authenticated;
GRANT SELECT ON pc49.v_import_batch_summary TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0029_data_import')
ON CONFLICT (version) DO NOTHING;
