# Quy đổi vàng — thiết kế

Ngày 17-09. Nguồn: góp ý của người dùng, cùng tin nhắn với phiếu nhiều món. Ghi nguyên văn: *"cái transfer đâu?"*.

## Vấn đề

Database đã có chỗ ghi quy đổi từ đầu:
- bảng `gold_conversion` (0014);
- các loại giao dịch `TRANSFER_IN`, `TRANSFER_OUT`, `RA_RP`;
- quy tắc luồng vàng cho từng loại;
- kiểm tra cân trọng lượng, sai lệch cho phép `CONVERSION_WEIGHT_TOLERANCE_PCT` = 0,5%.

Nhưng **không có màn nào để nhập quy đổi**:
- 26 phiên quy đổi hiện có đều từ nạp bảng tính (tháng 1–6/2026);
- form nhập cố ý bỏ các loại Transfer;
- màn "bank-conversion" là việc khác (gắn tiền ngân hàng với vàng).

Từ khi sổ đọc theo phiếu (0076), mỗi vế quy đổi hiện thành một dòng riêng và đều bị khoá sửa (`CONVERSION_LEG`). Phiên 08/05 có 10 vế thành 10 dòng.

Thêm một lỗ hổng tìm thấy khi xem xét: các vế chuyển vàng do lô phân kim ghi gắn với lô (`refining_lot_id`), không gắn phiên quy đổi, nên **không bị khoá sửa** trong sổ. Database thật hiện chưa có dòng nào như vậy, nhưng lô gửi đi sau này sẽ có.

## Đã chốt với anh Việt

1. "Transfer" là **quy đổi loại vàng**: đổi vàng trong kho từ loại này sang loại khác, tổng trọng lượng giữ nguyên, có khi đổi với một đối tác.
2. **Mỗi lần đổi một phiên**, có số phiếu riêng. Bên RA và bên VÀO đều có thể nhiều dòng. Hai lần đổi trong một ngày là hai phiên.
3. **Cho chọn loại phiên:** "Quy đổi" (mặc định) hoặc "Ra RP" (Grain ra Rồng Phụng), để biểu đồ trang tổng quan vẫn tách được "Ra RP".
4. **Chỉ ghi vàng, đối tác tùy chọn.** Không có tiền trong phiên; tiền chênh lệch (nếu có) ghi riêng ở màn Tiền như hiện nay.
5. **Lệch vượt mức cho phép thì phải ghi lý do mới lưu được.** Phiên đó được đánh dấu "lệch cân".
6. **Phương án A:** quy đổi nằm ngay trong sổ giao dịch vàng. Có nút riêng; mỗi phiên là một dòng, mở ra thấy các vế; sửa và huỷ cả phiên.

## Dữ liệu

### Thêm vào `gold_conversion`

| Cột | Ý nghĩa |
|---|---|
| `doc_no` | số phiếu, cùng bộ đếm `PC49-YYMM-NNN` với giao dịch và phiếu; mọi vế mang đúng số này |
| `partner_code` | đối tác, tùy chọn |
| `variance_reason` | lý do lệch cân do người nhập ghi |
| `revision` | tăng mỗi lần phiên đổi (trigger như `gold_txn`), để người sửa sau bị báo xung đột |
| `voided_at`, `void_reason` | huỷ cả phiên |
| `corrects_conversion_id` | phiên này sửa cho phiên nào |
| `updated_at`, `updated_by` | như các bảng khác |

Giữ nguyên:
- `conv_date`, `kind`, `created_at/by`;
- `note`: ghi chú của phiên;
- `completed_at`: đặt khi lưu, để trigger 0014 tính chênh lệch;
- `variance_note`: máy ghi chênh lệch khi vượt mức.

Chính sách quyền giữ như 0014 (ai cũng đọc; KT và ADMIN ghi), viết lại dạng đọc vai trò một lần mỗi truy vấn như 0070.

### Các vế

Mỗi vế là một dòng `gold_txn` có `conversion_id`, như 26 phiên cũ:

| Loại phiên | Bên RA | Bên VÀO |
|---|---|---|
| `TRANSFER` (Quy đổi) | `TRANSFER_OUT`, số lượng âm | `TRANSFER_IN`, số lượng dương |
| `RA_RP` (Ra RP) | `RA_RP`, số lượng âm, chỉ Vàng Grain | `RA_RP`, số lượng dương, chỉ Rồng Phụng |

- Thành tiền 0, không đơn giá. Ghi sổ bằng `post_gold_txn` như hiện nay: một bút toán theo trọng lượng.
- Tồn kho đi theo `inventory_movement` như mọi giao dịch.
- Quy tắc luồng vàng (trigger 0012) vẫn kiểm từng vế.
- `line_no` đánh số trong từng bên: RA 1, 2…; VÀO 1, 2….
- Người nhập gõ số lượng không dấu; bên RA hay VÀO quyết định dấu.

### Gram để cân

Gram của một vế = số lượng × hệ số đơn vị trong `uom_factor` (gram 1; lượng 37,5; oz 31,105), tức `qty_gram` mà trigger 0012 đã tính.

Tính cân:
- chênh lệch = |gram VÀO − gram RA|;
- phần trăm = chênh lệch ÷ gram RA × 100, đúng công thức của trigger 0014.

Ví dụ phiên với Nini: RA 4 lượng RP = 150,00 g; VÀO 2 oz CS (62,21 g) + 1 oz Other (31,105 g) + 56,70 g Grain = 150,015 g. Lệch 0,015 g (0,01%), trong mức cho phép.

## Lưu, sửa, huỷ

Ba hàm database mới, chạy với quyền người gọi. Mỗi hàm là một lần ghi trọn vẹn.

Mã từ chối để màn hình dịch:
- `CONVERSION_SIDES`: thiếu một bên, hoặc một bên quá 30 dòng;
- `CONVERSION_QTY: out|in N`: dòng thứ N của một bên chưa có số lượng;
- `CONVERSION_RA_RP`: phiên Ra RP có dòng không phải Grain ra hoặc Rồng Phụng vào;
- `CONVERSION_UNBALANCED: out X in Y pct Z tolerance T`: lệch vượt mức mà không có lý do;
- `CONVERSION_REFINING`: phiên phân kim, phải sửa ở màn Phân kim;
- `CONVERSION_VOIDED`: phiên đã huỷ;
- dùng lại `CONFLICT` và `REQUEST_KEY_REUSED`.

### `save_gold_conversion(p_request_key, p_payload)`

Payload: `{ convDate, kind, partnerCode, note, varianceReason, out: [{goldTypeCode, uom, qty}], in: [{goldTypeCode, uom, qty}] }`.

1. Trùng khoá với cùng dữ liệu thì trả lại phiên đã lưu; trùng khoá khác dữ liệu thì từ chối. Dùng `request_outcome` như phiếu.
2. Kiểm tra:
   - mỗi bên 1–30 dòng;
   - số lượng > 0;
   - Ra RP chỉ Grain ra, Rồng Phụng vào;
   - lệch vượt `CONVERSION_WEIGHT_TOLERANCE_PCT` thì phải có `varianceReason`.
3. Cấp một số phiếu, tạo `gold_conversion`.
4. Ghi từng vế (dấu và loại giao dịch theo bảng trên, `doc_no` của phiên), rồi ghi sổ từng vế.
5. Đặt `completed_at`; trigger 0014 ghi `variance_note` nếu vượt mức.
6. Trả `{ conversionId, docNo, repeated }`.

### `correct_gold_conversion(p_request_key, p_original, p_expected_revision, p_reason, p_payload, p_reversal_date)`

- Khoá phiên, so phiên bản; khác thì `CONFLICT`.
- Phiên `REFINING_SEND` / `REFINING_RECEIVE` thì `CONVERSION_REFINING`; phiên đã huỷ thì `CONVERSION_VOIDED`.
- Một vế bị khoá bởi mã khác ngoài `CONVERSION_LEG` (0071) thì từ chối và nói vế nào: `LINE_BLOCKED: out|in N CODE`.
- Huỷ mọi vế cũ (`void_gold_txn`), đánh dấu phiên cũ đã huỷ, rồi ghi phiên mới như `save_gold_conversion`, **giữ số phiếu**, nối `corrects_conversion_id`.
- Phiên nạp từ bảng tính chưa có `doc_no` thì giữ số nhỏ nhất của các vế, tức số mà sổ đang hiện.

### `void_gold_conversion(p_original, p_reason, p_on_date)`

Huỷ mọi vế trong một lần, đánh dấu phiên đã huỷ. Từ chối phiên phân kim, phiên đã huỷ, và vế bị khoá bởi mã khác ngoài `CONVERSION_LEG`.

### Khoá sửa

- Thêm mã **`REFINING_LEG`** vào `correction_blocked_code`, cho dòng có `refining_lot_id`. Câu hiển thị: vi "Dòng này thuộc một lô phân kim; hãy sửa ở màn Phân kim"; en "This row belongs to a refining lot; correct it on the refining screen".
- `CONVERSION_LEG` giữ nguyên cho từng vế lẻ. Quy đổi được sửa theo cả phiên, bằng hàm của phiên.

## Màn nhập

**Nút "Quy đổi vàng"** cạnh "Thêm giao dịch" trên sổ giao dịch vàng. Dialog có tiêu đề "Quy đổi vàng"; khi sửa là "Sửa quy đổi".

**Đầu phiên:**
- ngày;
- loại phiên: **Quy đổi** (mặc định) hoặc **Ra RP**;
- đối tác (tùy chọn, gợi ý từ danh sách khách/NCC);
- ghi chú.

**Hai danh sách**, cạnh nhau trên màn rộng và xếp chồng trên điện thoại:

| Vàng RA | Vàng VÀO |
|---|---|
| Loại vàng · Số lượng (hậu tố đơn vị) · = gram | Loại vàng · Số lượng · = gram |
| "Thêm dòng ra", nút xoá từng dòng | "Thêm dòng vào", nút xoá |

- Mỗi bên tối thiểu 1, tối đa 30 dòng.
- **Quy đổi:** mỗi bên chỉ liệt kê loại vàng có quy tắc luồng đi hướng đó (`gold_flow_rule` với `TRANSFER_OUT` / `TRANSFER_IN`).
- **Ra RP:** bên RA khoá Vàng Grain, bên VÀO khoá Rồng Phụng; vẫn thêm được dòng nhưng không đổi được loại vàng.

**Ô cân bằng**, cập nhật khi gõ:

```
RA 637.50 g  ·  VÀO 637.50 g  ·  Lệch 0.00 g (0.00%)   ✓ cân
```

- Trong mức cho phép: màu xanh.
- Vượt mức: màu cam, kèm câu "Lệch 3.20 g (0.52%), vượt mức cho phép 0.5%", và hiện ô bắt buộc **"Lý do lệch"**.
- Mức cho phép đọc từ `system_param` khi mở trang.

**Nút:** Lưu; Lưu & thêm phiên tiếp (giữ ngày, xoá phần còn lại).

**Giống form phiếu:**
- khoá yêu cầu giữ nguyên trong một phiên;
- hỏi trước khi đóng form đang nhập dở;
- ô "Lý do sửa" điền sẵn khi sửa;
- lời gọi lưu đi qua `settleAction`;
- lời từ chối dịch sang tiếng Việt (lệch cân, `CONFLICT`, quy tắc luồng vàng, vế bị khoá).

## Sổ giao dịch và Excel

**Mỗi phiên quy đổi là một dòng.** Khoá nhóm của `gold_receipt_ledger` đổi từ `coalesce(receipt_id, id)` thành `coalesce(receipt_id, conversion_id, id)`, ở mọi hàm dùng khoá này:
- `gold_receipt_ledger_match`, `gold_receipt_locked`, `gold_receipt_lines`, `gold_receipt_payments`, `gold_receipt_sold_by`, `receipt_live_lines`;
- `gold_receipt_ledger`, `gold_receipt_ledger_totals`.

Hệ quả:
- 26 phiên nạp từ bảng tính cũng thành một dòng mỗi phiên.
- Vế lô phân kim không có `conversion_id` nên vẫn là dòng riêng, và bị khoá bằng `REFINING_LEG`.
- `void_gold_receipt` và `correct_gold_receipt` nhận nhầm khoá của một phiên quy đổi thì vẫn bị chặn, vì các vế mang `CONVERSION_LEG`.

**Sổ trả thêm cho mỗi dòng:** `conversion_id`, `conversion_kind`, `variance_note`, `variance_reason`. Với dòng quy đổi:
- số phiếu là `doc_no` của phiên, hoặc số nhỏ nhất của các vế nếu phiên chưa có số;
- phiên bản, ghi chú, đối tác lấy từ `gold_conversion`;
- mỗi vế trong `lines` có thêm bên: `out` hoặc `in`.

**Mã khoá của dòng quy đổi:**
- phiên phân kim luôn khoá, với câu "hãy sửa ở màn Phân kim";
- phiên thường: bỏ qua `CONVERSION_LEG` của các vế, lấy mã khác đầu tiên nếu có.

**Hiển thị:**

| Cột | Dòng quy đổi |
|---|---|
| Số CT, Ngày | của phiên |
| Loại | thẻ "Quy đổi" hoặc "Ra RP" |
| Khách / NCC | đối tác nếu có |
| Loại vàng | "Grain → Rồng Phụng"; nhiều loại thì "Nhiều loại (3 ra → 4 vào)" |
| Số lượng | tổng gram ra, ví dụ "637.50 g" |
| Đơn giá, Thành tiền | — |
| Ghi chú | ghi chú phiên; lệch cân thì thêm thẻ cam "Lệch cân", rê chuột thấy lý do |

- Bấm mở dòng: các vế chia hai nhóm RA và VÀO, mỗi vế có loại vàng, số lượng, đơn vị, gram.
- Nút Sửa mở form quy đổi; nút Huỷ gọi `void_gold_conversion`.

**Bộ lọc và thẻ tổng:**
- Một phiên khớp bộ lọc khi có ít nhất một vế khớp, như phiếu.
- Thẻ "Số phiếu" đếm luôn phiên quy đổi.
- Thẻ mua vào, bán ra, gram theo loại vàng vẫn cộng theo vế, không đổi.
- Kế hoạch truy vấn vẫn không gọi hàm lọc cho từng dòng (0069).

**Excel:** mỗi vế một dòng, lặp lại số phiếu, ngày, đối tác. Cột Loại ghi `TRANSFER_OUT` / `TRANSFER_IN` / `RA_RP`, số lượng có dấu, thành tiền 0. Cột "Mô tả món" ghi "Ra" hoặc "Vào".

**Trang tổng quan, tồn kho, sổ nhật ký, báo cáo:** không đổi.

## Ngoài phạm vi

- Tiền chênh lệch khi đổi với đối tác (ghi ở màn Tiền).
- Chuyển vàng giữa nơi giữ hoặc người giữ.
- Tách lại 26 phiên cũ gộp theo ngày thành từng lần đổi thật.
- Sửa lô phân kim từ sổ giao dịch.

## Kiểm thử

**Test SQL**, một phần chạy bằng `asRole` với vai trò KT:
- **Lưu phiên:**
  - "637.5 g Grain ra 17 lượng Rồng Phụng": hai vế cùng số phiếu, đã ghi sổ, `variance_note` trống;
  - phiên Nini (4 lượng RP ra; 2 oz CS, 1 oz Other, 56,7 g Grain vào): lệch 0,01%, lưu được, `qty_gram` từng vế đúng.
- **Lệch cân:**
  - vượt 0,5% mà không có lý do: `CONVERSION_UNBALANCED` kèm số gram, không ghi gì;
  - có lý do: lưu được, `variance_note` và `variance_reason` đều còn.
- **Ra RP:** bên ra khác Grain hoặc bên vào khác Rồng Phụng thì `CONVERSION_RA_RP`.
- **Kiểm tra dữ liệu:** thiếu một bên hoặc quá 30 dòng một bên thì `CONVERSION_SIDES`; số lượng 0 thì `CONVERSION_QTY`.
- **Lưu lặp:** bấm lưu hai lần vẫn một phiên; trùng khoá khác dữ liệu thì `REQUEST_KEY_REUSED`.
- **Sửa phiên:**
  - giữ số, huỷ đủ vế cũ, nối `corrects_conversion_id`;
  - sai phiên bản thì `CONFLICT`;
  - sửa được một phiên kiểu nạp từ bảng tính (không `doc_no`, nhiều vế, mỗi vế một số): giữ số nhỏ nhất.
- **Huỷ phiên:** mọi vế huỷ, gram tồn kho của phiên về 0; huỷ lần hai thì `CONVERSION_VOIDED`.
- **Phiên phân kim:** sửa và huỷ đều `CONVERSION_REFINING`.
- **`REFINING_LEG`:** dòng có `refining_lot_id` mang mã này; test đếm mã (0071) lên 9, có câu vi và en.
- **Sổ:**
  - phiên quy đổi thành một dòng có đủ vế và bên;
  - phiếu và dòng lẻ không đổi;
  - lọc loại vàng ra đúng phiên;
  - thẻ đếm gồm phiên;
  - kế hoạch truy vấn không có tên hàm lọc.

**Test phép tính** (hàm thuần):
- gram theo đơn vị;
- tổng hai bên, chênh lệch, phần trăm, trong mức hay vượt mức;
- tóm tắt cột loại vàng;
- dịch các mã từ chối của quy đổi.

**Kiểm tra trên trình duyệt:**
- `verify:conversion` mới, trên các ngày năm 2019:
  - nhập phiên Nini qua form; sổ hiện một dòng quy đổi, mở ra thấy vế RA và VÀO;
  - thử lệch vượt mức: form bắt ghi lý do;
  - sửa phiên (bỏ 1 oz Other, thêm 31,105 g Grain), rồi huỷ;
  - dọn sạch, rồi `verify:live`.
- Chạy lại `verify:receipt`, `verify:ledger`, `verify:void`, `verify:correct`.
- `verify:live` thêm kiểm tra: không còn `gold_conversion` nào trước năm 2025.

## Đưa lên

1. Migration chỉ thêm (cột mới, hàm mới, hàm đọc sổ viết lại cùng chữ ký, mã khoá mới). Bản đang chạy vẫn dùng được.
2. `npm run migrate` ngoài giờ nhập liệu, rồi `verify:live`.
3. Chạy thử trên bản build ở máy, sau đó chạy đủ cổng kiểm tra (test SQL chạy riêng, test thường, kiểu, lint, build, không dấu vết công cụ AI).
4. Đẩy lên ngoài giờ nhập liệu (trước 11:00 hoặc sau 15:00 giờ VN), chạy `verify:conversion` và `verify:ledger` trên Production, nhắn người dùng tải lại trang.
