-- 0031_reason_codes.sql
-- Saying why a row was turned back, in the language of whoever has to fix it.
--
-- The reason was English prose written by the function. The person who reads it
-- and goes back to the spreadsheet is the accountant, who works in Vietnamese,
-- so the judgement has to leave the database as a code and a value and become a
-- sentence at the screen. The English text stays alongside it: it is what an
-- audit trail and a support conversation are conducted in.

ALTER TABLE pc49.import_row
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS reason_value text;

CREATE OR REPLACE FUNCTION pc49.stage_import_row(
  p_batch_id uuid, p_row_no int, p_payload jsonb)
RETURNS pc49.import_row_status
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_source  pc49.import_source;
  v_code    text;
  v_value   text;
  v_reason  text;
  v_status  pc49.import_row_status := 'VALID';
BEGIN
  SELECT source INTO v_source FROM pc49.import_batch WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import batch % does not exist', p_batch_id;
  END IF;

  v_value := pc49.spreadsheet_error_in(p_payload);
  IF v_value IS NOT NULL THEN
    v_code := 'SHEET_ERROR';
  END IF;

  -- Referential checks, so a row naming something the system has never heard of
  -- is caught here rather than at insert time with a foreign key message the
  -- accountant cannot act on.
  IF v_code IS NULL AND p_payload ? 'gold_type_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.gold_type
                      WHERE code = p_payload ->> 'gold_type_code') THEN
    v_code := 'UNKNOWN_GOLD_TYPE'; v_value := p_payload ->> 'gold_type_code';
  END IF;

  IF v_code IS NULL AND p_payload ? 'account_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.account
                      WHERE code = p_payload ->> 'account_code') THEN
    v_code := 'UNKNOWN_ACCOUNT'; v_value := p_payload ->> 'account_code';
  END IF;

  IF v_code IS NULL AND p_payload ? 'cash_account_code'
     AND NOT EXISTS (SELECT 1 FROM pc49.cash_account
                      WHERE code = p_payload ->> 'cash_account_code') THEN
    v_code := 'UNKNOWN_CASH_ACCOUNT'; v_value := p_payload ->> 'cash_account_code';
  END IF;

  IF v_code IS NULL AND v_source = 'GOLD_TXN'
     AND coalesce(p_payload ->> 'qty', '') = '' THEN
    v_code := 'MISSING_QTY'; v_value := NULL;
  END IF;

  IF v_code IS NOT NULL THEN
    v_status := 'REJECTED';
    v_reason := CASE v_code
      WHEN 'SHEET_ERROR' THEN
        format('the sheet holds %s in this row; it did not know the answer either', v_value)
      WHEN 'UNKNOWN_GOLD_TYPE'    THEN format('no gold type called %s', v_value)
      WHEN 'UNKNOWN_ACCOUNT'      THEN format('no account called %s', v_value)
      WHEN 'UNKNOWN_CASH_ACCOUNT' THEN format('no cash account called %s', v_value)
      WHEN 'MISSING_QTY'          THEN 'a gold transaction with no quantity'
    END;
  END IF;

  INSERT INTO pc49.import_row
    (batch_id, row_no, payload, status, reason, reason_code, reason_value)
  VALUES (p_batch_id, p_row_no, p_payload, v_status, v_reason, v_code, v_value)
  ON CONFLICT (batch_id, row_no) DO UPDATE
    SET payload = excluded.payload, status = excluded.status, reason = excluded.reason,
        reason_code = excluded.reason_code, reason_value = excluded.reason_value;

  RETURN v_status;
END $$;

INSERT INTO pc49.schema_migrations (version) VALUES ('0031_reason_codes')
ON CONFLICT (version) DO NOTHING;
