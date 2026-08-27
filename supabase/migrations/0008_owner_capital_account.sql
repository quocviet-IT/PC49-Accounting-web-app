-- 0008_owner_capital_account.sql
-- Adds owner's capital, the counterpart an opening balance needs.
--
-- The first row of Nhat Ky Chung for 2026-01-01 records the intercompany
-- opening balance as a debit to 1388 with no credit account at all:
--
--   9001 | HP no dau ky 2026 | Debit 1388 | Credit (blank) | 280,270
--
-- A ledger that enforces double entry cannot accept that. The conventional
-- counterpart is owner's equity, and the sheet 2. Nhat ky Thu-Chi already uses
-- account 4111 for exactly this ("Thu von gop thang Thang 1/2026", 1111 / 4111),
-- even though Data Acc never lists it.
--
-- Open question 7 for the accounting team: whether opening balances should face
-- 4111 or a dedicated opening-balance equity account.

INSERT INTO pc49.account
  (code, name_vi, name_en, account_type, gold_type_code, is_clearing, allows_negative, sort_order) VALUES
  ('4111', 'Vốn góp của chủ sở hữu', 'Owner capital', 'EQUITY', NULL, false, true, 700)
ON CONFLICT (code) DO UPDATE SET
  name_vi = excluded.name_vi, name_en = excluded.name_en,
  account_type = excluded.account_type, sort_order = excluded.sort_order;

INSERT INTO pc49.schema_migrations (version) VALUES ('0008_owner_capital_account')
ON CONFLICT (version) DO NOTHING;
