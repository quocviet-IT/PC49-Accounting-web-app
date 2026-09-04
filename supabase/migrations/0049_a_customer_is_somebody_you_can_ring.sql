-- 0049_a_customer_is_somebody_you_can_ring.sql
-- A list of the people traded with, and a telephone number against each.
--
-- Reported by the accountant, from the entry screen:
--
--   "khong co truong nhap sdt khach"
--
-- There was nowhere to put one. `gold_txn.partner_code` is free text and
-- always has been — a customer is a string typed on a row, repeated on the
-- next row, and nothing anywhere holds a fact about them.
--
-- So the number does not go on the transaction. A telephone number belongs to
-- a person, not to a morning's purchase: written on the row it would be typed
-- again every visit, drift between spellings, and leave "what is Chi Hoa's
-- number" with as many answers as she has orders. It goes here, once.
--
-- No foreign key from `gold_txn.partner_code` to this table, deliberately, and
-- for the same reason 0048's trigger checks membership instead of declaring
-- one: the rows loaded out of the old workbooks carry codes that were never on
-- anybody's list, and a key that refused them would refuse the import of a
-- real day's trading over a spelling. The catalogue describes who has been
-- traded with; it does not get a veto over what can be recorded.
--
-- It fills itself. Every code already on a transaction is listed below, and
-- the entry screen adds a customer the first time one is typed, so nobody has
-- to sit down and enter a list before the number can be written against a name.

CREATE TABLE IF NOT EXISTS pc49.partner (
  code       text PRIMARY KEY,
  full_name  text,
  -- Text, not a number. Numbers lose the leading zero every Vietnamese mobile
  -- starts with, and a customer may leave two ways to reach them.
  phone      text,
  is_active  boolean NOT NULL DEFAULT true,
  note       text
);

-- ---- Who is already traded with ---------------------------------------------

INSERT INTO pc49.partner (code)
SELECT DISTINCT partner_code FROM pc49.gold_txn
 WHERE partner_code IS NOT NULL AND btrim(partner_code) <> ''
ON CONFLICT (code) DO NOTHING;

-- ---- Who may see and write it ------------------------------------------------

ALTER TABLE pc49.partner ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_read ON pc49.partner;
CREATE POLICY partner_read ON pc49.partner
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

-- Whoever may write a transaction may name the customer on it, which is the
-- only way this table is filled in practice.
DROP POLICY IF EXISTS partner_write ON pc49.partner;
CREATE POLICY partner_write ON pc49.partner
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.partner TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0049_a_customer_is_somebody_you_can_ring')
ON CONFLICT (version) DO NOTHING;
