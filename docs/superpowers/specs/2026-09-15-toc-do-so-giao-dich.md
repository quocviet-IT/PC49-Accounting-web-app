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

## Các đề xuất còn lại, đã làm tiếp (15-09)

Ba đề xuất ghi ở cuối đợt này đều đã làm. CSS tĩnh của antd là một đợt riêng, ghi trong `2026-09-15-css-tinh-antd.md`. Hai việc còn lại ghi dưới đây.

### Migration 0070 `a_role_is_read_once_per_query`: RLS hỏi quyền một lần cho mỗi truy vấn

- **Trước đây:** 78 chính sách của `pc49` gọi thẳng `pc49.effective_role()` hoặc `auth.uid()`, nên database gọi lại cho từng dòng.
- **Cách sửa:**
  - migration viết lại từng chính sách từ chính định nghĩa đang lưu, chỉ bọc các lời gọi đó thành `(SELECT …)`;
  - quyền của từng chính sách giữ nguyên.
- **Không đổi:** chính sách ảnh chụp góp ý trên `storage.objects`, vì bảng đó thuộc dịch vụ Storage và ảnh chỉ được đọc từng cái một.
- **Test SQL mới:** không chính sách nào của `pc49` còn gọi thẳng. Test đỏ trước 0070 và xanh sau. Cả bộ SQL đạt 30/30 file, 433 test.
- **Trên database thật sau khi chạy:**
  - cả 78 chính sách đã được bọc;
  - admin vẫn thấy đủ 1062 giao dịch, 611 khách và 4 người dùng.

Đo trên database thật, vai trò đăng nhập như app (admin), trung vị 7 lần:

| Truy vấn | Trước 0070 | Sau 0070 |
|---|---|---|
| Quét `gold_txn` qua RLS (1062 dòng) | 17,9 ms | 0,6 ms |
| `gold_txn_ledger` (50 dòng, không lọc) | 34,1 ms | 11,9 ms |
| `gold_txn_ledger_totals` (không lọc) | 22,0 ms | 3,6 ms |

So với trước đợt tăng tốc (104 ms và 84 ms), đọc một trang sổ giờ nhanh hơn khoảng 9 lần và số tổng khoảng 23 lần.

### Migration 0071 `a_refusal_to_correct_is_a_code`: lý do không sửa được là một mã

- **Trong database:**
  - `correction_blocked_code` trả một trong các mã `NOT_FOUND`, `VOIDED`, `CONVERSION_LEG`, `DEPOSIT_PICKUP`, `DEPOSIT_PICKED_UP`, `REFINING_RECEIPT`, `REFINING_SOURCE`, `CASH_LINK`, hoặc `null` nếu sửa được; các bước kiểm tra và thứ tự giữ đúng như 0055;
  - `correction_blocked_reason` vẫn trả câu tiếng Anh như cũ, nay lấy từ mã, để `correct_gold_transaction` dùng khi từ chối;
  - `gold_txn_ledger` trả cột `blocked_code` thay cho `blocked_reason`, và bộ lọc trạng thái dùng mã.
- **Trên màn hình:**
  - mã được dịch qua khoá `txn.blocked.<mã>`, có câu tiếng Việt và tiếng Anh;
  - mã chưa có câu dịch thì hiện câu chung "Không sửa được dòng này ở đây", không hiện mã.
- **Test:**
  - sổ trả `DEPOSIT_PICKED_UP` cho đơn cọc đã có lần lấy hàng, và `DEPOSIT_PICKUP` cho chính lần lấy hàng;
  - giao dịch đã huỷ trả `VOIDED` kèm câu tiếng Anh cũ; mã giao dịch không tồn tại trả `NOT_FOUND`;
  - đọc mã từ chính thân hàm, rồi kiểm tra mỗi mã đều có câu trong cả hai ngôn ngữ;
  - nút Sửa bị khoá hiện câu tiếng Việt, không hiện mã hay câu tiếng Anh.
- **Triển khai (15-09):**
  - thứ tự: đẩy code (`678e0b9`), chờ Vercel báo xong, rồi mới chạy 0071 trên database thật. Đẩy trước là để nếu lệnh đẩy bị chặn thì database vẫn khớp với bản đang chạy;
  - trong vài phút từ lúc bản mới lên đến lúc chạy xong 0071, các dòng bị khoá hiện nút Sửa đang bật, vì bản mới đọc `blocked_code` mà database chưa có cột này. Nếu có ai bấm lưu trong lúc đó, `correct_gold_transaction` vẫn từ chối, nên không có dữ liệu sai;
  - đo lại database thật sau 0071: sổ 11,9 ms, số tổng 3,7 ms, không đổi so với sau 0070.
- **Kiểm tra trên Production sau khi chạy 0071:**
  - database thật có 131 dòng bị khoá: 81 vế quy đổi, 25 đơn cọc đã có lần lấy hàng, 25 lần lấy hàng;
  - thử ba dòng thật, mỗi dòng một lý do: vế quy đổi `PC49-2601-036`, đơn cọc đã lấy hàng `PC49-2601-095`, lần lấy hàng `PC49-2601-096`. Cả ba đều khoá nút Sửa và hiện đúng câu tiếng Việt;
  - `verify:screens` đạt.
  - `probe:speed` chạy một lượt ngay sau đó, **đạt** mọi ngưỡng:
    - trang Giao dịch vàng dựng xong trong 504 ms; lượt cuối sau đợt CSS tĩnh là 582 ms;
    - các trang khác 273–472 ms;
    - đăng nhập 3668 ms.
