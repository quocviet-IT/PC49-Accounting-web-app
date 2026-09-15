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

## Kết quả (15-09)

### Đã làm

- Commit theo từng phần:
  - `a52162b` màu xanh dương;
  - `2387592` `IconAction`, `TxnTypeTag`;
  - `08a6848` sổ giao dịch vàng, form nhập, tồn kho, tổng quan;
  - `04c2e48` tiền & ngân hàng, nạp dữ liệu, giá, báo cáo, quy đổi, thông báo lỗi tải;
  - `11a499a` người dùng, kỳ kế toán, đổi mật khẩu, báo lỗi, phân kim, nút đổi ngôn ngữ;
  - `ded8544` sửa cho đúng bảng icon (`Sparkles`, `ListPlus`) và Khoá kỳ màu đỏ;
  - `fe59365` quy tắc nút phải có tên trong `verify-layout`.
- Thẻ `<button>` tự vẽ còn đúng một chỗ: dòng chọn giao dịch ở màn Quy đổi, vì đó là dòng chọn chứ không phải nút hành động.
- Ba chỗ vẫn là phần tử khác nhưng vẽ cùng cỡ với nút antd (cao 32px, bo 8px, viền và hover như nút mặc định):
  - hai nhãn chọn file (Nhập sao kê, Chọn file) là `label` bọc ô file, thêm icon `Upload`;
  - "Về trung tâm báo cáo" và "Danh sách lô" giữ là `Link` của Next để chuyển trang không tải lại, thêm icon `ArrowLeft`.
- Ô nhập đứng cạnh nút được đo trên trình duyệt để cùng chiều cao: 32px ở các thanh lọc và form, 24px ở dòng đối chiếu trong bảng.
- `AppShell` và `ThemeToggle` vốn đã là nút antd có icon và tên nên không đổi.
- Icon dùng thêm ngoài bảng thiết kế: `KeyRound` (đặt lại, đổi mật khẩu), `Copy` / `ClipboardCheck`, `PencilLine` (khai con số bảng tính), `BookCheck` (ghi vào sổ), `ListChecks` (ghi phần nhận được), `Undo2` (rút đợt nạp), `History` (lấy giá hôm trước), `Play` (chạy báo cáo), `FolderOpen` (mở lô), `PackageCheck` (ghi nhận về), `Package` (đóng túi), `Minus` (bỏ khỏi lô), `FlaskConical` (kết quả assay), `Languages` (đổi ngôn ngữ).
- Script và test sửa theo nút mới:
  - `data-states`: tìm nút Đối chiếu theo nhãn thay vì theo markup, vì antd bọc chữ trong `span`;
  - `verify-users`: bấm Khoá theo tên, vì nút giờ chỉ có icon;
  - `verify-layout`: thêm quy tắc nút phải có tên. Quy tắc xét mọi nút trên trang, kể cả thanh đầu trang, không chỉ trong `main`.

### Kiểm chứng

- Unit test 690/690, `tsc` 0 lỗi, lint 0 lỗi, `next build` đạt. Lần build cuối tạo đủ 23/23 trang; ba trang phải thử lại vì quá 60 giây khi máy đang chạy kiểm tra khác, lần thử lại đều qua.
- Kiểm tra giao diện trên trình duyệt, không ghi dữ liệu, đạt 12/12:
  - sổ giao dịch: 50 dòng đều có Sửa và Huỷ tìm được theo tên, chỉ có icon, cột thao tác ghim phải, rê chuột hiện tên;
  - nhãn loại có màu (xanh dương, xanh lá, tím, xám);
  - bấm Sửa mở form rồi đóng không lưu, bấm Huỷ hiện câu hỏi có nhãn loại màu rồi thoát không huỷ;
  - tổng quan có 4 thẻ lối tắt có icon;
  - form thêm người: ô nhập và nút cùng cao 32px.
- `verify:screens` đạt.
- `verify:ledger` đạt: 1062 trên màn hình bằng 1062 trong database; tháng 1 có 210 dòng, mua vào 906304.00 khớp; CSV đủ 210 dòng; nút "Tháng này" đúng.
- `verify:layout`: đạt 85/85 (17 màn hình × 5 độ rộng: 1440, 1366, 1280, 1024, 390), đã có quy tắc nút phải có tên. Quy tắc được thử bằng cách chèn một nút chỉ có icon vào trang: bị báo đúng; bỏ nút đó đi thì hết báo.
- `verify:grid`: đạt 22/22 (form nhập: mở đúng ngày, mặc định CASH, báo thiếu, lưu đúng sổ, báo lỗi tiếng Việt, hỏi trước khi bỏ), và tự xoá dòng đã ghi.
- `verify:users`: đạt 12/12 (thêm người bằng nút mới, mật khẩu tạm hiện một lần, người mới bị buộc đổi mật khẩu, bấm Khoá dạng icon theo tên, lý do được lưu, tài khoản đã khoá không vào được) và tự xoá tài khoản thử. Lần chạy đầu, ngay sau build, hết giờ ở bước mở trang đăng nhập vì máy đang bận; chạy lại khi máy rảnh thì đạt.
- `verify:void` và `verify:correct` không chạy. Hai script này vẫn gõ vào lưới nhập cũ, đã bỏ từ 10-09 khi nhập chuyển sang form (`eabfb54`), nên không thể đạt dù giao diện đúng. Nút Sửa và Huỷ mới được kiểm bằng lượt kiểm tra giao diện ở trên. Hai script cần viết lại theo form.
- Ảnh chụp 4 màn hình (tổng quan, sổ giao dịch, đối chiếu tiền, người dùng) ở chủ đề sáng và tối: "trước" chụp trên Production khi chưa đẩy, "sau" chụp trên dev. Ảnh không commit vì có tên khách và số tiền.
