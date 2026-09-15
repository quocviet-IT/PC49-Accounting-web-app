# CSS tĩnh cho Ant Design

Đợt tăng tốc sổ giao dịch (15-09) đo được: antd tốn khoảng 105 ms mỗi yêu cầu chỉ để sinh CSS cho các component của trang (máy dev, React bản production), và mỗi trang nhúng khoảng 370 KB CSS. Anh Việt đồng ý làm tiếp đợt này cho toàn app (15-09).

## antd 6 hỗ trợ gì

- `theme.zeroRuntime: true`: component không sinh CSS lúc render nữa, cần có sẵn một stylesheet.
- Biến màu gốc và một phần biến component vẫn được sinh lúc chạy, nên màu xanh kế toán và nền tối vẫn chạy bằng biến như cũ.

## Đã thử và bỏ: dùng `antd/dist/antd.css`

- **Biến của từng component nằm sai chỗ.** Biến của bảng, ô chọn, menu nền tối nằm dưới class riêng của file đó (`.css-var-_R_0_`) và mang theme mặc định. Không phần tử nào của app mang class đó, còn lúc chạy antd lại không sinh các biến này. Kết quả: 550 ô trong sổ giao dịch mất phần đệm (8px về 0), ô chọn mất nền trắng, menu con đổi màu chữ.
- **Luật link không phải "thừa".** Lúc chạy, antd sinh `:where(.css-…) a{…}`, áp cho mọi link trong app. Bỏ đi thì chữ trên menu trái bị gạch chân và logo về màu link mặc định.
- **Thứ tự CSS bị đảo.** Khi antd tự sinh CSS, thẻ `<style>` của nó đứng sau các file CSS của app, nên chỗ nào độ ưu tiên bằng nhau thì antd thắng. Nạp file tĩnh trước `globals.css` làm app thắng: đệm tiêu đề từ 50px thành 16px, nhãn đăng nhập từ 14px thành 11px.

## Cách làm

- **`scripts/antd-css.mjs` (`npm run antd:css`):**
  - dùng công cụ chính thức `@ant-design/static-style-extract` để sinh CSS mọi component với đúng theme của app, cho nền sáng và nền tối;
  - hai nền chỉ khác nhau ở khối biến (gắn với `pc-light`/`pc-dark`), luật component giống hệt, nên gộp làm một file;
  - bỏ các khối biến của phạm vi nội bộ mà công cụ tự tạo;
  - ghi vào `public/antd/antd-<phiên bản>-<mã băm>.css`: 1010 KB, còn 114 KB khi nén gzip và 76 KB khi nén brotli. Trình duyệt tải một lần rồi giữ lại.
- **`src/lib/design/antdTheme.ts`:** cấu hình theme dùng chung cho `providers.tsx` và script, để hai bên không lệch nhau.
- **`hashed: false`:** file CSS sinh một lần, phải khớp cả dev (class `css-dev-only-…`) lẫn production (class `css-…`). Bỏ mã băm thì selector là `.ant-btn` trần, độ ưu tiên không đổi.
- **`layout.tsx`:** `<link rel="stylesheet" precedence="antd">` đứng sau mọi file CSS của app (Next gắn precedence `next`), đúng chỗ thẻ `<style>` của antd từng đứng. Chỗ nào độ ưu tiên bằng nhau thì antd vẫn thắng như trước.
- **`proxy.ts`:** không chạy cho `/antd/`. Trước khi sửa, file CSS bị chuyển hướng về `/login` lúc chưa đăng nhập, và bước chuyển hướng bị cache như chính file CSS.
- **`next.config.ts`:** cache `/antd/` một năm; tên file có mã băm nên đổi nội dung là đổi tên.
- **Test `tests/lib/antd-stylesheet.test.ts`:**
  - sinh lại CSS trong bộ nhớ rồi so tên file, để nâng cấp antd, đổi token hay đổi theme mà quên sinh lại thì test đỏ;
  - kiểm tra file trên đĩa khớp mã băm trong tên.

## Lưu ý khi kiểm tra

- Ở `next dev`, mỗi file CSS có một nhóm precedence riêng, nên thẻ antd có thể đứng trước CSS của một trang (ví dụ nhãn đăng nhập ra 11px). Bản build production thì đúng thứ tự.
- Vì vậy phép so sánh cuối cùng làm trên bản build production, không làm trên dev.

## Kiểm chứng

So Production hiện tại (antd sinh CSS lúc chạy) với bản build mới chạy ở máy, trên cùng database. 47 màn hình ở cả hai nền, gồm các lớp nổi: danh sách chọn, form nhập, hộp huỷ, menu tài khoản, tooltip, hộp báo lỗi, menu trượt trên điện thoại. Mỗi màn hình so từng thuộc tính đã tính của mọi phần tử và so ảnh từng điểm ảnh.

- **Phần tử antd:** 18/47 màn hình khớp hoàn toàn. Các màn còn lại chỉ lệch ở màu chữ và viền của thẻ `ul` menu con trong thanh bên, 0,00% điểm ảnh.
  - Trên Production thẻ con này không mang class băm nên thừa hưởng màu của menu cha; bản mới tắt băm nên luật `.ant-menu { color }` áp luôn vào nó.
  - Chữ trong mục menu tự đặt màu riêng, nên không thấy khác.
  - Ngoài ra chỉ có khác biệt do thời điểm chụp: hiệu ứng gợn sóng khi bấm đang mờ dần, một tooltip đang tắt, hộp báo lỗi chưa tải xong ảnh xem trước.
- **Phần tử của app:** 40/47 khớp hoàn toàn. Các màn còn lại:
  - lệch 0,07–0,35% điểm ảnh, không lệch thuộc tính nào: bóng mép cột ghim của bảng hiện muộn hơn một nhịp, menu trượt trên điện thoại đang chạy hiệu ứng;
  - nhãn trang đăng nhập: lượt chụp mốc ghi 11px, nhưng kiểm tra trực tiếp Production là 14px, giống bản mới. Luật riêng của trang và luật của antd cùng độ ưu tiên, antd đứng sau nên thắng ở cả hai bản; lượt chụp mốc đã đọc quá sớm.
- **CSS nhúng trong trang Giao dịch vàng** giảm từ khoảng 470 KB xuống 50 KB (phần còn lại là biến màu antd vẫn sinh lúc chạy).

## Kết quả tốc độ

Sau khi đẩy `2ec6e7f` lên Production:

- **Dung lượng trang Giao dịch vàng (50 dòng):** HTML từ 612 KB xuống 265 KB, dữ liệu truyền đi từ 63 KB xuống 27 KB, CSS nhúng từ khoảng 470 KB xuống 50 KB. File CSS antd truyền 122 KB ở lần tải đầu rồi được trình duyệt giữ lại.
- **`probe:speed`** (cột "built", ngưỡng 800 ms; đăng nhập ngưỡng 4000 ms):

| Lượt | Giao dịch vàng | Theo ngày | Trang chậm nhất còn lại | Đăng nhập | Kết quả |
|---|---|---|---|---|---|
| 1, ngay sau khi triển khai | 831 ms | 645 ms | 693 ms (tiền) | 3833 ms | chưa đạt (sổ) |
| 2 | 826 ms | 1290 ms | 588 ms (nạp dữ liệu) | 12215 ms | chưa đạt |
| 3 | 681 ms | 453 ms | 495 ms (phân kim) | 11857 ms | chưa đạt (đăng nhập) |
| 4 | 582 ms | 517 ms | 577 ms (tồn kho) | 3223 ms | **đạt** |

- **Sáu vòng xen kẽ:**
  - sau lượt 2: Giao dịch vàng trung vị 751 ms, theo ngày 559 ms, Tồn kho 518 ms;
  - sau lượt 3: Giao dịch vàng 656 ms, theo ngày 497 ms, Tồn kho 371 ms.
  - Trước đợt này (sau đợt tăng tốc sổ): Giao dịch vàng trung vị 843 và 789 ms, theo ngày 689 và 591 ms, Tồn kho 630 và 523 ms.
- **Đăng nhập 12 giây ở lượt 2 và 3** khớp với kịch bản script bấm lại sau 8 giây. Để loại trừ việc trang đăng nhập nạp chậm hơn vì CSS mới, đo riêng trên Production:
  - ba lượt, React gắn xong nút đăng nhập ở 959–1669 ms, luôn trước lúc mạng rảnh (1351–1722 ms);
  - ba lượt bấm ngay khi mạng rảnh đều vào ngay, tới trang chủ sau 1,1–1,9 giây.
  - Lượt 4 đăng nhập 3223 ms. Hai lần 12 giây là nhiễu lúc đó, không phải do CSS mới.
- **Kết luận:** trang nhẹ hơn khoảng 57%, và Giao dịch vàng giảm từ trung vị khoảng 790–840 ms xuống 650–750 ms. Mạng vẫn dao động nên có lượt đo đơn lẻ vượt ngưỡng, nhưng lượt đo ổn định nhất đạt mọi ngưỡng.
- **Kiểm tra trên Production:** giao diện 12/12, `verify:screens` đạt. So 47 màn hình với mốc chụp trước khi đẩy cho kết quả như lần so bản build ở máy: chỉ khác màu thừa hưởng của thẻ `ul` menu con và các chỗ do thời điểm chụp.
