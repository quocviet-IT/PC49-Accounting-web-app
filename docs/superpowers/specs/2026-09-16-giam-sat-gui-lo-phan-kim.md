# Giám sát không gửi được lô phân kim — chẩn đoán và cách sửa

Ngày 16-09. Việc bắt đầu từ chỗ khác: viết lại `verify:refining` cho màn Phân kim mới (10-09, `a3f76ac`), vì script cũ vẫn lái phần giao diện đã bỏ. Script mới chạy bằng tài khoản **giám sát (GS_US)** và dừng ngay ở bước "Gửi đi". Đó không phải lỗi của script.

## Lỗi

- Bấm "Gửi đi" thì database từ chối: `new row violates row-level security policy for table "gold_txn"`. Lô nằm nguyên ở trạng thái Nháp.
- **Vì sao:** gửi lô không chỉ đổi trạng thái. Từ 0056, gửi lô nghĩa là vàng rời kho: mỗi túi của nhà ghi một phiếu chuyển kho, phiếu đó lên sổ kho và sổ cái. Các hàm này chạy bằng quyền của người bấm nút, mà:
  - `refining_lot`, `refining_lot_line`, `refining_receipt` cho phép **KT, GS_US, ADMIN** ghi;
  - `gold_txn`, `inventory_movement`, `journal_entry`, `journal_line` chỉ cho **KT, ADMIN**.
- **Hệ quả:** giám sát mở được lô, chọn phiếu, đóng túi — rồi tắc. Màn hình vẫn mời họ bấm một nút mà database chắc chắn từ chối.
- **Vì sao test không bắt được:** toàn bộ test SQL của phân kim chạy bằng quyền chủ database, mà chủ database thì không chính sách nào áp dụng. Test xanh, người dùng thật vẫn tắc.

Đo trên database thật trước khi sửa, bằng cách chạy thử từng bước rồi hoàn tác (không ghi gì):

| Vai trò | Mở lô, đóng túi | Gửi đi | Assay | Nhận về | Đóng lô |
|---|---|---|---|---|---|
| KT (kế toán) | được | được | được | được | được |
| GS_US (giám sát) | được | **bị từ chối** | — | — | — |
| ADMIN | được | được | được | được | được |
| OC (chủ) | không | — | — | — | — |

Các bước sau của GS_US ghi "—" vì lô chưa đi được thì chưa tới lượt.

## Cách sửa: migration 0072 `a_lot_books_its_own_metal`

Phiếu chuyển kho không phải giao dịch do giám sát tự gõ; đó là việc ghi sổ của chính cái lô. Ai được làm cho lô đi tiếp thì quyền của bảng lô đã quyết định rồi (KT, GS_US, ADMIN). Nên hai chỗ vào ghi sổ bằng quyền định sẵn của database:

- `refining_lot_send_legs` — là trigger, nên không ai gọi thẳng được: chỉ chạy khi có người sửa lô mà quyền của bảng lô đã cho phép.
- `receive_refining` — gọi thẳng được, nên tự kiểm tra vai trò người gọi trước khi dùng quyền được cấp.
- Thu hồi quyền gọi `receive_refining` của tất cả, chỉ cấp cho người đã đăng nhập.
- `record_assay` giữ nguyên: nó chỉ đụng lô và túi, giám sát vốn đã ghi được.

Một chỗ suýt sai, test bắt được: trong hàm chạy bằng quyền định sẵn, `current_user` là **chủ hàm** chứ không phải người gọi, nên kiểm tra theo `current_user` sẽ cho mọi người qua. Phải đọc từ phiên đăng nhập và token (`session_user`, `auth.uid()`).

## Test

Thêm bốn test chạy đúng như màn hình chạy, tức là theo vai trò chứ không phải quyền chủ database:

- giám sát gửi được lô, và phiếu chuyển kho được ghi;
- giám sát ghi nhận được vàng về;
- người đã đăng nhập nhưng không có vai trò thì bị từ chối;
- chưa đăng nhập thì không gọi được hàm.

Cả file test phân kim: 67/67 xanh.

Bảng quyền sau khi sửa, đo lại cùng cách:

| Vai trò | Mở lô, đóng túi | Gửi đi | Assay | Nhận về | Đóng lô |
|---|---|---|---|---|---|
| KT (kế toán) | được | được | được | được | được |
| GS_US (giám sát) | được | **được** | được | được | được |
| ADMIN | được | được | được | được | được |
| OC (chủ) | không | — | — | — | — |

## Lỗi thứ hai: không lưu được kết quả assay

Sửa xong quyền, script đi tiếp và tắc ở bước "Nhập kết quả assay": bấm Lưu thì hộp thoại đứng yên, không báo gì. Lần này lỗi không chừa ai — kế toán bấm cũng không lưu được.

- **Bằng chứng:** nội dung gửi lên là `"lineId":"$undefined"` cho từng túi, và màn hình *có* báo "Invalid input: expected string, received undefined" — nhưng ô báo lỗi nằm **sau hộp thoại đang mở**, nên người dùng không đọc được.
- **Vì sao:** bảng assay chỉ dựng ô nhập cho hai số (trọng lượng và tuổi vàng sau assay). Form chỉ giữ những trường nó có dựng ô, nên mã túi rơi mất trên đường gửi đi. Nghĩa là **mọi lần nhập kết quả assay đều hỏng kể từ lúc dựng lại trang lô (10-09)**.
- **Cách sửa:** tách phép dựng dữ liệu gửi đi thành một hàm thuần (`assayLines`), lấy mã túi từ danh sách túi chứ không từ form; ô nào không gõ thì giữ nguyên số lúc gửi, đúng như hộp thoại đang hiện. Có 4 test cho hàm này.
- **Sửa tiếp ngay sau đó:** lời báo lỗi khi lưu hỏng giờ hiện **trong** hộp thoại vừa bấm, không còn nằm sau nó. Cả bốn hộp thoại của màn Phân kim — gửi đi, assay, nhận về, túi — dùng chung một cách lưu: lưu hỏng thì giữ lý do tại chỗ, chỉ khi lưu được mới đóng hộp thoại và nạp lại lô. `verify:refining` thêm một bước tự gây lỗi thật (bấm Gửi khi ngày đó chưa có giá spot) và đòi lý do phải đọc được ngay trong hộp thoại.

## Kèm theo: viết lại `verify:refining`

Script cũ lái màn hình trước 10-09: mở lô bằng tay, gõ mã lô, "Đưa vào đợt", "Chốt đợt thành dòng gửi đi" ngay trên trang danh sách. Những thứ đó không còn. Script mới chạy trọn vòng đời trên trang của lô, bằng tài khoản giám sát:

mở lô → tick phiếu mua vàng vụn → đóng túi theo hạng → thêm túi của đối tác → gửi đi kèm giá spot → nhập kết quả assay → nhận vàng về cho nhà → đối tác lấy tiền → đóng lô.

Vẫn giữ các kiểm tra quy tắc của database: nhận về cho người không có túi trong lô, nhận về trước khi có assay, và nhảy cóc giai đoạn. Dữ liệu thử được dọn sạch ở cuối, kể cả phiếu chuyển kho và bút toán mà lô sinh ra.

## Lỗi thứ ba: đóng lô bị khoá khi đối tác lấy tiền

Script đi tới bước cuối rồi tắc: bấm "Đóng lô" không đóng.

- **Vì sao:** màn hình tính "còn nợ" bằng số gram đã nhận về, mà người lấy tiền thì không có gram nào. Đo trên database: `MH` đã lấy 6.400 USD nhưng bảng chia phần vẫn ghi `received 0` trên `assayed 40`. Vậy đối tác vĩnh viễn hiện là còn nợ, và nút Đóng lô khoá chết — trong khi database đóng lô bình thường, vì từ 0050 "đã thanh toán" nghĩa là **có phiếu nhận, lấy vàng hay lấy tiền đều được**.
- **Cách sửa:** tách quy tắc thành hàm thuần (`settled`): ai đã lấy tiền thì hết nợ, còn lại vẫn tính theo gram. Trang lô dùng hàm này cho cả cột "Còn nợ" lẫn nút Đóng lô. Có 7 test.

## Kết quả

- `verify:refining` chạy trọn vòng đời bằng tài khoản giám sát trên bản build production: **25/25 xanh**, dọn sạch dữ liệu thử (0 lô, 0 giao dịch, 0 khách mới). Bản đẩy lên lần đầu (`4d0b70c`) đạt 24/24 trên Production; mục thứ 25 là bước kiểm tra lời báo lỗi hiện trong hộp thoại, thêm sau đó.
- Ba lỗi tìm được trong cùng một lần viết lại script, đều là thứ người dùng gặp mà test cũ không thấy, vì test cũ chạy bằng quyền chủ database và không bấm vào màn hình:
  1. giám sát không gửi được lô — migration 0072;
  2. không ai lưu được kết quả assay — `assayLines`;
  3. đóng lô bị khoá khi một chủ sở hữu lấy tiền — `settled`.
- Test tự động thêm trong đợt này: 4 test SQL theo vai trò, 4 test cho `assayLines`, 7 test cho `settled`.
