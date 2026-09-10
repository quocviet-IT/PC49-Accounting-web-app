-- 0056_a_sent_lot_leaves_the_vault.sql
-- A refining lot moves real metal, so it has to move the stock.
--
-- Reported by the accountant: "Quy trinh nhap lieu va phan kim hien tai chua
-- dung". Reading the two halves against each other says why. Every piece was
-- built and none of them were joined:
--
--   * sending a lot only set `refining_lot.status`; no transaction was written
--   * `receive_refining` only wrote a `refining_receipt` row
--   * `inventory_movement` is generated from `gold_txn` and nothing else (0021)
--   * `gold_txn.refining_lot_id` has existed since 0012 and NOTHING has ever
--     written to it — a dead column since the day it was declared
--
-- So the scrap stayed on the shelf while it sat at the refinery, and the Grain
-- that came back never arrived anywhere. A lot could be opened, sent, assayed,
-- received and closed without a single gram moving.
--
-- The source journal does not work that way. In `1. Scrap Gold` a shipment is
-- an ordinary row on the same sheet as the purchases — customer "Send to
-- assay", type Transfer, weight negative. Twenty-nine of them across
-- January to June 2026. That row is what takes the weight out of stock, and
-- it is exactly what was missing here.
--
-- Nothing new is invented to carry it. `TRANSFER_OUT` already moves ON_HAND to
-- AT_REFINERY (0021), `post_gold_txn` already books a transfer as weight moving
-- between inventory accounts with no money (0015), and the flow rules already
-- declare SG and PT as the two types whose TRANSFER_OUT is "Phan kim" (0004).
-- The legs simply have to be written.
--
-- WHOSE METAL. A pooled lot carries a partner's scrap, and 0017 is explicit
-- that PC49's inventory must never absorb it. So a leg is written for the
-- house's lines only. The partner's metal travels in the same bag and stays
-- off these books, which is the same stance the owner-share view already takes.

/**
 * The owner code that means "us" on a refining lot.
 *
 * Hardcoded here rather than in a parameter because `system_param.value` is
 * numeric, and hardcoded in ONE place rather than the several it is written in
 * today (the picker defaults to it, the screen greys every other owner out).
 * A second legal entity refining through PC49 is a schema change, not a
 * configuration change.
 */
CREATE OR REPLACE FUNCTION pc49.house_owner_code()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'PC49'::text $$;

-- A transfer had to belong to a conversion. A refining shipment is not a
-- conversion — one is scrap turning into Grain over a week at a third party,
-- the other is a same-day swap between two types the shop already holds, and
-- the conversion balance check compares raw grams in against grams out. Sending
-- 1,000 g of 70% scrap and receiving 700 g of Grain is a thirty percent
-- difference and a perfectly normal refining lot; it would be flagged on every
-- shipment. So the lot is the other thing a transfer may be explained by.
ALTER TABLE pc49.gold_txn
  DROP CONSTRAINT IF EXISTS gold_txn_transfer_needs_conversion;

ALTER TABLE pc49.gold_txn
  ADD CONSTRAINT gold_txn_transfer_needs_conversion CHECK (
    txn_type NOT IN ('TRANSFER_IN', 'TRANSFER_OUT', 'RA_RP')
    OR conversion_id IS NOT NULL
    OR refining_lot_id IS NOT NULL);

-- Now that the column is used, it has to point at something.
ALTER TABLE pc49.gold_txn
  DROP CONSTRAINT IF EXISTS gold_txn_refining_lot_id_fkey;

ALTER TABLE pc49.gold_txn
  ADD CONSTRAINT gold_txn_refining_lot_id_fkey
    FOREIGN KEY (refining_lot_id) REFERENCES pc49.refining_lot (id);

CREATE INDEX IF NOT EXISTS gold_txn_refining_lot_idx
  ON pc49.gold_txn (refining_lot_id) WHERE refining_lot_id IS NOT NULL;

/**
 * Writes and posts one movement of metal for a refining lot.
 *
 * `p_qty_native` carries the sign the rest of the system reads: negative for
 * gold leaving, positive for gold arriving. The weight is converted out of
 * grams into the type's own unit, because that is what the transaction records
 * and `gold_txn_fill_grams` converts back — Grain and scrap are both grams, so
 * this is a no-op today and would silently be wrong the first time a lot came
 * back as anything else.
 */
CREATE OR REPLACE FUNCTION pc49.refining_leg(
  p_lot_id     uuid,
  p_date       date,
  p_type       pc49.txn_type,
  p_gold_type  text,
  p_gram       numeric,
  p_memo       text)
RETURNS uuid LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_uom     pc49.uom;
  v_factor  numeric;
  v_txn_id  uuid;
BEGIN
  SELECT native_uom INTO v_uom FROM pc49.gold_type WHERE code = p_gold_type;
  IF v_uom IS NULL THEN
    RAISE EXCEPTION 'refining lot % refers to gold type %, which does not exist',
      p_lot_id, p_gold_type;
  END IF;
  SELECT gram_per_unit INTO v_factor FROM pc49.uom_factor WHERE uom = v_uom;

  INSERT INTO pc49.gold_txn
    (txn_date, txn_type, gold_type_code, uom, qty, amount, refining_lot_id, remarks)
  VALUES
    (p_date, p_type, p_gold_type, v_uom, p_gram / v_factor, 0, p_lot_id, p_memo)
  RETURNING id INTO v_txn_id;

  -- Posted here, not left for somebody to post later: stock only moves once a
  -- transaction is on the ledger (0021), so an unposted leg would be a lot that
  -- still had not left the vault.
  PERFORM pc49.post_gold_txn(v_txn_id);
  RETURN v_txn_id;
END $$;

/**
 * The moment the gold physically goes: one transfer out per weighed line.
 *
 * A line nobody put a gross weight on is skipped rather than sent at a guess.
 * That is not a hypothetical — in lot S26.02 five of the seven lines carry no
 * gross weight at all, because what was sent was bullion described in words
 * ("18CS", "6ML") and only weighed by the refinery. Inventing a weight for
 * those would move stock that was never counted.
 */
CREATE OR REPLACE FUNCTION pc49.refining_lot_send_legs()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  ln record;
BEGIN
  IF NEW.status <> 'SENT' OR OLD.status = 'SENT' THEN
    RETURN NEW;
  END IF;

  FOR ln IN
    SELECT l.gross_weight_gram,
           coalesce(l.gold_type_code,
                    CASE l.metal WHEN 'PLATINUM' THEN 'PT' ELSE 'SG' END) AS gold_type_code
      FROM pc49.refining_lot_line l
     WHERE l.lot_id = NEW.id
       AND l.owner_code = pc49.house_owner_code()
       AND l.gross_weight_gram IS NOT NULL
       AND l.gross_weight_gram > 0
     ORDER BY l.seq
  LOOP
    PERFORM pc49.refining_leg(
      NEW.id, NEW.sent_date, 'TRANSFER_OUT', ln.gold_type_code,
      -ln.gross_weight_gram,
      'Send to assay ' || NEW.lot_code);
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS refining_lot_send_legs ON pc49.refining_lot;
CREATE TRIGGER refining_lot_send_legs
  AFTER UPDATE ON pc49.refining_lot
  FOR EACH ROW EXECUTE FUNCTION pc49.refining_lot_send_legs();

/**
 * The moment metal comes back: a transfer in for what the house receives.
 *
 * A settlement taken in cash brings back no metal and books none — 0050 made
 * the row's shape follow its kind, and this reads that shape rather than
 * guessing from a weight that is null for a reason. A partner's settlement is
 * their metal, not PC49's, and stays off the books here too.
 *
 * BEFORE INSERT so the receipt can be stamped with the transaction it created
 * in the same pass. Doing it after would mean updating the row that fired the
 * trigger, and re-entering the trigger to do it.
 */
CREATE OR REPLACE FUNCTION pc49.refining_receipt_leg()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE v_code text;
BEGIN
  IF NEW.settle_kind <> 'METAL'
     OR NEW.owner_code <> pc49.house_owner_code()
     OR NEW.gold_txn_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT lot_code INTO v_code FROM pc49.refining_lot WHERE id = NEW.lot_id;

  NEW.gold_txn_id := pc49.refining_leg(
    NEW.lot_id, NEW.receive_date, 'TRANSFER_IN', NEW.gold_type_code,
    NEW.qty_gram,
    'Refined return ' || coalesce(v_code, ''));

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS refining_receipt_leg ON pc49.refining_receipt;
CREATE TRIGGER refining_receipt_leg
  BEFORE INSERT ON pc49.refining_receipt
  FOR EACH ROW EXECUTE FUNCTION pc49.refining_receipt_leg();

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0056_a_sent_lot_leaves_the_vault')
ON CONFLICT (version) DO NOTHING;
