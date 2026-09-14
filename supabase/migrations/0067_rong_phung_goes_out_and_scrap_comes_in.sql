-- 0067_rong_phung_goes_out_and_scrap_comes_in.sql
-- Hai luồng mà sổ 2026 dùng thật và Link sheet chưa từng ghi.
--
-- Bảng quy tắc lấy nguyên văn từ Link sheet của GENERAL REPORT (0004): Rồng
-- Phụng chỉ vào — mua, hoặc chuyển từ Grain, hoặc Ra RP — và vàng vụn chỉ vào
-- bằng mua. Sổ giao dịch 2026 thì làm cả hai chiều ngược lại:
--
--   14/02  Transfer 10L VRP ra 375gr vàng Grain
--   02/04  Đổi 5L VRP lấy 6oz vàng CS và 0.89gr vàng Grain
--   21/04  Transfer đổi 12L VRP lấy 450gr Grain của Nini
--   22/03  Transfer 14.1gr vàng Grain ra 14.1gr vàng Scrap Gold
--   03/06  Đổi 624.51gr vàng Scrap Gold của MH ra 12L VRP
--
-- Mười bảy dòng như vậy trong sáu tháng, sáu ngày trong đó cân đúng gram. Khi
-- nạp, ngày cân đầu tiên làm commit của cả tháng dừng lại ở trigger
-- gold_txn_check_flow. Ngày 14-09-2026 bên giữ quy tắc chọn thêm hai luồng,
-- thay vì ghi các lần đổi thật thành một thứ chúng không phải.
--
-- Hai chỗ cố ý:
--
-- Ghi chú của Rồng Phụng chuyển ra là "Transfer", như CS và ML — KHÔNG phải
-- "Phan kim". 0052, 0058 và 0060 chọn loại vàng được đưa vào lô phân kim bằng
-- chính ghi chú đó; ghi nhầm là Rồng Phụng hiện ra trong ô chọn túi.
--
-- Vàng vụn chuyển vào để nguồn trống. Ngày 22/03 nó đến từ Grain, ngày 03/06 là
-- vàng vụn của MH đổi lấy Rồng Phụng — không phải từ một loại vàng khác của
-- PC49. Nguồn trống nghĩa là không phụ thuộc vàng đến từ đâu (xem 0004).
--
-- Những dòng trông như ký gửi ("Memo Nini", "Cô Loan") không được luồng này
-- cứu: chúng không cân trong ngày, nên bộ nạp vẫn trả lại để kế toán soát.

INSERT INTO pc49.gold_flow_rule (gold_type_code, txn_type, direction, source_gold_type_code, note) VALUES
  ('RP', 'TRANSFER_OUT', 'OUT', NULL, 'Transfer'),
  ('SG', 'TRANSFER_IN',  'IN',  NULL, 'Transfer vao Scrap Gold')
ON CONFLICT DO NOTHING;

INSERT INTO pc49.schema_migrations (version) VALUES ('0067_rong_phung_goes_out_and_scrap_comes_in')
ON CONFLICT (version) DO NOTHING;
