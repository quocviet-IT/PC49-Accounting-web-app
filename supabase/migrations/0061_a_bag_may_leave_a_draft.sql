-- 0017 granted the accountant SELECT, INSERT and UPDATE on a lot's bags and
-- never DELETE, while its policy allowed all four. Nothing noticed for forty
-- migrations because no screen removed a bag; the rebuilt lot page does —
-- "Huỷ" on a bag, and "Đóng túi từ phiếu đã chọn", which clears the bags it
-- made last time before making them again — and the first click on either
-- came back "permission denied for table refining_lot_line".
--
-- The grant comes with a lock. 0056 books a TRANSFER_OUT for every house bag
-- the moment a lot is sent; a bag removed after that would leave the ledger
-- holding gold no bag accounts for. So a bag may leave a draft, and only a
-- draft. The lot going away altogether (the demo sweep, ON DELETE CASCADE) is
-- not a bag leaving a lot: the lot is already gone when its bags follow, and
-- that passes.

GRANT DELETE ON pc49.refining_lot_line TO authenticated;

CREATE OR REPLACE FUNCTION pc49.refining_lot_line_only_from_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status::text INTO v_status FROM pc49.refining_lot WHERE id = OLD.lot_id;
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'lot % has already been sent; bag % cannot be removed', OLD.lot_id, OLD.seq
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS refining_lot_line_only_from_draft ON pc49.refining_lot_line;
CREATE TRIGGER refining_lot_line_only_from_draft
  BEFORE DELETE ON pc49.refining_lot_line
  FOR EACH ROW EXECUTE FUNCTION pc49.refining_lot_line_only_from_draft();

-- The ticked list, in the same shape as the list it was ticked from. The lot
-- page had been reading it straight off gold_txn, which knows neither the
-- band a purchase sorts into nor — through PostgREST's embed — anything the
-- available view computes; so every band came up red and could not be
-- compared with the bag totals under it.
CREATE OR REPLACE VIEW pc49.v_refining_lot_source_purchase AS
  SELECT s.lot_id,
         t.id,
         t.txn_date,
         t.partner_code,
         t.gold_type_code,
         t.scrap_detail,
         t.gold_pct,
         pc49.scrap_band(t.scrap_detail) AS grade_band,
         t.qty_gram,
         t.amount,
         t.doc_no,
         t.voided_at
    FROM pc49.refining_lot_source s
    JOIN pc49.gold_txn t ON t.id = s.txn_id;

GRANT SELECT ON pc49.v_refining_lot_source_purchase TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0061_a_bag_may_leave_a_draft')
ON CONFLICT (version) DO NOTHING;
