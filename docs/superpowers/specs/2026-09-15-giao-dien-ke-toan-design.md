# Giao diện chuẩn app kế toán — thiết kế

Phần 3 trong ba phần nâng cấp do anh Việt yêu cầu ngày 14-09: nút bấm màu sắc phù hợp và nổi bật, cái nào thay được bằng icon thì thay, app chuyên nghiệp như app kế toán. Bố cục các màn hình giữ nguyên.

## Hiện trạng (15-09)

- Hai hệ nút song song:
  - nút antd, màu chính xanh ngọc `#0F766E`;
  - khoảng 40 nút `<button>` tự viết CSS trong module của từng màn hình (`.quiet`, `.button`, `.primary`, `.retry`), mỗi nơi một kiểu.
- Nhiều nút chỉ có chữ, nhạt màu. Nút "Sửa / Huỷ" trong sổ giao dịch bị đẩy khuất ra mép phải ở 1440px.
- Nhãn loại giao dịch (PO, SALE, TRANSFER…) cùng một màu xám.

## Đã chốt với anh Việt (15-09)

- Màu chủ đạo: **xanh dương kế toán `#1D4ED8`**.
- Menu trái: **giữ nền tối**, mục đang mở tô xanh dương.
- Phương án: **một hệ nút và màu dùng chung**, không làm lại bố cục.

## Thiết kế

### Màu

- `src/lib/design/tokens.ts` là nơi duy nhất đổi màu:
  - chủ đề sáng: `primary` và `primarySolid` `#1D4ED8`;
  - chủ đề tối: `primary` `#60A5FA`, `primarySolid` `#2563EB`;
  - accent: wash `#EFF6FF`, tint `#DBEAFE`, ring `#93C5FD`, strong `#1E40AF`, onDark `#93C5FD`;
  - `siderActive` `#1E3A8A`;
  - màu tiền (xanh lá vào, đỏ ra, vàng cần quyết định) giữ nguyên.
- Khối biến CSS trong `globals.css` sinh lại từ `cssVariableBlock()`. Test `design-tokens` đã chặn mã màu viết tay ngoài khối.

### Nút

- Mọi nút là `Button` của antd; bỏ các lớp `.quiet`, `.button`, `.primary`, `.retry` và thẻ `<button>` tự vẽ. Riêng thẻ chọn trong danh sách ở màn Quy đổi (`styles.item`) không phải nút hành động, giữ nguyên.
- Bốn kiểu:
  - **chính** `type="primary"`, icon + chữ: Thêm giao dịch, Lưu, Ghi vào sổ, Thêm người;
  - **phụ** mặc định, icon + chữ: Xuất Excel, Xem, Làm mới, Huỷ bỏ, Đóng;
  - **nguy hiểm** `danger`: Huỷ giao dịch, Khoá kỳ, Tạm khoá người dùng;
  - **chỉ icon** `IconAction`: có tooltip và `aria-label`, cho thao tác trong bảng.
- Nút trong dialog và nút hành động chính của trang giữ icon + chữ.
- Form lọc kiểu GET (Xem, Áp dụng) dùng `Button htmlType="submit"` có icon tìm kiếm.

### Icon (lucide)

| Hành động | Icon | Hành động | Icon |
|---|---|---|---|
| Thêm | `Plus` | Sửa | `Pencil` |
| Huỷ giao dịch | `Ban` | Xoá | `Trash2` |
| Xuất | `Download` | Nạp, tải lên | `Upload` |
| Làm mới, thử lại | `RefreshCw` | Xem, áp dụng | `Search` |
| Lưu | `Check` | Đóng, huỷ bỏ | `X` |
| Khoá kỳ | `Lock` | Mở lại | `LockOpen` |
| Thêm người | `UserPlus` | Gửi | `Send` |
| Đối chiếu | `Scale` | Gợi ý | `Sparkles` |
| Thêm dòng | `ListPlus` | | |

### Bảng và nhãn

- Cột Thao tác của sổ giao dịch dùng `IconAction` và ghim bên phải (`fixed: 'right'`).
- `TxnTypeTag` tô màu theo nhóm, dùng ở mọi chỗ hiện loại giao dịch:

| Nhóm | Loại | Màu |
|---|---|---|
| Mua | PO, PO_VENDOR | xanh dương |
| Bán | SALE, PICKUP | xanh lá |
| Cọc | DEPOSIT, CANCEL | vàng |
| Chuyển đổi | TRANSFER_IN, TRANSFER_OUT, RA_RP, ON_THE_WAY | tím |
| Ghi nhớ | MEMO | xám |

### Tổng quan

Bốn lối tắt thành thẻ có icon màu chính, xếp lưới co giãn:

| Lối tắt | Icon |
|---|---|
| Nhập giao dịch | `ArrowLeftRight` |
| Cập nhật giá | `CircleDollarSign` |
| Nhập sao kê | `Upload` |
| Xem báo cáo | `ChartNoAxesCombined` |

## Kiểm chứng

- Unit test:
  - `IconAction`: có `aria-label`, có tooltip, không có chữ hiện;
  - `TxnTypeTag`: mỗi loại đúng nhóm màu;
  - `design-tokens`, `data-states`, `txn-ledger-screen` vẫn xanh.
- `verify:layout` thêm quy tắc: trong `main`, nút không có chữ phải có tên đọc được, thiếu là báo lỗi. Đạt 85/85.
- Các script bấm nút theo tên vẫn đạt: `verify:grid`, `verify:ledger`, `verify:void`, `verify:correct`, `verify:users`, `verify:screens`.
- Ảnh chụp trước/sau ở chủ đề sáng và tối.
