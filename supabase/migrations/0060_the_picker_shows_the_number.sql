-- The purchase picker on the lot page lists what was bought and not yet sent.
-- Every purchase has had a document number since 0057, but the view the
-- picker reads predates that and never carried it — so every row read "—"
-- where the accountant expects the number she ticked in the sheet.
--
-- Added last, which is the one way a view may grow in place.

CREATE OR REPLACE VIEW pc49.v_refining_available_purchase AS
  SELECT t.id,
         t.txn_date,
         t.partner_code,
         t.gold_type_code,
         t.scrap_detail,
         t.gold_pct,
         pc49.scrap_band(t.scrap_detail) AS grade_band,
         t.qty_gram,
         t.amount,
         t.doc_no
    FROM pc49.gold_txn t
   WHERE t.txn_type IN ('PO', 'PO_VENDOR')
     AND t.voided_at IS NULL
     AND t.qty_gram > 0
     AND t.gold_type_code IN (SELECT gold_type_code FROM pc49.gold_flow_rule
                               WHERE txn_type = 'TRANSFER_OUT' AND note = 'Phan kim')
     AND NOT EXISTS (SELECT 1 FROM pc49.refining_lot_source s WHERE s.txn_id = t.id);

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0060_the_picker_shows_the_number')
ON CONFLICT (version) DO NOTHING;
