# Thêm tiền cọc, tồn kho theo đơn vị gốc, nhập/xuất tách riêng — thiết kế

Ngày 18-09. Nguồn: góp ý người dùng đợt 4:

1. *"Đơn đặt cọc chưa có tính năng khách chỉ trả thêm tiền chứ chưa pickup"*
2. *"Bảng tồn kho, thể hiện đơn vị tính L, Oz nhưng số tồn đang thể hiện là gr"*
3. *"Vàng vào / ra kho đang thể hiện chung, chưa tách ra nhập bao nhiêu, xuất bao nhiêu. Và đang tính chung là gr, cần có thêm đvt gốc ...L/...gr"*

## Vấn đề

- **Thanh toán tiếp** (0083) chỉ nhận phiếu mua/bán (`settlement_side`). Phiếu cọc không có chỗ ghi lần khách đưa thêm tiền trước khi lấy hàng.
- **Bảng tồn kho:** đọc `inventory_as_of` và `stock_movement_report`, cả hai trả **gram**. Màn hình in gram cạnh cột ĐVT (L, Oz).
- **Vàng vào / ra kho trên sổ:**
  - `gold_receipt_ledger_totals.grams_by_gold` là **gram ròng** (nhập trừ xuất) theo loại vàng;
  - đơn cọc bị trừ hai lần: phiếu cọc (−1 L) và phiếu lấy hàng (−1 L).

## Đã chốt

- Tồn kho và nhập/xuất hiện **đơn vị gốc, kèm gram**.
- Với đơn cọc, vàng tính **xuất lúc khách lấy hàng** (vàng thật rời tiệm): phiếu cọc và phiếu huỷ đơn cọc không tính nhập/xuất.

## Thiết kế

### 1. Thêm tiền cọc (0089)

- `deposit_paid(phiếu cọc)` = tiền cọc lúc lập phiếu + các lần đưa thêm chưa huỷ. Dùng thay `txn_paid` ở:
  - `gold_receipt_deposit` ("đã cọc" của dòng cọc và dòng lấy);
  - `v_deposit_status` (tiền cọc, đã trả, còn lại);
  - `gold_receipt_owed` của phiếu lấy (trừ tiền đã cọc).
- `save_receipt_settlement` nhận **phiếu cọc chưa lấy**:
  - ghi Nợ tiền / Có 131 như tiền cọc ban đầu;
  - trần là giá trị đơn − đã cọc; chưa biết giá trị đơn thì không có trần;
  - phiếu cọc đã lấy hoặc đã huỷ đơn thì từ chối `PICKUP_TAKEN: D`.
- Phiếu cọc **không có "còn nợ"** (`gold_receipt_owed` = 0), nên không hiện chữ đỏ "Còn nợ" và không vào bộ lọc Còn nợ. Phần còn lại vẫn hiện như cũ: "Còn lại X", trả khi lấy hàng.
- Màn hình:
  - dòng cọc chưa lấy có nút **Thêm tiền cọc** (hộp Thanh toán tiếp với chữ riêng: giá trị đơn, đã cọc, còn lại, các lần cọc thêm, ghi lần cọc thêm);
  - huỷ một lần cọc thêm ngay trong hộp đó.

### 2. Tồn kho theo đơn vị gốc

- Mỗi loại vàng chỉ có một đơn vị gốc (0038), nên đổi gram về đơn vị gốc là chính xác: gram ÷ 37,5 (L) hoặc ÷ 31,105 (Oz).
- Mỗi ô số của bảng tồn và của tab nhập–xuất–tồn hiện **số theo đơn vị gốc**, gram in nhỏ bên dưới. Loại tính bằng gram chỉ ghi gram.
- Dòng tổng giữ gram, vì các loại vàng khác đơn vị.

### 3. Nhập / xuất tách riêng trên sổ (0089)

- `gold_receipt_ledger_totals` thêm cột cuối `moves_by_gold`:
  - dạng `{mã: {in, inGrams, out, outGrams}}`;
  - `in`/`out` là số lượng theo đơn vị gốc; `inGrams`/`outGrams` là gram;
  - tính trên các dòng khớp bộ lọc, **trừ DEPOSIT và CANCEL**.
- `grams_by_gold` giữ nguyên để bản đang chạy không vỡ trong lúc chờ đẩy mã.
- Sổ hiện mỗi loại vàng một thẻ: *Rong Phung: Nhập 2.00 L (75.00 g) · Xuất 1.00 L (37.50 g)*; loại tính bằng gram chỉ ghi gram.

## Kiểm tra

- **SQL:**
  - cọc thêm ghi sổ đúng;
  - "đã cọc", báo cáo đơn cọc và còn nợ lúc lấy hàng đều tính cả phần cọc thêm;
  - trần và từ chối sau khi lấy;
  - phiếu cọc không vào bộ lọc Còn nợ;
  - nhập/xuất tách đúng, cọc không tính, lấy hàng tính xuất, số lượng gốc và gram.
- **Thuần:** chữ khối lượng ("2.00 L (75.00 g)"), nút Thêm tiền cọc, thẻ nhập/xuất trên sổ, ô tồn kho.
- **Trình duyệt:** `verify:deposit` thêm bước cọc thêm trước khi lấy hàng.
