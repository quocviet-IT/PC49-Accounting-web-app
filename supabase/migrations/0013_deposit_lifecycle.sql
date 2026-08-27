-- 0013_deposit_lifecycle.sql
-- Deposit, then pickup or cancellation.
--
-- DELIBERATE DIFFERENCE FROM THE SPREADSHEET. Today the accountant "returns to
-- the deposit row to change its status and update it", overwriting the original
-- and losing the history of what was agreed when the customer paid. Here a
-- pickup is a new row pointing back at the deposit, and the deposit row is never
-- modified. Agree this with the accounting team before handover rather than
-- surprising them with it.

ALTER TABLE pc49.gold_txn
  DROP CONSTRAINT IF EXISTS gold_txn_pickup_needs_deposit,
  DROP CONSTRAINT IF EXISTS gold_txn_deposit_ref_only_on_settlement;

ALTER TABLE pc49.gold_txn
  ADD CONSTRAINT gold_txn_pickup_needs_deposit CHECK (
    txn_type NOT IN ('PICKUP', 'CANCEL') OR deposit_ref_id IS NOT NULL),
  ADD CONSTRAINT gold_txn_deposit_ref_only_on_settlement CHECK (
    deposit_ref_id IS NULL OR txn_type IN ('PICKUP', 'CANCEL'));

-- A deposit settles exactly once. Without this a customer could be recorded as
-- collecting the same order twice, which silently doubles revenue.
CREATE OR REPLACE FUNCTION pc49.gold_txn_check_deposit()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_ref_type pc49.txn_type;
  v_settled  int;
BEGIN
  IF NEW.deposit_ref_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT txn_type INTO v_ref_type FROM pc49.gold_txn WHERE id = NEW.deposit_ref_id;
  IF v_ref_type IS DISTINCT FROM 'DEPOSIT' THEN
    RAISE EXCEPTION 'transaction % is not a deposit and cannot be settled', NEW.deposit_ref_id;
  END IF;

  SELECT count(*) INTO v_settled
    FROM pc49.gold_txn
   WHERE deposit_ref_id = NEW.deposit_ref_id
     AND voided_at IS NULL
     AND id IS DISTINCT FROM NEW.id;

  IF v_settled > 0 THEN
    RAISE EXCEPTION 'deposit % is already settled', NEW.deposit_ref_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_txn_check_deposit ON pc49.gold_txn;
CREATE TRIGGER gold_txn_check_deposit
  BEFORE INSERT OR UPDATE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_check_deposit();

-- Deposits taken but not yet collected or cancelled. This is the gold that is
-- sold on paper but still physically in the shop, which is exactly the
-- difference between book inventory and physical inventory.
CREATE OR REPLACE VIEW pc49.v_deposit_open AS
  SELECT d.id,
         d.txn_date,
         d.partner_code,
         d.gold_type_code,
         d.uom,
         d.qty,
         d.qty_gram,
         d.amount AS deposit_amount
    FROM pc49.gold_txn d
   WHERE d.txn_type = 'DEPOSIT'
     AND d.voided_at IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM pc49.gold_txn s
        WHERE s.deposit_ref_id = d.id AND s.voided_at IS NULL);

GRANT SELECT ON pc49.v_deposit_open TO authenticated;

INSERT INTO pc49.schema_migrations (version) VALUES ('0013_deposit_lifecycle')
ON CONFLICT (version) DO NOTHING;
