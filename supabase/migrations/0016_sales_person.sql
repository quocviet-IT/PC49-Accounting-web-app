-- 0016_sales_person.sql
-- The eight people who appear in the Sales Person column of the Dashboard.
--
-- Partners are NOT seeded here. The DMKH code rule does not reduce to a single
-- algorithm - CDEVANS and HPAREZ follow one pattern, CTHUY and PTPTHAO another -
-- and seeding 152 customers under a guessed rule would give the accountant codes
-- they do not recognise. That needs ten minutes with the accounting team.

CREATE TABLE IF NOT EXISTS pc49.sales_person (
  code       text PRIMARY KEY,
  full_name  text,
  is_active  boolean NOT NULL DEFAULT true,
  note       text
);

INSERT INTO pc49.sales_person (code, full_name) VALUES
  ('L.Thanh',  'Lien Thanh'),
  ('P.Minh',   'Phung Minh'),
  ('S.Mai',    'Sao Mai'),
  ('B.Khanh',  'Bao Khanh'),
  ('N.Ý',      'Nhu Y'),
  ('T.Quỳnh',  'Truc Quynh'),
  ('H.Kim',    'Hoang Kim'),
  ('T.Vân',    'Tuong Van')
ON CONFLICT (code) DO UPDATE SET full_name = excluded.full_name;

ALTER TABLE pc49.sales_person ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_person_read ON pc49.sales_person;
CREATE POLICY sales_person_read ON pc49.sales_person
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS sales_person_admin_write ON pc49.sales_person;
CREATE POLICY sales_person_admin_write ON pc49.sales_person
  FOR ALL USING (pc49.effective_role() = 'ADMIN') WITH CHECK (pc49.effective_role() = 'ADMIN');

GRANT SELECT, INSERT, UPDATE, DELETE ON pc49.sales_person TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0016_sales_person')
ON CONFLICT (version) DO NOTHING;
