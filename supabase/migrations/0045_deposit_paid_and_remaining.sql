-- 0045_deposit_paid_and_remaining.sql
-- What the customer has paid on an order, and what is still owed.
--
-- Reported by the accountant: "Chua co thong tin so tien da tra, con lai". The
-- deposits report showed the deposit and whether the order had been collected,
-- which answers "did they come back" and not "what do they still owe" — and the
-- second is the question somebody asks when a customer is standing at the
-- counter.
--
-- Paid is a fact: the deposit, plus the balance handed over at pickup. Owed
-- needs the order's value, which is the agreed price on the deposit row. The
-- entry screen will not save a row without a unit price, so anything typed into
-- this system has one; rows loaded from the old spreadsheets may not.
--
-- Where there is no agreed price the order value is null and stays null. It
-- would be easy to value the order at today's gold price instead, and that
-- would be a guess printed in the same column as facts, on a report somebody
-- reads a figure off and tells a customer. A blank says "nobody recorded what
-- this was sold for", which is the truth and is also actionable.

CREATE OR REPLACE VIEW pc49.v_deposit_status AS
  SELECT d.id,
         d.txn_date,
         d.partner_code,
         d.gold_type_code,
         d.uom,
         d.qty,
         d.qty_gram,
         d.amount AS deposit_amount,
         s.txn_type::text AS settled_by,
         s.txn_date AS settled_date,
         CASE
           WHEN s.txn_type = 'PICKUP' THEN 'COLLECTED'
           WHEN s.txn_type = 'CANCEL' THEN 'CANCELLED'
           WHEN EXISTS (
             SELECT 1 FROM pc49.v_inventory_book b
              WHERE b.gold_type_code = d.gold_type_code
                AND b.owner_code = 'PC49' AND b.qty_gram > 0) THEN 'AWAITING_COLLECTION'
           ELSE 'ON_ORDER'
         END AS status,
         -- Added at the end on purpose: `create or replace view` can append a
         -- column and cannot move one, and inserting these in the middle reads
         -- to PostgreSQL as renaming `status`.
         --
         -- What the whole order comes to at the price agreed when the deposit
         -- was taken. Null when no price was recorded.
         CASE WHEN d.unit_price IS NULL THEN NULL
              ELSE round(abs(d.qty) * d.unit_price, 2) END AS order_amount,
         -- The deposit, and the balance if they have been back for it. A
         -- cancelled order adds nothing: the pickup never happened.
         d.amount + coalesce(
           CASE WHEN s.txn_type = 'PICKUP' THEN s.amount ELSE 0 END, 0) AS paid_amount,
         -- A settled order owes nothing, whatever the arithmetic says: the
         -- customer took the gold and the shop took the money.
         CASE
           WHEN s.txn_type = 'PICKUP' THEN 0
           WHEN s.txn_type = 'CANCEL' THEN 0
           WHEN d.unit_price IS NULL THEN NULL
           ELSE round(abs(d.qty) * d.unit_price - d.amount, 2)
         END AS remaining_amount
    FROM pc49.gold_txn d
    LEFT JOIN pc49.gold_txn s ON s.deposit_ref_id = d.id AND s.voided_at IS NULL
   WHERE d.txn_type = 'DEPOSIT' AND d.voided_at IS NULL;

GRANT SELECT ON pc49.v_deposit_status TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0045_deposit_paid_and_remaining')
ON CONFLICT (version) DO NOTHING;
