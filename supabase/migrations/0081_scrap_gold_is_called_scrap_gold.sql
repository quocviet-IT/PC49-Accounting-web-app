-- 0081_scrap_gold_is_called_scrap_gold.sql
-- Tiếng Việt cũng gọi vàng vụn là "Scrap Gold", như cửa hàng vẫn gọi.
--
-- 0002 đặt tên tiếng Việt là "Vàng vụn". Sheet của khách là "1.Scrap Gold", ghi
-- chú trong sổ viết "vàng Scrap Gold", và người nhập tìm theo tên đó. Ngày
-- 17-09-2026 bên dùng yêu cầu đổi. Ba tài khoản mang tên loại vàng này đổi
-- theo, để sổ sách và báo cáo không gọi cùng một thứ bằng hai tên.
--
-- Chỉ đổi tên. Mã SG và mã tài khoản giữ nguyên, nên không dòng nào trong sổ
-- phải đổi theo.

UPDATE pc49.gold_type SET name_vi = 'Scrap Gold' WHERE code = 'SG';

UPDATE pc49.account SET name_vi = CASE code
    WHEN '632SG' THEN 'Giá vốn Scrap Gold'
    WHEN '155SG' THEN 'NVL Scrap Gold'
    WHEN '157SG' THEN 'Hàng gửi đi Scrap Gold'
  END
 WHERE code IN ('632SG', '155SG', '157SG');

INSERT INTO pc49.schema_migrations (version) VALUES ('0081_scrap_gold_is_called_scrap_gold')
ON CONFLICT (version) DO NOTHING;
