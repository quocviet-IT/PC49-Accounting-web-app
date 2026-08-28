-- 0033_param_description_vi.sql
-- The system parameters, explained in both languages.
--
-- Everything else the application shows is bilingual, and these were not, so the
-- reference screen read half in Vietnamese and half in English. They are worth
-- getting right rather than leaving: 31.1 and 31.105 are one keystroke apart and
-- mean different things, and the sentence next to the field is what stops
-- somebody typing the wrong one.

ALTER TABLE pc49.system_param
  ADD COLUMN IF NOT EXISTS description_vi text;

UPDATE pc49.system_param SET description_vi = v.text
  FROM (VALUES
    ('VALUATION_GRAM_PER_OZ',
     'Số chia để tính TRỊ GIÁ tồn kho: trọng lượng × spot mỗi oz ÷ số này. CỐ Ý không phải 31,105 — 31,105 là số quy đổi TRỌNG LƯỢNG, hai việc khác nhau.'),
    ('OZ_TO_LUONG_PRICE_DIVISOR',
     'Quy đơn giá niêm yết theo oz sang đơn giá theo lượng.'),
    ('BANK_PRICE_TOLERANCE_USD',
     'Biên cho phép lệch so với giá tham chiếu khi quy một giao dịch ngân hàng ra vàng. Vượt biên thì phải có người xác nhận mới lưu được.'),
    ('CONVERSION_WEIGHT_TOLERANCE_PCT',
     'Chênh lệch gram cho phép giữa vế vào và vế ra của một lần quy đổi nội bộ.'),
    ('REFINING_FEE_PCT_GOLD',
     'Tỷ lệ hao phân kim của vàng. Phía US xác nhận ngày 27/08/2026.'),
    ('REFINING_FEE_PCT_PT',
     'Tỷ lệ hao phân kim của bạch kim. Phía US xác nhận ngày 27/08/2026.')
  ) AS v(key, text)
 WHERE pc49.system_param.key = v.key;

-- A parameter added later without a Vietnamese sentence falls back to the
-- English one rather than showing a blank cell where an explanation should be.
ALTER TABLE pc49.system_param
  ALTER COLUMN description_vi SET DEFAULT NULL;

INSERT INTO pc49.schema_migrations (version) VALUES ('0033_param_description_vi')
ON CONFLICT (version) DO NOTHING;
