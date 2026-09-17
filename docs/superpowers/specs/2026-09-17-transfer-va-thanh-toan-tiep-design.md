# Transfer trong ô Loại, và thanh toán tiếp — thiết kế

Ngày 17-09. Nguồn: hai góp ý người dùng ở màn Giao dịch vàng, cùng ngày:

- *"Không có phân loại Transfer"*
- *"Không lưu được đối với đơn chưa thanh toán hết. Thực tế vẫn sẽ có đơn thanh toán 1 phần, còn nợ lại khách đợt sau thanh toán tiếp"*

## Vấn đề

**Transfer.** Quy đổi vàng (3edbf6a) có nút riêng "Quy đổi vàng" cạnh "Thêm giao dịch". Người dùng gọi việc này là Transfer, như trong Excel, và tìm nó trong ô **Loại** của form Thêm giao dịch. Ô đó chỉ có PO, PO_VENDOR, SALE, DEPOSIT, PICKUP, MEMO, ON_THE_WAY.

**Đơn trả một phần.** Mỗi phiếu ghi sổ ngay khi lưu (`post_gold_txn`, 0015). Phiếu mua ghi Nợ kho / Có tiền theo **từng khoản đã trả**, nên:

- phiếu mua trả 0 đồng: không có dòng bút toán, `post_gold_txn` từ chối; form chặn trước bằng "phải có ít nhất một khoản thanh toán";
- phiếu mua nhiều món trả thiếu: tiền chia theo thứ tự món, món cuối không có đồng nào, `write_gold_receipt` chặn bằng `PAYMENT_SHORT: item N`;
- phiếu mua một món trả thiếu: lưu được, nhưng kho chỉ ghi bằng số đã trả và phần nợ khách không nằm ở đâu.

Phiếu bán đã đúng: Nợ 131 / Có 511 đủ giá trị, mỗi khoản trả Nợ tiền / Có 131. Phần khách còn nợ nằm ở 131. Nhưng không có chỗ ghi lần khách trả tiếp.

## Đã chốt

1. Lần trả ở đợt sau ghi bằng **nút Thanh toán tiếp** trên dòng phiếu: có ngày riêng, ghi sổ vào ngày đó, phiếu gốc không bị sửa.
2. Lúc lưu, phiếu mua và phiếu bán được **trả từ 0 đến đủ**. Đặt cọc vẫn phải có tiền cọc. Trả dư vẫn chỉ cảnh báo như hiện nay.
3. Transfer có trong ô Loại; nút và nhãn gọi là Transfer.

## Thiết kế

### 1. Transfer

- Ô **Loại** của form phiếu **mới** có thêm `TRANSFER` ở cuối. Chọn nó thì form phiếu đóng và form quy đổi mở, mang theo ngày. Đã gõ gì thì hỏi "Bỏ phiếu đang nhập?" trước. Form sửa phiếu không có lựa chọn này.
- Nút "Quy đổi vàng" đổi thành **Transfer**. Tiêu đề form: **Transfer — quy đổi vàng**; sửa: **Sửa transfer**.
- Nhãn loại trên sổ là mã, như PO và SALE: **TRANSFER**, **RA_RP**. Ô Loại phiên trong form: "Transfer (quy đổi)", "Ra RP".

### 2. Lưu phiếu trả thiếu (0082)

- `write_gold_receipt`: `PAYMENT_SHORT` chỉ còn cho đặt cọc không có tiền.
- `post_gold_txn`, nhánh PO/PO_VENDOR: vẫn một dòng Nợ kho / Có tiền cho mỗi khoản đã trả. Nếu đã trả ít hơn giá trị phiếu, thêm **Nợ kho / Có 331** phần còn lại. Trọng lượng vẫn nằm ở dòng đầu (dòng 331 nếu chưa trả đồng nào).
  - Phiếu trả đủ ghi y như trước: không đổi bút toán nào đang có, không đổi báo cáo.
  - Trả dư giữ như hiện nay (chính sách trả dư còn chờ quyết).
- Form: bỏ lỗi "phải có ít nhất một khoản thanh toán" cho phiếu mua, giữ cho đặt cọc. Cảnh báo trả thiếu thành **"Còn nợ {0}. Vẫn lưu được; phần còn lại thanh toán tiếp trên sổ."**

### 3. Thanh toán tiếp (0083)

**Bảng `gold_receipt_settlement`:** `receipt_key` (khoá của dòng sổ: `gold_receipt.id`, hoặc `gold_txn.id` của giao dịch trước khi có phiếu), `pay_date`, `amount > 0`, `method`, `note`, `journal_entry_id`, `voided_at`, `void_reason`, `reversal_entry_id`, người tạo/sửa. Ai đăng nhập cũng đọc được; chỉ KT và ADMIN ghi.

**Còn nợ** của một phiếu PO, PO_VENDOR, SALE, PICKUP = |tổng thành tiền các món còn sống| − tiền trả lúc lưu − các lần trả sau chưa huỷ, không âm, làm tròn 2 số. Loại khác (và quy đổi): 0.

**`save_receipt_settlement(key yêu cầu, khoá phiếu, {payDate, amount, method, note})`** → `{settlementId, owed, repeated}`. Khoá yêu cầu như các lần lưu khác. Từ chối, theo thứ tự:

| Mã | Khi nào |
|---|---|
| `RECEIPT_VOIDED` | phiếu đã huỷ hoặc không còn món |
| `SETTLEMENT_KIND` | không phải phiếu mua hay bán (đặt cọc, memo, quy đổi…) |
| `SETTLEMENT_AMOUNT` | số tiền ≤ 0 |
| `SETTLEMENT_DATE: receipt D` | ngày trả trước ngày phiếu |
| `SETTLEMENT_PERIOD: P` | kỳ của ngày trả đã khoá |
| `SETTLEMENT_OVER: owed X paid Y` | số tiền lớn hơn số còn nợ |
| `SETTLEMENT_OLD_POSTING` | phiếu mua có món đã ghi sổ theo cách cũ: trả thiếu mà bút toán không có 331 |

Ghi sổ một bút toán ngày trả, số chứng từ của phiếu, đối tác của phiếu:
- mua: Nợ 331 / Có tiền theo hình thức;
- bán: Nợ tiền / Có 131.

**`void_receipt_settlement(id, lý do, ngày)`**: đảo bút toán (ngày mặc định là ngày trả), ghi `voided_at`. Huỷ lần hai: `SETTLEMENT_VOIDED`.

**Phiếu có lần trả sau chưa huỷ:**
- huỷ phiếu: `RECEIPT_HAS_SETTLEMENTS: N`;
- sửa phiếu: được; mọi lần trả sau chuyển sang phiếu mới. Sửa từ mua sang bán hoặc ngược lại: `RECEIPT_HAS_SETTLEMENTS: N`.

### 4. Sổ và file Excel (0084)

- `gold_receipt_ledger` trả thêm `settlements` (các lần trả sau chưa huỷ: id, ngày, số tiền, hình thức, ghi chú) và `owed`.
- Bộ lọc **Thanh toán** thêm **Còn nợ** (`OWED`): phiếu còn nợ > 0. Lọc theo hình thức cũng tính cả lần trả sau bằng hình thức đó.
- Cột Thành tiền: các khoản trả lúc lưu, rồi từng lần trả sau kèm ngày, rồi dòng đỏ **Còn nợ X** nếu còn.
- Cột Thao tác: nút **Thanh toán tiếp** cho phiếu mua/bán còn nợ, hoặc đã có lần trả sau.
- Hộp Thanh toán tiếp: tổng phiếu, đã trả, còn nợ; các khoản trả lúc lưu; các lần trả sau, mỗi lần có nút Huỷ (hỏi lý do); nếu còn nợ thì ô Ngày trả (mặc định hôm nay), Số tiền (mặc định số còn nợ), Hình thức, Ghi chú.
- Excel: thêm cột **Đã trả** (gồm cả lần trả sau) và **Còn nợ**, ở dòng món đầu của phiếu.

## Kiểm tra

- SQL: phiếu mua trả 0 và trả một phần ghi 331 đúng; trả đủ không có 331; đặt cọc không tiền vẫn bị chặn; thanh toán tiếp mua và bán; mọi mã từ chối; khoá yêu cầu; huỷ lần trả; huỷ phiếu bị chặn; sửa phiếu chuyển lần trả; sổ trả `settlements`, `owed`, lọc Còn nợ và lọc theo hình thức.
- Thuần: câu báo lỗi, đọc dòng sổ, file Excel, bộ lọc trong địa chỉ, nút Transfer.
- Trình duyệt: `verify:settlement` (ngày 2019, tự dọn); `verify:conversion` theo tên mới.
- Đưa lên: migration trước, mã sau, ngoài giờ nhập liệu.
