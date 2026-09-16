# Rà soát toàn bộ kiểm tra tự động trên Production (16-09)

Buổi sáng viết lại `verify:refining` tìm ra ba lỗi thật của màn Phân kim — những lỗi mà 713 test đơn vị không thấy, vì test chạy bằng quyền chủ database và không ai bấm vào màn hình. Nên buổi chiều chạy nốt **cả 21 script kiểm tra** trên Production, xem còn màn nào đang hỏng mà không ai biết.

## Kết quả

| Nhóm | Số lượng | Chi tiết |
|---|---|---|
| Xanh ngay | 11 | live, rls, signin, layout, loading, ledger, conversion, reports, export, bank-import, screens |
| Xanh sau khi sửa script | 5 | settings, import, reconcile, feedback, payments |
| Đã xanh từ sáng | 4 | refining, void, correct, grid |
| Lỗi thật của ứng dụng | 1 | users — xem dưới |

## Lỗi thật: không thêm được người dùng trên Production

- **Triệu chứng:** bấm Lưu ở màn Người dùng thì không có gì xảy ra. Không báo lỗi, không tạo được ai.
- **Thật ra:** máy chủ trả **HTTP 500**. Tạo tài khoản đăng nhập cần khoá dịch vụ Supabase, mà bản triển khai không có; mã nguồn khi đó **ném lỗi**, và lỗi ném ra trong server action tới trình duyệt chỉ còn là 500 trống — màn hình không có gì để hiện.
- **Đã sửa:** thiếu khoá giờ là một lời từ chối như mọi lời từ chối khác, có câu nói rõ thiếu gì. Sau khi triển khai, màn hình nói: *"this server has no Supabase service credentials, so logins cannot be created or reset here"*.
- **Còn lại, cần anh làm:** thêm biến `SUPABASE_SERVICE_ROLE_KEY` cho môi trường Production trên Vercel rồi triển khai lại. Khoá này bỏ qua toàn bộ kiểm tra quyền của database, nên nó là bí mật của chủ dự án — em không đặt thay được. Trước khi có nó, màn Người dùng chỉ xem được danh sách, không thêm người và không cấp lại mật khẩu được.

## Một cái bẫy đã gỡ: kiểm tra lại xoá dữ liệu thật

`verify:live` ghi giá vàng cho ngày 30 và 31-01-2026 rồi **xoá mọi dòng giá của hai ngày đó**, bất kể loại vàng. Đó là ngày trong sổ thật của khách. Chưa mất gì, vì tháng 1-2026 chưa ai nhập giá, nhưng một kiểm tra "chỉ đọc" lại có câu xoá sẵn sàng cuốn đi một buổi sáng nhập liệu.

Nay phần đó chạy trong transaction rồi hoàn tác, và script có thêm một mục canh gác:

> **không có gì trong sổ được ghi trước ngày sổ bắt đầu** — mọi kiểm tra đều ghi vào các ngày năm 2019 để tự tìm lại và dọn đi, nên còn sót dòng nào ở đó nghĩa là có kiểm tra chưa dọn xong.

Mục này bắt được ngay một vụ thật: lần `verify:refining` bị văng lúc đầu (khi phần dọn còn sai thứ tự) đã để lại lô S26.03, hai phiếu chuyển kho −30 g vàng vụn, hai bút toán và bốn dòng sổ kho trong sổ của khách. Đã dọn sạch. Chính 30 g đó làm lệch số đối chiếu của màn Nạp dữ liệu, và suýt bị đọc nhầm thành lỗi của màn đó.

## Năm script cũ, và vì sao chúng cũ

Không cái nào là lỗi ứng dụng — nhưng mỗi cái đều che mất một màn hình khỏi tầm kiểm tra:

- **settings**: chạy cửa sổ 1280×720, ở bề ngang đó thanh menu trái thu gọn thành icon. Màn hình *có* mời kế toán vào Giá vàng; script đọc menu thu gọn rồi kết luận là không.
- **import** và **reconcile**: bấm vào nút nằm trong tab không hiện. Các màn này dựng sẵn mọi tab, nên nút *có* trong trang mà không nhìn thấy được — chờ mãi tới lúc hết giờ. Nay chuyển tab trước, và chỗ nào chỉ đọc chữ thì chờ theo nội dung chứ không chờ nhìn thấy.
- **feedback**: đọc trang ngay khi địa chỉ vừa đổi, trước lúc trang kịp vẽ.
- **payments**: viết từ thời lưới nhập cũ (bỏ 10-09), điền "Thanh toán 1", "Hình thức 2" — những ô không còn tồn tại. Viết lại theo form: một dòng thanh toán lúc đầu, thêm dòng khi cần, và dòng thứ ba ở đúng chỗ bảng hai cột ngày xưa dừng lại. Giữ nguyên ba điều kế toán từng báo.

## Điều rút ra

Test đơn vị chạy bằng quyền chủ database và không dựng màn hình; script kiểm tra thì chạy như người dùng thật. Hai thứ bắt hai loại lỗi khác nhau, và loại thứ hai là loại khách hàng gặp. Một script kiểm tra đã cũ không chỉ là một script hỏng — nó là một màn hình không còn ai canh.
