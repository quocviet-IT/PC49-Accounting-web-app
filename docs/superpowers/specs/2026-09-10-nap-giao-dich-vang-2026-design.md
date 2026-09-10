# Đổ giao dịch vàng và phân kim 2026 vào hệ thống — thiết kế

Ngày 10-09-2026.

## Vì sao làm cái này

Hệ thống đang chạy trên 62 dòng demo do `scripts/demo-data.mjs` sinh ra, cộng một
dòng lẻ ai đó gõ thử ngày 29/08. Mọi màn hình đều đúng trên dữ liệu đó, và không
câu nào trong số đó chứng minh được gì: dữ liệu demo được nặn ra cho vừa với hệ
thống. Số thật thì không.

Khi số thật vào, ba câu hỏi mới trả lời được. Nhập một ngày thật mất bao lâu.
Tồn kho hệ thống tính có bằng tồn kho kế toán đã chốt không. Và những chỗ nguồn
tự mâu thuẫn — có bao nhiêu, nằm ở đâu.

## Phạm vi

**Trong phạm vi:** giao dịch vàng và phân kim, tháng 1 đến tháng 6 năm 2026.

**Ngoài phạm vi đợt này:** bảng giá spot và giá vốn theo ngày; số dư tiền đầu kỳ;
sao kê ngân hàng (P6 đã có bộ nạp riêng, hai bộ đọc cùng một tệp là chỗ để lệch
nhau); và dữ liệu từ tháng 7 trở đi — bản sao trong thư mục dừng ở 10/06, phải
chờ chia sẻ tệp gốc.

Không có bảng giá thì phiếu bán vẫn vào bình thường, chỉ cột giá vốn để trống.
Màn hình Giá vàng đã có sẵn danh sách "bán mà chưa có giá ngày đó" để bổ sung sau.

## Nguồn

| Nguồn | Tệp | Tab |
|---|---|---|
| Giao dịch | `1lRiW556…RbROA` US_PC49 DASHBOARD 2026 | `PC49 Sale 01.2026` … `06.2026` |
| Hạng vàng vụn, cột tick | `1gEeKMkv…GACng` US_Scrap Gold Report 2026 | `1.Scrap Gold` |
| Lô phân kim | `1dzLTV4G…BcWHA` BC 201 Sales Report | `3.2 PC49 SCRAP GOLD`, `3.3 MH SCRAP GOLD` |
| Tồn đầu kỳ, tồn cuối tháng | `1JZ8mi1N…LITJ4` GENERAL REPORT 2026 | `A.REPORT IN/OUT` |

Khối lượng: **1.126 dòng giao dịch** — mua 610, bán 315, chuyển đổi 151, giao hàng
đặt cọc 32, mua nhà cung cấp 5, ký gửi 9, ra Rồng Phụng 4. Theo tháng: 235 · 184 ·
224 · 215 · 184 · 83. Ba lô phân kim với 15 túi của PC49 và 13 dòng túi của MH.

Một điều đáng ghi: **nguồn dùng đúng quy ước dấu mà hệ thống dùng** — mua thì số
lượng dương và tiền âm, bán thì ngược lại. Không phải đổi dấu ở đâu cả.

## Con đường: đi qua màn hình Nạp dữ liệu

Không viết script ghi thẳng vào cơ sở dữ liệu. Màn hình `/import` đã có sẵn từ P9
làm đúng năm việc mà một lần đổ dữ liệu cần: khai trước con số kỳ vọng, dựng từng
dòng và phán xét trước khi ghi, cho người nạp xem những dòng bị trả và vì sao,
duyệt phần tốt, rồi nói cho biết chi tiết có cộng lại bằng con số đã khai không.

Một script ghi thẳng làm xong trong một buổi và để lại một bộ sổ không ai soát
được, vì không có chỗ nào ghi lại nó đã tự quyết những gì trên đường đi.

Bộ phiên dịch — `scripts/sheet-to-import.mjs` — đọc Google Sheets và xuất ra CSV
đúng khuôn bộ nạp. Nó chỉ đổi tên cột và tra bảng; mọi phán xét nằm trong SQL, nơi
kiểm được bằng test và nhìn được trên màn hình.

### Bảng tra

Loại vàng theo cột `Description`: Rong Phung→`RP` · Scrap gold→`SG` · Credit
Suisse→`CS` · Maple Leaf→`ML` · American Eagle→`AE` · Grain→`GRAIN` · 9999 ·
PT · Other→`OTH`. Đơn vị: Lượng→`LUONG` · Oz→`OZ` · Gram→`GRAM` — và mỗi loại
vàng chỉ đi với đúng một đơn vị trong cả 1.126 dòng, nên lệch đơn vị là lỗi gõ,
phải trả lại chứ không tự sửa.

Loại giao dịch theo cột `Type`: PO→`PO` · PO(Vendor)→`PO_VENDOR` · Sale→`SALE` ·
Memo→`MEMO` · Ra RP→`RA_RP` · Transfer→`TRANSFER_IN` hoặc `TRANSFER_OUT` theo dấu
số lượng · Pickup→ xem bên dưới.

Hình thức thanh toán: Cash→`CASH` · Check→`CHECK` · Zelle→`ZELLE` · Bank
wire→`BANKWIRE`. Chiều là `AP` cho các cột mua, `AR` cho các cột bán và đặt cọc.

## Bốn chỗ nguồn không nói thẳng

**Chuyển đổi phải có lý do.** Hệ thống bắt mỗi dòng `TRANSFER_IN`/`TRANSFER_OUT`/
`RA_RP` gắn với một phiên quy đổi hoặc một lô phân kim — nếu không thì vàng biến
mất khỏi loại này và hiện ra ở loại kia mà không ai giải thích được. Sheet ghi
chúng thành các dòng rời trong cùng một ngày. Trong 50 ngày có chuyển đổi: 9 ngày
thuần vàng vụn hoặc bạch kim (gửi phân kim, gắn vào lô), 5 ngày lẫn, 26 ngày cân
đúng gram khi gộp cả ngày lại, và **10 ngày lệch**. Mười ngày đó bộ phiên dịch
không đặt khoá gộp, bộ nạp trả lại kèm lý do, và kế toán soát tay. Đoán ở đây là
tự bịa ra một phiên quy đổi chưa từng xảy ra.

**Giao hàng đặt cọc là hai phiếu, không phải một.** Dòng `Pickup` của sheet mang
cả tiền cọc (`Amount-1st`, ngày của dòng) lẫn tiền lấy hàng (`Amount-2nd`, ngày ở
cột `Pickup Date`). Hệ thống mô hình hoá đúng như nó xảy ra: một phiếu `DEPOSIT`
ngày nhận cọc, rồi một phiếu `PICKUP` ngày giao hàng trỏ về phiếu cọc đó. 32 dòng
thành 64 phiếu. Ràng buộc `gold_txn_pickup_needs_deposit` sẽ không cho làm khác.

**Sales ghép.** Ô sales viết `L.Thanh`, hoặc `N.Ý/T.Quỳnh`, hoặc ba tên. Đếm được
581 ô một người, 541 ô hai người, 4 ô ba người — đúng ba hình mà kế toán đã trả
lời trong bộ câu hỏi, nên tỷ lệ là 100 · 80-20 · 60-20-20 theo thứ tự viết. Bảy
tên chưa có trong hệ thống (Val 37 lần, Q.Nghi 28, H.An 27, Lyn 12, Millie 4,
A.Đức 3, C.Loan 2) được tạo với đúng tên trong sheet; sửa lại tên đầy đủ sau ở
màn hình Cấu hình.

**Cột khách kiêm ô ghi chú.** 656 tên khác nhau, 452 tên xuất hiện đúng một lần —
khách vãng lai, đúng như một tiệm vàng. Nhưng cột này còn chứa những dòng không
phải khách: `Send to assay` 26 lần, `Gởi Shawn bán` 13 lần, `Transfer 1L vàng 9999
ra 37.5gr vàng Grain` 10 lần. Với các phiếu chuyển đổi và ký gửi, nội dung ô đó đi
vào ô Ghi chú chứ không tạo ra một khách hàng không tồn tại. Với các phiếu mua bán,
tên khách chính là mã khách, y như cách hệ thống đang chạy.

## Ba việc cơ sở dữ liệu phải làm thêm

**0062 — bộ nạp giao dịch mang theo thanh toán, sales và phiên quy đổi.** Bộ nạp
hiện chỉ dựng được thân giao dịch. Thiếu thanh toán thì `post_gold_txn` từ chối
ghi sổ ("produced no journal lines"), nên 1.126 dòng vào rồi nằm im ngoài sổ.
Payload nhận thêm `payments` và `sales`; hàm duyệt tạo luôn khách và sales chưa
có, gom các dòng cùng `conv_key` thành một `gold_conversion`, và nối `PICKUP` với
`DEPOSIT` cùng `deposit_key`. Kèm `post_import_batch(batch)` ghi sổ cả lô theo thứ
tự ngày — cọc trước giao hàng — và báo lại dòng nào không ghi được, vì sao.

**0063 — bộ nạp phân kim mang theo túi.** Hiện chỉ dựng được đầu lô. Payload nhận
thêm danh sách túi (chủ sở hữu, kim loại, trọng lượng, tuổi vàng, kết quả assay).
Nguyên tắc: **bộ nạp gắn giao dịch đã có vào lô, không sinh giao dịch mới** — chân
chuyển kho của ba lô này chính là các dòng `Transfer` mà kế toán đã ghi trong
sheet. Lô được dựng thẳng ở trạng thái cuối của nó, nên trigger `refining_lot_send_legs`
(chỉ chạy khi cập nhật trạng thái) không sinh thêm chân thứ hai. Sổ có đúng một
bộ chân, là bộ kế toán thật sự đã ghi.

**Túi palladium.** Lô S26.03 có một túi ghi `PD`; hệ thống chỉ biết `GOLD` và
`PLATINUM`. Nạp tạm như bạch kim, ghi rõ trong ô mô tả túi. Báo cáo sẽ đếm nó
thành bạch kim — đó là cái giá đã biết trước, đổi lại lô không bị nạp thiếu.

## Dựng chỗ để đặt giao dịch

Ba thứ không phải dữ liệu mới, chỉ là chỗ trống phải có sẵn:

- Kỳ kế toán `2026-01` đến `2026-06`, mở. Không có kỳ thì hệ thống chặn ghi sổ.
- Bảy sales nói ở trên.
- Tồn đầu 01/01/2026, 7 dòng: RP 80 lượng · ML 15 oz · CS 28 oz · Oth 1 oz ·
  SG 234,78 g · PT 474,13 g · Grain 1.088,54 g (9999 và AE bằng 0). Đây là vàng
  chứ không phải tiền, nên nó thuộc đợt này. Thiếu nó thì ngày 1/1 cửa hàng bán
  một lượng Rồng Phụng mua từ năm ngoái, tồn kho âm và giá vốn tháng 1 vô nghĩa.

Trước tất cả: dọn `npm run demo:clear`, xoá dòng lẻ 29/08 và lô nạp hỏng 1.003
dòng đang nằm trên hệ thống.

## Bài kiểm tra

Sheet `A.REPORT IN/OUT` đã tự khai tồn cuối tháng 1: RP 43 lượng · ML 14 oz ·
CS 25 oz · 9999 15 lượng · Oth 2 oz · SG 132,44 g · PT 116,71 g · Grain
1.717,39 g. Những con số này khai vào `import_expected_figure` **trước** khi nạp
chi tiết, và `import_reconciliation` đặt chúng cạnh cái hệ thống tự tính ra.

Đó là toàn bộ ý nghĩa của đợt này: kế toán không phải tin bộ nạp, họ được hệ thống
nói cho biết nó có chạy đúng hay không.

Mỗi tháng còn có dòng SUBTOTAL riêng cho trọng lượng và tiền; khai luôn để lệch lộ
ra ở tháng gây lệch chứ không dồn về cuối.

## Quyết định đã chốt

| Câu hỏi | Trả lời (10-09-2026) |
|---|---|
| Phạm vi | Cả năm 2026, nhưng đợt này chỉ giao dịch vàng và phân kim |
| Dữ liệu T7→nay | Chia sẻ tệp gốc cho `intern1@ctyhp.vn` |
| Số dư tiền đầu kỳ | Để sau, nạp vàng trước |
| Túi PD | Nạp tạm như bạch kim, ghi chú rõ |
| Sales chưa có | Tự thêm, dùng đúng tên trong sheet |
| Mã khách | Dùng luôn tên làm mã |
