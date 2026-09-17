-- 0085_gold_is_named_as_on_the_dashboard.sql
-- Every gold type is called what the shop calls it.
--
-- "Đổi tên các loại vàng theo quy ước hiện tại" (17-09-2026). The Vietnamese
-- names were written for this system: Rồng Phụng, Vàng 9999, Vàng khác, Vàng
-- Grain, Bạch kim. The shop's own sheet — the Description column of the
-- Dashboard, which the loader reads (scripts/lib/sheet-map.mjs) — calls them
-- Rong Phung, 9999, Other, Grain and PT, and so do the people typing. 0081 did
-- this for Scrap Gold; this does the rest, and the accounts named after each.
--
-- Only names. The codes stay, so nothing written against a type changes.

UPDATE pc49.gold_type g SET name_vi = v.name
  FROM (VALUES ('RP', 'Rong Phung'), ('9999', '9999'), ('ML', 'Maple Leaf'),
               ('CS', 'Credit Suisse'), ('AE', 'American Eagle'), ('OTH', 'Other'),
               ('SG', 'Scrap Gold'), ('GRAIN', 'Grain'), ('PT', 'PT')) AS v(code, name)
 WHERE g.code = v.code;

-- Cost of sales, raw material, goods and goods sent out, each after its gold.
UPDATE pc49.account a
   SET name_vi = CASE left(a.code, 3)
                   WHEN '632' THEN 'Giá vốn '
                   WHEN '155' THEN 'NVL '
                   WHEN '156' THEN 'Hàng hoá '
                   WHEN '157' THEN 'Hàng gửi đi '
                 END || g.name_vi
  FROM pc49.gold_type g
 WHERE a.gold_type_code = g.code
   AND left(a.code, 3) IN ('632', '155', '156', '157');

INSERT INTO pc49.schema_migrations (version) VALUES ('0085_gold_is_named_as_on_the_dashboard')
ON CONFLICT (version) DO NOTHING;
