# Phiếu nhiều món — thiết kế

Ngày 17-09. Nguồn: góp ý của người dùng kèm ảnh một tờ phiếu mua vào có 6 món (nhẫn 24K vụn, mũ 24K vụn, thỏi Royal Canadian Mint, bi 24K vụn, xu Suisse, mặt dây 14K vụn — tổng 8.361,00). Ghi nguyên văn: *"người ta bán 1 lần 6 món là app đang bắt nhập 6 lần"*.

Góp ý thứ hai trong cùng tin nhắn — *"cái transfer đâu?"* — là một phần độc lập (chưa có màn nhập quy đổi vàng) và có thiết kế riêng, làm sau phần này.

## Vấn đề

Hiện mỗi giao dịch vàng chỉ có **một loại vàng**. Số phiếu, thanh toán và người bán đều gắn theo từng giao dịch. Một khách bán 6 món thành 6 giao dịch, 6 số phiếu, 6 lần gõ khách và 6 lần nhập thanh toán. Sổ cũng không khớp với tờ phiếu giấy.

## Đã chốt với anh Việt

1. **Một phiếu, nhiều dòng:** một số phiếu, một khách, một lần thanh toán cho cả phiếu; bên trong là danh sách món. Sửa/huỷ theo cả phiếu.
2. **Một phiếu một chiều:** cả phiếu là mua vào, hoặc cả phiếu là bán ra. Khách đổi vàng thì lập hai phiếu.
3. **Giá theo gram tinh**, như tờ phiếu, cho hàng cân bằng gram. Hàng tính theo đơn vị (lượng, oz) vẫn nhập số lượng × đơn giá.
4. **Phương án A — phiếu bọc các dòng:** mỗi món vẫn là một dòng giao dịch như hiện nay, nên ghi sổ, tồn kho, báo cáo và nạp dữ liệu giữ nguyên.

## Dữ liệu

### Bảng phiếu `gold_receipt`

| Cột | Ý nghĩa |
|---|---|
| `id` | khoá |
| `doc_no` | số phiếu, cấp một lần cho cả phiếu (`PC49-YYMM-NNN`, cùng bộ đếm với hiện nay) |
| `txn_date`, `txn_type` | ngày và loại, chung cho cả phiếu |
| `partner_code` | khách |
| `remarks` | ghi chú của phiếu |
| `revision` | tăng mỗi lần phiếu đổi, để hai người sửa cùng lúc thì người sau bị báo xung đột |
| `voided_at`, `void_reason` | huỷ cả phiếu |
| `corrects_receipt_id` | phiếu này sửa cho phiếu nào |
| `created_at/by`, `updated_at/by` | như các bảng khác |

Chính sách quyền giống `gold_txn`: ai cũng đọc được, chỉ KT và ADMIN ghi.

### Thêm vào `gold_txn`

- `receipt_id` — phiếu chứa dòng này. **Được phép để trống.**
- `line_no` — thứ tự món trong phiếu (1, 2, …).
- `item_desc` — mô tả món, ví dụ "Nhẫn 24K (vụn)".

Dòng của một phiếu mang lại đúng `doc_no`, `txn_date`, `txn_type`, `partner_code` của phiếu. Hàm lưu đảm bảo điều đó; không ai ghi riêng lẻ từng dòng.

### Dòng không thuộc phiếu nào là phiếu một dòng

Ngoài form nhập, còn bốn nơi tự ghi dòng giao dịch: nạp dữ liệu từ bảng tính (0066), lô phân kim (0056), phiên quy đổi (0063), và các script dữ liệu mẫu/kiểm tra. Các nơi này giữ nguyên, nên dòng chúng ghi có `receipt_id` trống.

Ở mọi chỗ đọc theo phiếu, một dòng có `receipt_id` trống được coi là **một phiếu một dòng**: khoá nhóm là `coalesce(receipt_id, id)`. Sổ hiện nó như một phiếu, và Sửa/Huỷ xử lý nó như một phiếu. Vì vậy **không cần chuyển dữ liệu cũ**: mọi giao dịch đang có tự hiện thành phiếu một dòng.

### Thanh toán và người bán: nhập ở phiếu, lưu ở dòng

**Thanh toán** nhập một lần cho cả phiếu, rồi được chia xuống `gold_txn_payment` của từng dòng theo **thứ tự lấp đầy**:

- đi theo `line_no`, rót lần lượt từng khoản thanh toán theo thứ tự nhập;
- mỗi dòng nhận tới đúng thành tiền của nó (giá trị tuyệt đối — phiếu mua vào lưu thành tiền âm) thì chuyển sang dòng kế;
- nếu thanh toán nhiều hơn tổng phiếu, phần dư nằm ở dòng cuối; nếu ít hơn, các dòng cuối thiếu phần còn lại — giống hệt một giao dịch đơn trả thiếu/dư hôm nay.

Ví dụ phiếu 8.361 trả 5.000 CASH + 3.361 BANKWIRE:
- CASH lấp món 1 (950), 2 (825), 3 (1.900) và 1.325 của món 4;
- BANKWIRE lấp 2.800 còn lại của món 4, món 5 (525), món 6 (36).

Tổng từng hình thức và tổng từng món khớp tuyệt đối, không có sai số làm tròn. Ghi sổ vẫn chạy theo từng dòng như hiện nay.

Thanh toán **của phiếu** khi đọc lại là tổng các dòng, gộp theo hình thức, theo thứ tự xuất hiện đầu tiên.

**Người bán:** tỷ lệ chia của phiếu được ghi y hệt vào `gold_txn_sales_person` của mọi dòng. Báo cáo doanh số theo người không đổi. Khi mở lại phiếu, tỷ lệ đọc từ dòng đầu.

### Giá theo gram tinh không thêm cột

Tuổi vàng (`gold_pct`) đã có. Với loại vàng có đơn vị gốc là gram (`gold_type.native_uom = 'GRAM'`):

- gram tinh = trọng lượng × tuổi;
- giá/gram tinh = thành tiền ÷ gram tinh;
- đơn giá lưu trong `unit_price` vẫn là **theo gram thô** = thành tiền ÷ trọng lượng, như hiện nay. Nhờ vậy phép kiểm "thành tiền = số lượng × đơn giá" của hàm lưu vẫn đúng.

Gram tinh và giá/gram tinh chỉ tính ra để hiển thị và để nhập; không lưu. Một dòng có tuổi trống thì không tính được gram tinh; dòng đó nhập như hàng tính theo gram thô.

## Lưu, sửa, huỷ

Ba hàm database mới, chạy với quyền người gọi như các hàm lưu hiện nay. Mỗi hàm là một lần ghi trọn vẹn: cả phiếu vào sổ, hoặc không gì cả.

### `save_gold_receipt(p_request_key, p_payload)`

1. Trùng `p_request_key` với cùng dữ liệu → trả lại phiếu đã lưu (bấm lưu hai lần vẫn một phiếu). Trùng khoá mà khác dữ liệu → từ chối, như `save_gold_transaction`.
2. Kiểm tra:
   - 1 đến **30** món;
   - `DEPOSIT` và `PICKUP` đúng **1** món (cọc và lấy hàng nối với nhau theo từng giao dịch);
   - mỗi dòng: loại vàng hợp lệ, số lượng > 0, thành tiền khớp số lượng × đơn giá;
   - tỷ lệ người bán cộng đủ 100%.
3. Cấp **một** số phiếu, tạo `gold_receipt`.
4. Tạo từng dòng `gold_txn` bằng đúng phần ghi dòng đang dùng (`write_gold_transaction`), với `receipt_id`, `line_no`, `item_desc`.
5. Chia thanh toán theo thứ tự lấp đầy; chép tỷ lệ người bán.
6. Ghi sổ từng dòng bằng `post_gold_txn`.
7. Ghi `request_outcome`, trả `{ receiptId, docNo, repeated }`.

### `correct_gold_receipt(p_request_key, p_original, p_expected_revision, p_reason, p_payload, p_reversal_date)`

- `p_original` là một phiếu, hoặc một dòng không có phiếu (phiếu một dòng).
- Phiên bản đang xem khác phiên bản hiện tại → `CONFLICT`.
- Bất kỳ dòng nào bị khoá sửa (mã từ `correction_blocked_code`, 0071) → từ chối và **nói rõ món thứ mấy**, kèm mã khoá để màn hình dịch.
- Huỷ mọi dòng cũ (`void_gold_txn`), đánh dấu phiếu cũ đã huỷ, rồi lưu phiếu mới như `save_gold_receipt` nhưng **giữ số phiếu cũ**.
- Nối lịch sử: bản gốc là phiếu thật thì phiếu mới ghi `corrects_receipt_id`; bản gốc là dòng lẻ thì dòng đầu của phiếu mới ghi `corrects_txn_id`, như việc sửa một giao dịch hôm nay.

### `void_gold_receipt(p_original, p_reason, p_on_date)`

- Huỷ mọi dòng của phiếu (hoặc dòng lẻ) trong một lần, kèm lý do.
- Có dòng bị khoá thì từ chối và nói món thứ mấy.

`save_gold_transaction` và `correct_gold_transaction` giữ lại cho đến khi không còn chỗ nào gọi, rồi bỏ trong một migration sau.

## Màn nhập

**Đầu phiếu:** ngày, loại, khách + số điện thoại, người bán + tỷ lệ chia, ghi chú.

**Danh sách món**, mỗi dòng:

| Cột | Hàng tính theo gram | Hàng tính theo đơn vị (lượng/oz) |
|---|---|---|
| Mô tả món | nhập | nhập |
| Loại vàng | chọn | chọn |
| Nhóm vàng vụn | chỉ hiện với vàng vụn | — |
| Trọng lượng (g) / Số lượng | nhập | nhập |
| Tuổi | nhập | — |
| Gram tinh | máy tính | — |
| Giá/gram tinh / Đơn giá | nhập ↔ thành tiền | nhập ↔ thành tiền |
| Thành tiền | nhập ↔ giá | nhập ↔ giá |

Gõ giá thì ra thành tiền; gõ thành tiền thì ra giá — như đơn giá và thành tiền hiện nay. Có nút **Thêm món**, mỗi dòng có nút xoá, tối thiểu một món, tối đa 30. Với `DEPOSIT`/`PICKUP`, nút Thêm món ẩn đi.

**Cuối phiếu:** dòng tổng (tổng trọng lượng, tổng thành tiền), rồi thanh toán cho cả phiếu như hiện nay. Nếu tổng thanh toán lệch tổng tiền, hiện ngay ở đó chênh bao nhiêu.

**Nút:** Lưu; Lưu & thêm phiếu tiếp (giữ ngày, xoá phần còn lại).

**Sửa:** mở cả phiếu với đủ các món, thanh toán và người bán của phiếu.

Lời gọi lưu đi qua `settleAction` như mọi màn khác, nên phiên bản cũ của trang cũng không làm nút quay mãi.

## Sổ giao dịch và Excel

**Mỗi phiếu một dòng.** Hàm đọc sổ mới `gold_receipt_ledger` nhóm theo `coalesce(receipt_id, id)` và trả về cho mỗi phiếu:

- số phiếu, ngày, loại, khách, số điện thoại;
- **tổng tiền** (cộng các dòng);
- **loại vàng:** tên loại nếu cả phiếu một loại, còn khác loại thì "Nhiều loại (n món)";
- **thanh toán của phiếu** (gộp theo hình thức) và người bán;
- danh sách món (mô tả, loại vàng, trọng lượng, tuổi, gram tinh, giá/gram tinh, thành tiền), để bấm vào dòng là mở ra ngay bên dưới;
- phiên bản, và mã khoá sửa của món bị khoá đầu tiên nếu có;
- tổng số phiếu khớp bộ lọc, để phân trang.

**Bộ lọc giữ nguyên ý nghĩa:** một phiếu khớp bộ lọc loại vàng / người bán / hình thức khi **có ít nhất một món** khớp. Các điều kiện có truy vấn con tách thành hàm nhỏ, như 0069, để PostgreSQL vẫn gộp được điều kiện vào câu truy vấn.

**Thẻ tổng** (mua vào, bán ra, gram theo loại vàng) vẫn cộng theo món nên số không đổi. Ô đếm đổi thành "số phiếu".

**Xuất Excel: mỗi món một dòng**, thêm cột mô tả món, lặp lại số phiếu, ngày, khách trên mọi dòng.

**Tồn kho, sổ nhật ký, báo cáo:** không đổi.

## Ngoài phạm vi

- Phiếu đổi vàng (vừa mua vừa bán trong một phiếu).
- Đặt cọc / lấy hàng nhiều món.
- In phiếu.
- Nhập quy đổi vàng ("transfer") — thiết kế riêng, làm ngay sau.

## Kiểm thử

**Test SQL** — một phần chạy bằng `asRole` với vai trò KT, vì test chạy bằng quyền chủ database không thấy lỗi quyền:

- lưu phiếu 6 món: một `gold_receipt`, 6 dòng cùng số phiếu và `line_no` 1–6, dòng nào cũng đã ghi sổ;
- chia thanh toán 5.000 CASH + 3.361 BANKWIRE đúng như ví dụ ở trên; tổng theo hình thức và theo món khớp tuyệt đối;
- thanh toán dư và thiếu nằm đúng chỗ;
- tỷ lệ người bán có trên mọi dòng;
- bấm lưu hai lần vẫn một phiếu;
- `DEPOSIT` 2 món bị từ chối; 31 món bị từ chối;
- sửa phiếu giữ số cũ, huỷ đủ dòng cũ, sai phiên bản thì `CONFLICT`;
- một món đã vào lô phân kim thì sửa và huỷ đều từ chối, nói đúng món thứ mấy;
- sửa và huỷ một dòng không có phiếu vẫn được, như phiếu một dòng;
- `gold_receipt_ledger`: dòng không có phiếu hiện thành phiếu một dòng; lọc loại vàng ra đúng phiếu có món đó; kế hoạch truy vấn không gọi hàm lọc cho từng dòng.

**Test phép tính** (hàm thuần): gram tinh; giá/gram tinh ↔ thành tiền; hàng tính theo đơn vị; tuổi trống.

**Kiểm tra trên trình duyệt** — `verify:receipt` mới:
- nhập **đúng tờ phiếu 6 món trong ảnh** (tổng 8.361,00, trả CASH + BANKWIRE);
- xem sổ hiện một phiếu 6 món với đúng tổng;
- sửa phiếu (bớt một món), rồi huỷ cả phiếu;
- dọn sạch, rồi `verify:live`.

`verify:payments`, `verify:void`, `verify:correct` chạy lại và cập nhật chỗ nào đụng form mới.

## Đưa lên

1. Migration (bảng phiếu, cột mới, ba hàm lưu/sửa/huỷ, hàm đọc sổ). Không chuyển dữ liệu cũ.
2. Chạy `npm run migrate` trên database thật, rồi `verify:live`.
3. Triển khai **sau giờ nhập liệu** (sau 15:00 giờ VN) và nhắn người dùng tải lại trang một lần.
4. Chạy `verify:receipt` trên Production.
