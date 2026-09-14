# Tốc độ tải và trạng thái đang tải — thiết kế

Phần 1 trong ba phần nâng cấp do anh Việt yêu cầu ngày 14-09. Thứ tự đã chốt: (1) tốc độ và loading, (2) sổ giao dịch vàng hiển thị đầy đủ và lọc theo khoảng ngày, (3) giao diện chuẩn app kế toán. Mỗi phần có thiết kế, kế hoạch và lần đẩy lên riêng.

## Vì sao chậm — đo trên Production ngày 14-09

Đo bằng trình duyệt thật, tài khoản admin, lượt tải thứ hai:

| Màn hình | Máy chủ trả byte đầu | Trang dựng xong (HTML) | Tới lúc im mạng |
|---|---|---|---|
| Tổng quan | 91 ms | 2.272 ms | 5.910 ms |
| Giao dịch vàng | 91 ms | 1.992 ms | 4.762 ms |
| Giá vàng | 93 ms | 2.203 ms | 4.915 ms |
| Tồn kho | 92 ms | 2.428 ms | 4.881 ms |
| Dòng tiền | 92 ms | 1.580 ms | 3.638 ms |
| Sổ nhật ký | 93 ms | 1.832 ms | 3.601 ms |
| Báo cáo | 91 ms | 1.451 ms | 3.416 ms |
| Phân kim | 92 ms | 2.336 ms | 4.984 ms |
| Nạp dữ liệu | 91 ms | 2.157 ms | 4.632 ms |
| Danh mục | 91 ms | 1.710 ms | 3.326 ms |

Đăng nhập tới trang chủ: 11.314 ms. JavaScript mỗi trang: 451–535 KB.

Hai nguyên nhân chính:

1. **Code chạy ở Mỹ, database ở Singapore.** Header `x-vercel-id: hkg1::iad1::…` — trang được dựng ở Washington (iad1); database là `aws-0-ap-southeast-1` (Singapore). Không có `vercel.json` hay cấu hình vùng nào, nên Vercel dùng vùng mặc định. Mỗi lượt gọi database hay Supabase Auth đi vòng Mỹ–Singapore, khoảng 0,2 giây một chiều về.
2. **Mỗi trang gọi nối tiếp nhiều lượt.** `proxy.ts` gọi `auth.getUser()`; layout gọi `getCurrentUser()` (một lượt `auth.getUser()` và một lượt đọc `app_user`); trang gọi `getCurrentUser()` lần nữa (thêm hai lượt); rồi mới tới dữ liệu của trang. Ít nhất sáu lượt nối tiếp.

Thêm vào đó, không màn hình nào có `loading.tsx`. Bấm menu thì màn hình đứng yên tới khi trang mới dựng xong — hai giây không có phản hồi nào, nhìn như treo.

## Thiết kế

### 1. Chạy code cạnh database

- Thêm `vercel.json` ở gốc repo: `{ "regions": ["sin1"] }`.
- Sau khi deploy, `x-vercel-id` phải có `::sin1::` ở vị trí vùng chạy code.
- Không đổi database, không đổi câu truy vấn. Quay lui: xoá `vercel.json` và đẩy lên.

### 2. Bớt lượt gọi mạng khi xác thực

Supabase của dự án ký phiên bằng khoá bất đối xứng (JWKS công khai có một khoá ES256), nên máy chủ tự xác minh phiên được mà không hỏi Supabase Auth — đúng cách `@supabase/ssr` hướng dẫn cho middleware.

- `src/lib/supabase/session.ts` (dùng trong `proxy.ts`): `auth.getUser()` đổi thành `auth.getClaims()`. Proxy chỉ cần biết có phiên hợp lệ hay không; phiên hết hạn vẫn được làm mới như trước.
- `src/lib/auth/currentUser.ts`:
  - lấy danh tính từ `auth.getClaims()` (`sub` là id, `email` là email) thay cho `auth.getUser()`;
  - bọc bằng `cache()` của React, để layout và trang trong cùng một lượt tải dùng chung một lần đọc;
  - vẫn đọc `app_user` mỗi lượt tải. Tài khoản bị khoá hay đang bắt đổi mật khẩu bị chặn ngay; đọc lỗi thì trả về không có người dùng — "hỏng thì đóng cửa" như cũ.
- Không đổi:
  - Các thao tác ghi đang gọi `auth.getUser()` (đổi mật khẩu, báo lỗi, cấu hình, đối chiếu tiền, quy đổi ngân hàng) giữ nguyên.
  - Nhánh layout phân biệt "chưa đăng nhập" với "tài khoản đã đóng" (`auth.getUser()` khi không có người dùng) giữ nguyên — chỉ chạy khi bị từ chối, không nằm trên đường tải bình thường.

Đánh đổi: phiên bị thu hồi từ nơi khác (đăng xuất mọi thiết bị) còn mở được trang cho tới khi token hết hạn, mặc định một giờ. Database đã tin token theo đúng cách đó — RLS đọc `auth.uid()` từ token — nên thay đổi này không mở chỗ hở nào mà database chưa có.

### 3. Bấm là có phản hồi

- `src/app/(app)/loading.tsx` hiển thị `PageSkeleton`: khung tiêu đề, một dải ô số liệu và một bảng tám dòng xám nhấp nháy, cùng bề rộng và lề với trang thật để không nhảy bố cục khi trang thật hiện ra. Có `aria-busy` và một dòng "Đang tải…" chỉ dành cho trình đọc màn hình. Menu bên trái và thanh trên vẫn bấm được trong lúc chờ.
- Mục menu vừa bấm có một dấu nhỏ nhấp nháy bên phải tên (`useLinkStatus`, trong một component nằm bên trong `<Link>` của `AppShell`). Dấu luôn chiếm chỗ cố định và chỉ đổi độ mờ, nên không xô chữ.
- Không làm: thanh tiến trình chạy ngang đầu trang. `loading.tsx` đã cho phản hồi ngay ở chính chỗ nội dung sẽ hiện.

## Kiểm chứng và tiêu chí đạt

Đo lại trên Production sau khi deploy, bằng đúng cách đã đo ở bảng trên. Script đo đưa vào repo thành `scripts/probe-speed.mjs`, để lần đo sau và lần đo trước là một:

- Trang dựng xong (HTML) ≤ 800 ms ở cả mười màn hình trong bảng trên.
- Đăng nhập tới trang chủ ≤ 4 giây.
- Bấm một mục menu: khung chờ hoặc trang đích hiện trong ≤ 200 ms.
- `x-vercel-id` có `::sin1::`.

Test và kiểm tra:

- Unit test cho `getCurrentUser`: lấy danh tính từ claims và không gọi `auth.getUser()`; không có claims thì trả về không có người dùng; tài khoản bị khoá, hay không đọc được `app_user`, cũng trả về không có người dùng.
- Toàn bộ test, typecheck, lint, `next build`.
- Trên trình duyệt:
  - `verify:signin` — bốn vai trò đăng nhập, đúng menu;
  - `verify:screens` — quyền từng màn hình;
  - `verify:layout` — mười bảy màn hình, năm bề rộng;
  - `verify:grid` — form nhập giao dịch;
  - thêm một bước: bấm menu thì khung chờ hoặc trang đích hiện trong 200 ms.

## Không thuộc phần này

- Cache danh mục (loại vàng, sales, khách) và giảm JavaScript của antd — để sau, nếu sau phần này vẫn thấy chậm.
- Mọi thay đổi về giao diện, màu nút, icon — phần 3.
- Sổ giao dịch vàng lọc theo khoảng ngày — phần 2.
