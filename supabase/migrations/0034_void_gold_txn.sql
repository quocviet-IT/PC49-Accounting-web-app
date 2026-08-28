-- 0034_void_gold_txn.sql
-- Cancelling a gold transaction, and the ledger keeping up with it.
--
-- `gold_txn.voided_at` existed with a constraint demanding a reason, but nothing
-- ever wrote it and nothing would have kept the books in step if it had: setting
-- the column left the posting where it was, so a cancelled sale went on
-- reporting its revenue for ever. Nothing in the interface reached it yet, which
-- is the only reason it never cost anybody a month's profit.
--
-- The way back is the one this system already forces on everyone else: a
-- reversing entry dated in an open period, never a deleted one. The original
-- posting stays exactly where it is, the reversal sits beside it, and the
-- history reads as what happened rather than as what somebody wished had
-- happened.
--
-- Inventory is undone the same way — a negating movement, not a deletion — so a
-- stock report run for last week still answers what it answered last week.

-- The guard, first, because the function below has to satisfy it.
--
-- Without this the column stays writable by hand, and a hand-written void is
-- exactly the one that leaves the ledger behind. The function announces itself
-- through a transaction-local setting; `set_config(..., true)` means nothing
-- leaks into the next statement on this connection.
CREATE OR REPLACE FUNCTION pc49.gold_txn_guard_void()
RETURNS trigger LANGUAGE plpgsql SET search_path = pc49, public AS $$
BEGIN
  IF NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL
     AND current_setting('pc49.voiding', true) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION
      'do not set voided_at directly; call pc49.void_gold_txn(id, reason) so the '
      'ledger and the stock are reversed with it';
  END IF;

  -- Un-voiding would leave the reversal standing and the transaction live, which
  -- is the same figure counted twice.
  IF NEW.voided_at IS NULL AND OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION
      'a voided transaction cannot be brought back; record a new one instead';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS gold_txn_guard_void ON pc49.gold_txn;
CREATE TRIGGER gold_txn_guard_void
  BEFORE UPDATE ON pc49.gold_txn
  FOR EACH ROW EXECUTE FUNCTION pc49.gold_txn_guard_void();

/**
 * Voids one transaction and reverses everything it caused.
 *
 * Returns the id of the reversing entry, or null when the transaction had never
 * been posted and there was nothing to reverse.
 */
CREATE OR REPLACE FUNCTION pc49.void_gold_txn(
  p_txn_id uuid,
  p_reason text,
  -- Where the reversal is dated. Defaults to the transaction's own date, which
  -- is right when the mistake is caught the same day; a later date is needed
  -- once the original month has been closed.
  p_on_date date DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  t          pc49.gold_txn;
  v_on       date;
  v_reversal uuid;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'voiding a transaction needs a reason';
  END IF;

  SELECT * INTO t FROM pc49.gold_txn WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transaction % does not exist', p_txn_id;
  END IF;
  IF t.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'transaction % was already voided at %', p_txn_id, t.voided_at;
  END IF;

  -- A deposit somebody has already collected against cannot be cancelled on its
  -- own: the pickup would be left pointing at a transaction that never happened.
  IF EXISTS (
    SELECT 1 FROM pc49.gold_txn x
     WHERE x.deposit_ref_id = p_txn_id AND x.voided_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'transaction % has a pickup recorded against it; void the pickup first',
      p_txn_id;
  END IF;

  v_on := coalesce(p_on_date, t.txn_date);

  IF t.journal_entry_id IS NOT NULL THEN
    -- reverse_entry refuses a closed period itself, and its message already
    -- says to date the reversal somewhere open.
    v_reversal := pc49.reverse_entry(t.journal_entry_id, v_on);
  END IF;

  -- Inventory, negated rather than removed. `source_id` still points at the
  -- transaction, so the pair can be read together.
  INSERT INTO pc49.inventory_movement
    (move_date, gold_type_code, owner_code, bucket, qty_gram, qty_native, uom,
     unit_cost, source_type, source_id, note)
  SELECT v_on, m.gold_type_code, m.owner_code, m.bucket,
         -m.qty_gram, -m.qty_native, m.uom, m.unit_cost,
         'ADJUSTMENT', m.source_id,
         'Void: ' || p_reason
    FROM pc49.inventory_movement m
   WHERE m.source_type = 'GOLD_TXN' AND m.source_id = p_txn_id;

  PERFORM set_config('pc49.voiding', p_txn_id::text, true);
  UPDATE pc49.gold_txn
     SET voided_at = now(), void_reason = p_reason,
         updated_at = now(), updated_by = auth.uid()
   WHERE id = p_txn_id;
  PERFORM set_config('pc49.voiding', '', true);

  RETURN v_reversal;
END $$;

INSERT INTO pc49.schema_migrations (version) VALUES ('0034_void_gold_txn')
ON CONFLICT (version) DO NOTHING;
