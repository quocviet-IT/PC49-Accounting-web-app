-- 0012_gold_txn.sql
-- The accountant's transaction row, kept in the shape and sign convention of
-- the Dashboard sheet it replaces.
--
-- SIGN CONVENTION, carried over deliberately from the source:
--   purchase  qty > 0, amount < 0   (gold in, money out)
--   sale      qty < 0, amount > 0   (gold out, money in)
-- Changing it would break every parallel reconciliation against the spreadsheets
-- during the transition, which is the only way the accounting team can trust the
-- new system while both run side by side.

DO $$ BEGIN
  CREATE TYPE pc49.payment_method AS ENUM ('CASH', 'BANKWIRE', 'ZELLE', 'CHECK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE pc49.payment_direction AS ENUM ('AR', 'AP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pc49.gold_txn (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date           date NOT NULL,
  doc_no             text,
  txn_type           pc49.txn_type NOT NULL,
  partner_code       text,
  sales_person_code  text,
  gold_type_code     text NOT NULL REFERENCES pc49.gold_type (code),
  -- The Detail-scrap gold column: 14k/grs, 16-18k/grs, 19-24k/grs
  scrap_detail       text,
  gold_pct           numeric(6,4),
  uom                pc49.uom NOT NULL,
  qty                numeric(18,4) NOT NULL,
  qty_gram           numeric(18,4),
  unit_price         numeric(18,8),
  amount             numeric(18,2) NOT NULL,
  deposit_ref_id     uuid REFERENCES pc49.gold_txn (id),
  conversion_id      uuid,
  refining_lot_id    uuid,
  remarks            text,
  journal_entry_id   uuid REFERENCES pc49.journal_entry (id),
  voided_at          timestamptz,
  void_reason        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,

  CONSTRAINT gold_txn_purchase_sign CHECK (
    txn_type NOT IN ('PO', 'PO_VENDOR') OR (qty > 0 AND amount <= 0)),
  CONSTRAINT gold_txn_sale_sign CHECK (
    txn_type NOT IN ('SALE', 'PICKUP') OR (qty < 0 AND amount >= 0)),
  CONSTRAINT gold_txn_void_needs_reason CHECK (
    voided_at IS NULL OR btrim(coalesce(void_reason, '')) <> '')
);

CREATE INDEX IF NOT EXISTS gold_txn_date_idx       ON pc49.gold_txn (txn_date);
CREATE INDEX IF NOT EXISTS gold_txn_gold_idx       ON pc49.gold_txn (gold_type_code);
CREATE INDEX IF NOT EXISTS gold_txn_conversion_idx ON pc49.gold_txn (conversion_id);
CREATE INDEX IF NOT EXISTS gold_txn_deposit_idx    ON pc49.gold_txn (deposit_ref_id);

-- Grams are derived, not entered. The factor lives in another table, so this
-- cannot be a generated column.
CREATE OR REPLACE FUNCTION pc49.gold_txn_fill_grams()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  SELECT NEW.qty * f.gram_per_unit INTO NEW.qty_gram
    FROM pc49.uom_factor f WHERE f.uom = NEW.uom;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_txn_fill_grams ON pc49.gold_txn;
CREATE TRIGGER gold_txn_fill_grams
  BEFORE INSERT OR UPDATE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_fill_grams();

-- The Link sheet, enforced. A gold type may only move by a route the accounting
-- team has declared for it, and the declaration lives in gold_flow_rule rather
-- than in this function so they can change it without a code change.
CREATE OR REPLACE FUNCTION pc49.gold_txn_check_flow()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE v_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pc49.gold_flow_rule r
     WHERE r.gold_type_code = NEW.gold_type_code AND r.txn_type = NEW.txn_type
  ) THEN
    SELECT name_en INTO v_name FROM pc49.gold_type WHERE code = NEW.gold_type_code;
    RAISE EXCEPTION '% is not a valid movement for %: no such flow rule',
      NEW.txn_type, coalesce(v_name, NEW.gold_type_code);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_txn_check_flow ON pc49.gold_txn;
CREATE TRIGGER gold_txn_check_flow
  BEFORE INSERT OR UPDATE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_check_flow();

-- The Dashboard carries PO 1 / PO 2, Sales-1st / Sales-2nd and
-- Amount-1st / Amount-2nd, so a transaction settles in at most two ways.
CREATE TABLE IF NOT EXISTS pc49.gold_txn_payment (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id       uuid NOT NULL REFERENCES pc49.gold_txn (id) ON DELETE CASCADE,
  seq          int  NOT NULL,
  direction    pc49.payment_direction NOT NULL,
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  method       pc49.payment_method NOT NULL,
  paid_at      date,
  cash_txn_id  uuid,
  UNIQUE (txn_id, seq),
  CONSTRAINT gold_txn_payment_seq CHECK (seq IN (1, 2))
);

CREATE INDEX IF NOT EXISTS gold_txn_payment_txn_idx ON pc49.gold_txn_payment (txn_id);

ALTER TABLE pc49.gold_txn         ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc49.gold_txn_payment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gold_txn_read ON pc49.gold_txn;
CREATE POLICY gold_txn_read ON pc49.gold_txn
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS gold_txn_write ON pc49.gold_txn;
CREATE POLICY gold_txn_write ON pc49.gold_txn
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

DROP POLICY IF EXISTS gold_txn_payment_read ON pc49.gold_txn_payment;
CREATE POLICY gold_txn_payment_read ON pc49.gold_txn_payment
  FOR SELECT USING (pc49.effective_role() IS NOT NULL);

DROP POLICY IF EXISTS gold_txn_payment_write ON pc49.gold_txn_payment;
CREATE POLICY gold_txn_payment_write ON pc49.gold_txn_payment
  FOR ALL USING (pc49.effective_role() IN ('KT', 'ADMIN'))
  WITH CHECK (pc49.effective_role() IN ('KT', 'ADMIN'));

GRANT SELECT, INSERT, UPDATE ON pc49.gold_txn, pc49.gold_txn_payment TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0012_gold_txn')
ON CONFLICT (version) DO NOTHING;
