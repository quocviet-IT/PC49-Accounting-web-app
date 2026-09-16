-- 0072_a_lot_books_its_own_metal.sql
-- Sending a lot and taking its metal back are the lot's bookkeeping, written by
-- the database, not transactions typed by whoever pressed the button.
--
-- The supervisor may open a lot, fill it with bags and close it: refining_lot,
-- refining_lot_line and refining_receipt all name GS_US in their policies, and
-- the screen offers them every stage. Pressing "Gửi đi" nonetheless failed with
-- "new row violates row-level security policy for table gold_txn", because 0056
-- writes the transfer legs as the caller, and gold_txn is KT and ADMIN only —
-- as are the stock movements and journal lines the legs then post. So a
-- supervisor could open a lot and never send it, and the screen offered them a
-- button the database would refuse. Found on 16-09 while rewriting
-- verify:refining, which drives the whole cycle as the supervisor; the SQL
-- tests missed it because they run as the database owner, which no policy
-- applies to.
--
-- The legs are not the supervisor's transactions. They are what sending means:
-- one transfer out per weighed house bag, and one transfer in for metal that
-- comes back. Who may cause them is already decided, by refining_lot's own
-- policy — KT, GS_US, ADMIN — so the two entry points write them as the owner.
--
--   refining_lot_send_legs   a trigger, so nothing can call it except an update
--                            of a lot that the lot's policy allowed
--   receive_refining         callable directly, so it checks the caller's role
--                            itself before using the rights it was given
--
-- record_assay is left alone: it touches only the lot and its bags, which the
-- supervisor may already write.
--
-- Both bodies are 0056's and 0050's, unchanged but for the security clause and,
-- in receive_refining, the check at the top.

CREATE OR REPLACE FUNCTION pc49.refining_lot_send_legs()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
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

CREATE OR REPLACE FUNCTION pc49.receive_refining(
  p_lot_id      uuid,
  p_date        date,
  p_owner_code  text,
  p_qty_gram    numeric DEFAULT NULL,
  p_unit_price  numeric DEFAULT NULL,
  p_settle_kind pc49.refining_settle_kind DEFAULT 'METAL',
  p_amount_usd  numeric DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pc49, public AS $$
DECLARE
  v_status  pc49.refining_status;
  v_code    text;
  v_id      uuid;
BEGIN
  -- This function now writes with the owner's rights, so it says for itself who
  -- may ask it to. A request that arrives through the API has to hold a role
  -- that may work a lot; the database owner — migrations, the SQL tests, the
  -- nightly scripts — is not answering to a policy in the first place and is
  -- not asked.
  --
  -- Read from the session and the token rather than from current_user, which
  -- inside a SECURITY DEFINER function is this function's owner and would let
  -- everybody through. PostgREST signs in as `authenticator` and switches to
  -- `authenticated` or `anon` per request, carrying the user in the token.
  IF auth.uid() IS NOT NULL
     OR session_user IN ('authenticator', 'authenticated', 'anon') THEN
    IF NOT coalesce(pc49.effective_role()
                    = ANY (ARRAY['KT', 'GS_US', 'ADMIN']::pc49.user_role[]), false) THEN
      RAISE EXCEPTION 'you are not allowed to record what a refining lot sent back';
    END IF;
  END IF;

  SELECT status, lot_code INTO v_status, v_code FROM pc49.refining_lot WHERE id = p_lot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lot % does not exist', p_lot_id;
  END IF;
  IF v_status NOT IN ('ASSAYED', 'RECEIVED') THEN
    RAISE EXCEPTION 'lot % has not been assayed yet; it is %', v_code, v_status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pc49.refining_lot_line
                  WHERE lot_id = p_lot_id AND owner_code = p_owner_code) THEN
    RAISE EXCEPTION 'lot % has no line belonging to %', v_code, p_owner_code;
  END IF;

  -- Said here as well as in the table's own check, so the accountant reads
  -- which figure is missing rather than a constraint name.
  IF p_settle_kind = 'METAL' AND coalesce(p_qty_gram, 0) <= 0 THEN
    RAISE EXCEPTION 'taking metal from lot % needs a weight', v_code;
  END IF;
  IF p_settle_kind = 'CASH' AND coalesce(p_amount_usd, 0) <= 0 THEN
    RAISE EXCEPTION 'taking money from lot % needs an amount', v_code;
  END IF;

  INSERT INTO pc49.refining_receipt
    (lot_id, receive_date, gold_type_code, owner_code, settle_kind, qty_gram,
     unit_price, amount_usd)
  VALUES (p_lot_id, p_date, 'GRAIN', p_owner_code, p_settle_kind,
          CASE WHEN p_settle_kind = 'METAL' THEN p_qty_gram END,
          CASE WHEN p_settle_kind = 'METAL' THEN p_unit_price END,
          CASE WHEN p_settle_kind = 'CASH'  THEN p_amount_usd END)
  RETURNING id INTO v_id;

  -- Settling in cash finishes that owner too, so it moves the lot on exactly
  -- as a delivery of metal does.
  IF v_status = 'ASSAYED' THEN
    UPDATE pc49.refining_lot
       SET status = 'RECEIVED', received_date = coalesce(received_date, p_date)
     WHERE id = p_lot_id;
  END IF;

  RETURN v_id;
END $$;

-- A function that writes with the owner's rights is not something to leave
-- lying about for anybody: only a signed-in caller may reach it at all, and
-- the check above decides which of them.
REVOKE EXECUTE ON FUNCTION pc49.receive_refining(
  uuid, date, text, numeric, numeric, pc49.refining_settle_kind, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pc49.receive_refining(
  uuid, date, text, numeric, numeric, pc49.refining_settle_kind, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0072_a_lot_books_its_own_metal')
ON CONFLICT (version) DO NOTHING;
