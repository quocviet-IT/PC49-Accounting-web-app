# Tên loại vàng, đặt cọc và lấy hàng — thiết kế

Ngày 17-09. Nguồn: góp ý người dùng đợt 3, kèm ảnh lỗi khi lưu phiếu PICKUP:

1. *"Đổi tên các loại vàng theo quy ước hiện tại"*
2. *"Hệ thống bắt buộc thanh toán hết đơn…"* — đã sửa ở 35d5a71 (phiếu mua/bán trả một phần, Thanh toán tiếp).
3. *"Deposit gặp lỗi giống cái thứ 2 phải thanh toán"*
4. *"Khi pickup không chỉnh sửa được trạng thái từ deposit sang pickup, cũng chưa có trường dữ liệu để phân biệt ngày nào đặt cọc, ngày nào pickup. Chị có thử tạo đơn pickup riêng nhưng không lưu được"* — ảnh: `violates check constraint "gold_txn_pickup_needs_deposit"`.

## Vấn đề

- **Tên loại vàng** trên màn hình là tên tiếng Việt do hệ thống đặt (Rồng Phụng, Vàng Grain, Vàng khác, Bạch kim…), không phải tên cửa hàng dùng trong sheet Dashboard.
- **Đặt cọc:**
  - form coi DEPOSIT như "loại khác", nên số lượng phải tự gõ dấu âm; gõ không dấu thì bị từ chối vì vàng đi sai chiều;
  - đặt cọc không có tiền thì bị chặn (form và `PAYMENT_SHORT`).
- **Lấy hàng:** bảng bắt PICKUP phải trỏ về phiếu cọc (0013), nhưng form không có chỗ chọn phiếu cọc, nên chọn PICKUP luôn lỗi. Sổ không hiện đơn cọc nào đã lấy, lấy ngày nào.
- **Báo cáo đơn cọc (0045)** hiểu sai dữ liệu thật. Bộ nạp (0063, test `import-gold`) lưu:
  - phiếu cọc: thành tiền 0, tiền cọc là khoản thanh toán;
  - phiếu lấy hàng: thành tiền là **cả giá trị đơn**, khoản thanh toán là phần còn lại.

  Cách ghi sổ (0015) đúng với dữ liệu đó: cọc Nợ tiền / Có 131, lấy hàng Nợ 131 / Có 511 cả giá trị đơn, rồi Nợ tiền / Có 131 phần còn lại, 131 về 0. Báo cáo 0045 lại coi thành tiền phiếu cọc là tiền cọc, và cộng thành tiền phiếu lấy vào "đã trả".

## Đã chốt

1. Tên theo sheet Dashboard; tên tài khoản đổi theo.
2. Đặt cọc được lưu với tiền cọc từ 0 đến đủ giá trị đơn.
3. Lấy hàng bằng nút **Lấy hàng** trên dòng cọc chưa lấy; bỏ PICKUP khỏi ô Loại.

## Thiết kế

### 1. Tên loại vàng (0085)

| Mã | Cũ | Mới |
|---|---|---|
| RP | Rồng Phụng | Rong Phung |
| 9999 | Vàng 9999 | 9999 |
| ML, CS, AE | giữ | Maple Leaf, Credit Suisse, American Eagle |
| OTH | Vàng khác | Other |
| SG | Scrap Gold | Scrap Gold |
| GRAIN | Vàng Grain | Grain |
| PT | Bạch kim | PT |

Tài khoản gắn loại vàng: `632…` → "Giá vốn {tên}", `155…` → "NVL {tên}", `156…` → "Hàng hoá {tên}", `157…` → "Hàng gửi đi {tên}".

### 2. Đặt cọc (0086)

Theo đúng dữ liệu thật:
- **Thành tiền** của phiếu cọc là **giá trị đơn** (số lượng × giá chốt); để trống giá thì là 0.
- **Tiền cọc** là các khoản thanh toán.

Thay đổi:
- Form: DEPOSIT tự đặt dấu như SALE. Phần thanh toán gọi là **Tiền cọc**, không bắt buộc. Dòng báo thiếu thành **"Còn lại X, trả khi lấy hàng."**
- `write_gold_receipt`: bỏ `PAYMENT_SHORT`.
- `post_gold_txn`: phiếu cọc không có khoản tiền nào thì **không tạo bút toán** (trả về null). Kho vẫn tách vàng sang DEPOSIT_HELD bằng trigger như cũ.
- `v_deposit_status`, sửa theo dữ liệu thật:
  - **deposit_amount** = tiền cọc (các khoản thanh toán của phiếu cọc);
  - **order_amount** = thành tiền phiếu cọc nếu > 0, không thì số lượng × giá chốt, không thì thành tiền phiếu lấy;
  - **paid_amount** = tiền cọc + tiền trả lúc lấy + các lần trả sau của phiếu lấy;
  - **remaining_amount** = giá trị đơn − đã trả (không âm); đơn huỷ là 0; chưa biết giá trị đơn thì trống.
- `gold_receipt_owed` của phiếu lấy trừ thêm tiền cọc.

### 3. Lấy hàng (0087)

- `save_gold_pickup(key yêu cầu, khoá phiếu cọc, {pickupDate, orderValue?, payments, remarks})` → `{receiptId, docNo, repeated}`:
  - phiếu PICKUP mới có **số phiếu riêng**, ngày là ngày lấy, `deposit_ref_id` trỏ về phiếu cọc;
  - cùng khách, loại vàng, số lượng, giá chốt, nhân viên và tỷ lệ chia của phiếu cọc;
  - thành tiền = giá trị đơn: thành tiền phiếu cọc nếu > 0, không thì số lượng × giá chốt, không thì `orderValue` gửi lên;
  - các khoản trả là tiền trả lúc lấy; trả thiếu thì phần còn lại thanh toán tiếp như phiếu bán.
- Từ chối:

  | Mã | Khi nào |
  |---|---|
  | `RECEIPT_VOIDED` | phiếu cọc đã huỷ |
  | `PICKUP_NOT_DEPOSIT` | khoá không phải phiếu cọc |
  | `PICKUP_TAKEN: D` | phiếu cọc đã lấy hàng ngày D |
  | `PICKUP_DATE: deposit D` | ngày lấy trước ngày cọc |
  | `PICKUP_NO_PRICE` | không biết giá trị đơn và không gửi `orderValue` |

- `write_gold_transaction` nhận thêm `depositRefId`.
- Ghi sổ lấy hàng giữ như 0015 (doanh thu cả giá trị đơn).
- Huỷ phiếu lấy: như huỷ phiếu (0075, cho phép `DEPOSIT_PICKUP`). Phiếu cọc về lại "Chờ lấy hàng". Phiếu lấy **không sửa trực tiếp**; câu khoá nói: huỷ rồi bấm Lấy hàng lại.

### 4. Sổ (0087)

- `gold_receipt_ledger` thêm cột `deposit`:
  - phiếu cọc: `{role:'deposit', orderValue, paid, pickupDate, pickupDoc}`
  - phiếu lấy: `{role:'pickup', orderValue, paid, depositDate, depositDoc}` (paid = tiền cọc)
- Dòng cọc: thẻ **Chờ lấy hàng**, hoặc **Đã lấy {ngày}** kèm số phiếu lấy; dưới thành tiền là **Còn lại X** khi chưa lấy; nút **Lấy hàng** khi chưa lấy.
- Dòng lấy: thẻ **Cọc {ngày}** kèm số phiếu cọc; dưới thành tiền là **Đã cọc Y**.
- Hộp Lấy hàng: khách, loại vàng, số lượng, giá trị đơn, đã cọc (ngày cọc), còn phải trả; ô Giá trị đơn khi chưa biết; Ngày lấy; các khoản trả (mặc định một khoản bằng số còn phải trả, CASH); Ghi chú.

## Kiểm tra

- SQL:
  - tên mới;
  - cọc có tiền và 0 đồng (bút toán, kho);
  - báo cáo đơn cọc theo dữ liệu nạp và dữ liệu form;
  - lấy hàng đủ tiền và thiếu tiền (doanh thu, 131 về 0, còn nợ, thanh toán tiếp);
  - mọi mã từ chối; khoá yêu cầu;
  - sổ trả `deposit`; huỷ phiếu lấy thì cọc mở lại.
- Thuần: đọc dòng sổ, câu báo lỗi, dấu số lượng của DEPOSIT, màn sổ.
- Trình duyệt: `verify:deposit` (tháng 7/2019, tự dọn); sửa tên vàng trong các `verify:*`.
