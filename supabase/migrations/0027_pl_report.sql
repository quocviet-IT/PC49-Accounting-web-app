-- 0027_pl_report.sql
-- The profit and loss report, with its line items declared as data.
--
-- The accounting team's own note on this sheet reads: "further recurring line
-- items such as payroll, tax and fees will be added later". Storing the layout
-- as rows means they can add one without a code change or a release, which is
-- what that sentence is really asking for.
--
-- A line either names accounts to sum, or names other lines to add up. Nothing
-- computes a total from a hardcoded list.

DO $$ BEGIN
  CREATE TYPE pc49.pl_line_kind AS ENUM ('ACCOUNTS', 'SUBTOTAL', 'DIFFERENCE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.pl_line_definition (
  code             text PRIMARY KEY,
  name_vi          text NOT NULL,
  name_en          text NOT NULL,
  kind             pc49.pl_line_kind NOT NULL,
  -- For ACCOUNTS: the chart-of-accounts codes to sum.
  accounts         text[],
  -- For SUBTOTAL: the line codes to add. For DIFFERENCE: exactly two, the
  -- second subtracted from the first.
  component_codes  text[],
  indent           int  NOT NULL DEFAULT 0,
  sort_order       int  NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  CONSTRAINT pl_line_accounts_or_components CHECK (
    (kind = 'ACCOUNTS'  AND accounts IS NOT NULL AND array_length(accounts, 1) > 0)
 OR (kind = 'SUBTOTAL'  AND component_codes IS NOT NULL)
 OR (kind = 'DIFFERENCE' AND array_length(component_codes, 1) = 2))
);

INSERT INTO pc49.pl_line_definition
  (code, name_vi, name_en, kind, accounts, component_codes, indent, sort_order) VALUES
  ('REV_SALES',   'Doanh thu : Bán hàng',            'Sales revenue',
     'ACCOUNTS',   ARRAY['511'],       NULL, 2, 110),
  ('REV_OPER',    'I./ DOANH THU BÁN HÀNG',          'I. Sales revenue',
     'SUBTOTAL',   NULL, ARRAY['REV_SALES'],  1, 100),
  ('REV_FIN',     'Doanh thu hoạt động tài chính',   'Financial income',
     'ACCOUNTS',   ARRAY['515'],       NULL, 2, 210),
  ('REV_OTHER_I', 'Thu nhập khác',                   'Other income',
     'ACCOUNTS',   ARRAY['711'],       NULL, 2, 220),
  ('REV_OTHER',   'II./ DOANH THU KHÁC',             'II. Other revenue',
     'SUBTOTAL',   NULL, ARRAY['REV_FIN', 'REV_OTHER_I'], 1, 200),
  ('REV_TOTAL',   'A./ TỔNG DOANH THU',              'A. Total revenue',
     'SUBTOTAL',   NULL, ARRAY['REV_OPER', 'REV_OTHER'],  0,  90),

  ('COGS_RP',     'Giá vốn NVL Vàng RP',             'COGS - Rong Phung',
     'ACCOUNTS',   ARRAY['632RP'],     NULL, 2, 310),
  ('COGS_ML',     'Giá vốn NVL vàng ML',             'COGS - Maple Leaf',
     'ACCOUNTS',   ARRAY['632ML'],     NULL, 2, 320),
  ('COGS_CS',     'Giá vốn NVL vàng CS',             'COGS - Credit Suisse',
     'ACCOUNTS',   ARRAY['632CS'],     NULL, 2, 330),
  ('COGS_9999',   'Giá vốn NVL vàng 9999',           'COGS - 9999',
     'ACCOUNTS',   ARRAY['632-9999'],  NULL, 2, 340),
  ('COGS_AE',     'Giá vốn NVL vàng AE',             'COGS - American Eagle',
     'ACCOUNTS',   ARRAY['632AE'],     NULL, 2, 350),
  ('COGS_OTH',    'Giá vốn NVL vàng Other',          'COGS - Other',
     'ACCOUNTS',   ARRAY['632Oth'],    NULL, 2, 360),
  ('COGS_SG',     'Giá vốn NVL vàng Scrap gold',     'COGS - Scrap Gold',
     'ACCOUNTS',   ARRAY['632SG'],     NULL, 2, 370),
  ('COGS_PT',     'Giá vốn NVL vàng PT',             'COGS - Platinum',
     'ACCOUNTS',   ARRAY['632PT'],     NULL, 2, 380),
  ('COGS_GRAIN',  'Giá vốn NVL vàng Grain',          'COGS - Grain',
     'ACCOUNTS',   ARRAY['632Grain'],  NULL, 2, 390),
  ('COGS_TOTAL',  'B./ CHI PHÍ GIÁ VỐN',             'B. Cost of goods sold',
     'SUBTOTAL',   NULL,
     ARRAY['COGS_RP','COGS_ML','COGS_CS','COGS_9999','COGS_AE','COGS_OTH',
           'COGS_SG','COGS_PT','COGS_GRAIN'], 0, 300),

  ('GROSS_PROFIT','C./ LỢI NHUẬN GỘP',               'C. Gross profit',
     'DIFFERENCE', NULL, ARRAY['REV_TOTAL', 'COGS_TOTAL'], 0, 400)
ON CONFLICT (code) DO UPDATE SET
  name_vi = excluded.name_vi, name_en = excluded.name_en, kind = excluded.kind,
  accounts = excluded.accounts, component_codes = excluded.component_codes,
  indent = excluded.indent, sort_order = excluded.sort_order;

-- Movement on a set of accounts for a period, in the natural direction for the
-- account type: revenue is credit-positive, cost is debit-positive, so both
-- read as positive figures on the report the way the source shows them.
CREATE OR REPLACE FUNCTION pc49.account_movement(p_accounts text[], p_period text)
RETURNS numeric LANGUAGE sql STABLE SET search_path = pc49, public AS $$
  SELECT coalesce(sum(
    CASE a.account_type
      WHEN 'REVENUE' THEN
        CASE WHEN l.credit_account = a.code THEN l.amount_usd ELSE -l.amount_usd END
      ELSE
        CASE WHEN l.debit_account = a.code THEN l.amount_usd ELSE -l.amount_usd END
    END), 0)
  FROM pc49.journal_line l
  JOIN pc49.journal_entry e ON e.id = l.entry_id
  JOIN pc49.account a ON a.code = any(p_accounts)
                     AND a.code IN (l.debit_account, l.credit_account)
  WHERE e.period = p_period AND e.posted_at IS NOT NULL AND e.voided_at IS NULL
$$;

CREATE OR REPLACE FUNCTION pc49.pl_report(p_period text)
RETURNS TABLE (
  code     text,
  name_vi  text,
  name_en  text,
  kind     pc49.pl_line_kind,
  indent   int,
  amount   numeric
)
LANGUAGE plpgsql STABLE SET search_path = pc49, public AS $$
DECLARE
  v       record;
  v_amt   numeric;
  v_by    jsonb := '{}'::jsonb;
  v_pass  int;
  v_left  int;
BEGIN
  -- Leaves first: every line that names accounts can be answered directly.
  FOR v IN SELECT d.* FROM pc49.pl_line_definition d
            WHERE d.is_active AND d.kind = 'ACCOUNTS' ORDER BY d.sort_order
  LOOP
    v_by := v_by || jsonb_build_object(
      v.code, pc49.account_movement(v.accounts, p_period));
  END LOOP;

  -- Then the lines built from other lines, resolved by repeated passes until
  -- nothing new is answered. A subtotal of subtotals is normal on this report -
  -- total revenue is the sum of two subtotals - and its sort order puts it ABOVE
  -- its own components, so one ordered pass would read them before they exist.
  FOR v_pass IN 1..10 LOOP
    v_left := 0;
    FOR v IN SELECT d.* FROM pc49.pl_line_definition d
              WHERE d.is_active AND d.kind <> 'ACCOUNTS' ORDER BY d.sort_order
    LOOP
      CONTINUE WHEN v_by ? v.code;
      -- Wait until every component this line depends on has an answer.
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM unnest(v.component_codes) AS c WHERE NOT (v_by ? c));

      IF v.kind = 'SUBTOTAL' THEN
        SELECT coalesce(sum((v_by ->> c)::numeric), 0) INTO v_amt
          FROM unnest(v.component_codes) AS c;
      ELSE
        v_amt := coalesce((v_by ->> v.component_codes[1])::numeric, 0)
               - coalesce((v_by ->> v.component_codes[2])::numeric, 0);
      END IF;
      v_by := v_by || jsonb_build_object(v.code, v_amt);
      v_left := v_left + 1;
    END LOOP;
    EXIT WHEN v_left = 0;
  END LOOP;

  RETURN QUERY
    SELECT d.code, d.name_vi, d.name_en, d.kind, d.indent,
           coalesce((v_by ->> d.code)::numeric, 0)
      FROM pc49.pl_line_definition d
     WHERE d.is_active
     ORDER BY d.sort_order;
END $$;

ALTER TABLE pc49.pl_line_definition ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pl_line_definition_read ON pc49.pl_line_definition;
CREATE POLICY pl_line_definition_read ON pc49.pl_line_definition
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS pl_line_definition_admin_write ON pc49.pl_line_definition;
CREATE POLICY pl_line_definition_admin_write ON pc49.pl_line_definition
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

GRANT SELECT, INSERT, UPDATE ON pc49.pl_line_definition TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0027_pl_report')
ON CONFLICT (version) DO NOTHING;
