# Tăng tốc sổ giao dịch vàng — ghi chép đo đạc

Sau phần 3, `probe:speed` trên Production đo trang `/gold-transactions` được 1036, 1542 rồi 905 ms, trong khi ngưỡng là 800 ms. Các trang khác chỉ 320–600 ms. Anh Việt đồng ý làm một đợt tăng tốc riêng cho trang này (15-09). Tài liệu này ghi nguyên nhân đã đo được, việc đã làm và kết quả.

## Đo tìm nguyên nhân

### Dung lượng trang (Production, 20 dòng)

- HTML 517 KB, trong đó:
  - 373 KB là CSS của antd trong 2 thẻ `<style>`;
  - 53 KB là dữ liệu React, có danh mục 611 khách;
  - 87 KB là HTML hiển thị.
- Hai thẻ CSS không trùng nhau: chỉ 56/920 khối giống nhau. Thẻ đầu (183 KB) giống hệt trên mọi trang, thẻ sau là CSS riêng của trang.
- Trang Tồn kho mang 394 KB CSS mà vẫn chạy khoảng 500 ms. Vậy CSS không phải chỗ khác biệt.

### Database (vai trò đăng nhập như app, trung vị 5 lần)

| Truy vấn | Trước 0069 | Sau 0069 |
|---|---|---|
| `gold_txn_ledger` (50 dòng) | 104 ms | 34 ms |
| `gold_txn_ledger_totals` | 84 ms | 22 ms |

- **Nguyên nhân:** hàm `gold_txn_ledger_match` có `SET search_path` và chứa `EXISTS`. Hàm SQL có một trong hai thứ đó thì PostgreSQL không gộp được vào truy vấn, nên gọi riêng cho từng dòng trong 1062 dòng, kể cả khi không lọc gì.
- **Mức sàn** là 18 ms, do chính sách RLS gọi `effective_role()` ở từng dòng.

### Render (máy dev, React bản production, trung vị 10 lần)

Mỗi lượt dùng bộ nhớ CSS antd mới, giống điều server phải làm cho mỗi yêu cầu.

| Trường hợp | Thời gian |
|---|---|
| antd tối thiểu (1 nút) | 30 ms |
| Sổ 0 dòng: CSS mới / CSS đã ấm | 136 / 32 ms |
| Sổ 50 dòng: CSS mới / CSS đã ấm | 228–296 / 170 ms |
| Sổ 50 dòng, bỏ Tooltip antd ở cột thao tác | 195 ms |
| Sổ 50 dòng, nhãn loại là chữ thường | không nhanh hơn |
| Sổ 50 dòng, không gửi danh mục khách | không nhanh hơn |

- antd tốn khoảng 105 ms mỗi yêu cầu chỉ để sinh CSS cho các component của trang. Đây là chi phí cố định.
- 100 Tooltip ở cột thao tác là chi phí theo dòng lớn nhất. Phần 3 thêm 50 cái trong số đó, vì nút Huỷ trước đây không có tooltip.

### Production sau 0069, trước khi đổi tooltip

- Sổ giao dịch: trung vị 978 ms (861–1382).
- Tồn kho: 490 ms.

Database đã nhanh hơn 3–4 lần mà trang gần như không đổi. Vậy lấy dữ liệu không phải nút thắt chính; phần lớn thời gian nằm ở server dựng trang.

## Đã làm

- **Migration 0069 `the_ledger_filter_folds_into_the_query`:**
  - ba chỗ `EXISTS` tách thành hàm nhỏ `gold_txn_shared_by`, `gold_txn_paid_with`, `partner_phone_matches`, chỉ được gọi khi bộ lọc tương ứng đang bật;
  - `gold_txn_ledger_match` bỏ `SET search_path`, vì mọi tên đều có tiền tố `pc49.` và hàm chạy với quyền người gọi, giống `fold_search`;
  - khi không có từ khoá tìm kiếm thì bỏ qua bước chuẩn hoá chữ.
  - Một điều kiện lọc vẫn dùng chung cho trang, số tổng và file Excel.
- **Test SQL:**
  - kế hoạch truy vấn không còn gọi `gold_txn_ledger_match` (đỏ với 0068, xanh với 0069);
  - tìm kiếm chỉ có dấu câu vẫn trả đủ mọi dòng.
- **`IconAction`:** tên của nút icon vẽ bằng CSS từ `data-tip`, hiện bên trái nút khi rê chuột hoặc dùng bàn phím; nút bị khoá thì hiện lý do. Không còn Tooltip antd ở từng dòng. Có test.
- **`verify:void` và `verify:correct` viết lại theo form nhập và icon Sửa/Huỷ.** Hai script cũ gõ vào lưới nhập đã bỏ từ 10-09. Giữ nguyên các bước kiểm tra sổ sách: bút toán đảo, tồn kho, liên kết dòng thay thế, doanh thu tháng. Kết quả đạt 10/10 và 12/12, tự dọn dữ liệu thử.

## Kết quả

- **Render với `IconAction` mới** (máy dev, React bản production, trung vị 10 lần): sổ 50 dòng với bộ nhớ CSS mới mất 157–168 ms. Biến thể chỉ là nút trần, không bọc gì, mất 141 ms.
  - Lượt đo này máy rảnh hơn lượt trước (nút antd tối thiểu 19 ms so với 30 ms), nên không so thẳng với 228–296 ms được.
  - Trong cùng lượt, bản dùng nhãn CSS gần bằng bản không có tooltip.

- **Production sau khi đẩy `2304a4e`** (cột "built" của `probe:speed`, ngưỡng 800 ms):

| Lượt | Giao dịch vàng | Theo ngày | Tồn kho | Đăng nhập | `probe:speed` |
|---|---|---|---|---|---|
| 1, ngay sau khi triển khai | 790 ms | 725 ms | 519 ms | 5479 ms | chưa đạt (`/import` 884 ms, đăng nhập) |
| 2 | 842 ms | 902 ms | 379 ms | 4962 ms | chưa đạt |
| 3, đo lại khi mạng ổn hơn | 625 ms | 500 ms | 551 ms | 3992 ms | **đạt** |

- Sáu vòng xen kẽ:
  - sau lượt 2: Giao dịch vàng trung vị 843 ms (681–1024), Tồn kho 630 ms, theo ngày 689 ms;
  - sau lượt 3: Giao dịch vàng 789 ms (611–819), Tồn kho 523 ms, theo ngày 591 ms.
- So với trước đợt này (trung vị 978 ms; theo ngày 1114 ms), trang Giao dịch vàng nhanh hơn khoảng 140–190 ms và trang theo ngày khoảng 420–520 ms.
- Trang Giao dịch vàng giờ đạt ngưỡng khi mạng ổn nhưng vẫn sát ngưỡng. Lúc mạng chậm (lượt 1 và 2, khi cả đăng nhập lẫn trang Tồn kho cũng chậm hơn thường lệ) vẫn có lượt vượt.
- Đợt này không đụng tới đăng nhập. Đăng nhập mất 5,0–5,5 giây ở lượt 1–2 rồi về 3,99 giây ở lượt 3, cùng nhịp với trang Tồn kho, nên đó là nhiễu của mạng hoặc Vercel.
- Kiểm tra trên Production sau khi đẩy: giao diện 12/12 (nhãn tên nút vẽ bằng CSS), `verify:screens` đạt.

## Chưa làm, đề xuất

- **CSS tĩnh của antd (`zeroRuntime`, có từ antd 6):**
  - bỏ khoảng 105 ms sinh CSS mỗi yêu cầu và khoảng 370 KB CSS nhúng trong mỗi trang;
  - đổi lại, phải sinh CSS theo màu xanh kế toán cho cả nền sáng và tối, và nạp một file CSS riêng (`antd.css` gốc nặng 1 MB);
  - thay đổi này đụng mọi trang và dễ lệch màu, nên nên làm thành một đợt riêng, có ảnh chụp so sánh.
- **RLS:** bọc `effective_role()` thành `(SELECT pc49.effective_role())` trong các chính sách, để database tính một lần cho mỗi truy vấn thay vì mỗi dòng. Hiện tốn khoảng 15 ms mỗi truy vấn trên 1062 dòng, và sẽ tăng theo lượng dữ liệu.
- **Lý do không sửa được giao dịch** (`correction_blocked_reason`) đang là tiếng Anh, ví dụ "this is one leg of a conversion…". Nên trả về mã lý do rồi dịch như màn Nạp dữ liệu.
