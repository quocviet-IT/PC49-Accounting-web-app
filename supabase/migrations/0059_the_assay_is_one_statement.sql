-- 0059_the_assay_is_one_statement.sql
-- The refinery's answer for a lot is written in one go: every bag's weight
-- and purity, the date, the spot that day — and the lot moves to ASSAYED with
-- them, or none of it lands.
--
-- Until now the assay side of a bag could only be filled in by editing lines
-- one at a time and then advancing the lot by hand. Half an assay is a lot
-- that says ASSAYED with two bags still showing what the counter guessed, and
-- a valuation view (0051) that quietly averages a guess with a measurement.
--
-- The bags are named by line id, and a line that is not in this lot is a
-- refusal rather than a silent no-op: writing the refinery's figures onto the
-- wrong lot is the kind of mistake that has to be loud.

CREATE OR REPLACE FUNCTION pc49.record_assay(
  p_lot_id     uuid,
  p_date       date,
  p_spot_gold  numeric,
  p_spot_pt    numeric,
  p_lines      jsonb)
RETURNS void LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  v_line jsonb;
  v_id   uuid;
  v_n    int;
BEGIN
  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    v_id := (v_line ->> 'lineId')::uuid;
    UPDATE pc49.refining_lot_line
       SET assay_weight_gram = nullif(v_line ->> 'assayWeightGram', '')::numeric,
           assay_pct         = nullif(v_line ->> 'assayPct', '')::numeric
     WHERE id = v_id AND lot_id = p_lot_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'line % is not in lot %', v_id, p_lot_id;
    END IF;
  END LOOP;

  -- The status trigger (0017) is what refuses a lot that was never sent, and
  -- what insists on an assay date. Nothing is duplicated here.
  UPDATE pc49.refining_lot
     SET status                 = 'ASSAYED',
         assay_date             = p_date,
         spot_gold_per_oz_assay = coalesce(p_spot_gold, spot_gold_per_oz_assay),
         spot_pt_per_oz_assay   = coalesce(p_spot_pt,   spot_pt_per_oz_assay)
   WHERE id = p_lot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lot % does not exist', p_lot_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION pc49.record_assay(uuid, date, numeric, numeric, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0059_the_assay_is_one_statement')
ON CONFLICT (version) DO NOTHING;
