# Góp ý: chấm đỏ khi có thay đổi — thiết kế

Ngày 18-09. Nguồn: vấn đề đã chốt khi bàn về nâng cấp góp ý — **"Người báo không biết gì tiếp theo"**.

## Vấn đề

Màn Báo lỗi đã có đủ thứ người báo cần: góp ý của họ, trạng thái, ghi chú của quản trị (0036). Nhưng không có gì **gọi họ quay lại**. Gửi xong là im lặng; quản trị chuyển trạng thái và viết ghi chú, người báo không biết, trừ khi tự mở màn đó ra xem.

Quản trị cũng vậy: không biết có góp ý mới nếu không mở màn.

## Đã chốt

1. Báo bằng **chấm đỏ trên menu**, không gửi email.
2. **Quản trị** thấy số góp ý đang ở trạng thái **Mới**.
3. **Mở màn Báo lỗi là coi như đã xem**.

## Thiết kế

### 1. Ai đã xem đến đâu (0088)

Bảng `pc49.feedback_seen(user_id, seen_at)`: mỗi người một dòng, ghi lần cuối họ mở màn Báo lỗi. Ai cũng chỉ đọc và ghi dòng của mình.

Ba hàm:

- `feedback_seen_at()` — lần xem cuối của người đang đăng nhập; chưa xem bao giờ thì là `-infinity`.
- `feedback_unseen()` — số cần chú ý:
  - **quản trị:** số góp ý đang ở trạng thái `NEW`;
  - **người khác:** số góp ý **của chính họ** có `triaged_at` sau lần xem cuối.
- `mark_feedback_seen()` — ghi `seen_at = bây giờ`, trả về mốc đó.

Hàng rào RLS của `feedback_report` (0036) không đổi: người báo chỉ thấy góp ý của mình, quản trị thấy cả hàng đợi. Nên hai con số trên tự đúng theo quyền mà không cần điều kiện riêng.

### 2. Chấm đỏ trên menu

- Layout đọc `feedback_unseen()` một lần cho mỗi màn và đưa vào thanh menu.
- Mục **Báo lỗi** hiện **số đỏ** bên cạnh chữ, và một **chấm đỏ trên biểu tượng** để menu thu gọn vẫn thấy. Bằng 0 thì không vẽ gì.
- Con số cũng là nhãn cho người đọc màn hình: "3 mục cần xem".

### 3. Mở màn là đã xem

- Màn Báo lỗi đọc `feedback_seen_at()` **trước**, rồi mới ghi nhận đã xem, nên chính lần mở đó vẫn thấy cái gì vừa đổi.
- Góp ý của mình có `triaged_at` sau mốc đó mang thẻ **"Mới cập nhật"**.
- Ghi nhận đã xem chạy một lần mỗi lần mở màn, rồi làm mới trang để chấm đỏ tắt ngay.

## Kiểm tra

- **SQL:** người báo đếm đúng phần của mình; quản trị đếm số `NEW`; ghi nhận đã xem đưa số về 0; một người không đọc hay ghi được dòng `feedback_seen` của người khác.
- **Thuần:** chấm đỏ vẽ khi số lớn hơn 0, không vẽ gì khi bằng 0.
- **Trình duyệt:** mở rộng `verify:feedback` — quản trị thấy số đỏ khi có góp ý mới; sau khi quản trị chuyển trạng thái, kế toán thấy số đỏ, mở màn thì thấy thẻ "Mới cập nhật" và số đỏ tắt.
