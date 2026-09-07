# Quản lý người dùng — thiết kế

Ngày 05-09-2026. Dự án A trong bốn dự án đưa hệ thống lên mức dùng thật.

## Vì sao làm cái này trước

Quyền `user.manage` đã tồn tại trong mã nguồn từ đầu và **không màn hình nào dùng nó**.
Nghĩa là hôm nay, thêm một nhân viên, đổi vai trò, hay khoá tài khoản người nghỉ việc
đều phải sửa tay trong cơ sở dữ liệu. Đó vừa là rào cản vận hành, vừa là rủi ro: người
sửa tay không để lại dấu vết nào, và không ai kiểm tra được ai đã cho ai quyền gì.

Chừng nào chưa có nó thì hệ thống vẫn chỉ phục vụ được một người, nên ba dự án còn lại
(chốt đúng một kỳ, bỏ hẳn bảng tính, hoàn thiện giao diện) đều xây trên nền hẹp.

## Phạm vi

Bốn vai trò cứng hiện có — `KT`, `GS_US`, `OC`, `ADMIN` — là đủ. Không làm phân quyền
theo từng đầu việc: nó linh hoạt hơn nhưng dễ cấu hình sai thành lỗ hổng, và với một
đội nhỏ thì cái giá đó không đáng.

Ngoài phạm vi: mời qua email, đăng nhập một lần (SSO), tự đăng ký, và xử lý bốn tài
khoản test đang nằm trên hệ thống thật (xem phần cuối).

## Kiến trúc: quy tắc nằm trong cơ sở dữ liệu

Cả hệ thống này theo một nếp, và nó được viết ra nhiều lần trong chính các migration:

> *"that is a unique constraint rather than a rule in a screen, because the screen is
> not the only way in."* — `0052_a_lot_is_made_of_purchases.sql`

Giới hạn hai lần thanh toán mà kế toán báo lỗi là ví dụ sống: nó nằm trong bảng, nên
gỡ ở màn hình thôi là vô nghĩa. Quy tắc về quyền hạn càng phải nằm chỗ đó — một quy
tắc chỉ tồn tại trong TypeScript là quy tắc ai đi đường khác cũng lách được.

Ranh giới không phải chia đôi tuỳ tiện. Nó là: **cái gì SQL làm được thì để SQL; chỉ
việc tạo tài khoản đăng nhập và đổi mật khẩu mới phải nhờ Supabase Auth**, vì Supabase
giữ chúng ở ngoài cơ sở dữ liệu và không có cách nào chạm tới từ SQL.

## Dữ liệu

Thêm đúng một cột:

```sql
ALTER TABLE pc49.app_user
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
```

Không thêm bảng nào. Email **không** nhân bản sang `app_user`: nó sống ở `auth.users`
và ở nguyên đó. Nhân bản là mở đường cho hai chỗ nói khác nhau về cùng một người.

Màn hình đọc danh sách qua một hàm:

```sql
pc49.user_directory()
  RETURNS TABLE (id, email, full_name, role, is_active, suspended_at,
                 must_change_password, created_at)
```

`SECURITY DEFINER`, tự từ chối nếu người gọi không phải ADMIN. Đây là chỗ duy nhất
`auth.users` bị đọc tới, và nó chỉ trả về email — không trả mật khẩu băm, không trả
token.

## Quy tắc — bốn hàm trong Postgres

Đều `SECURITY DEFINER`, đều tự kiểm tra `pc49.effective_role() = 'ADMIN'`, đều ghi
`pc49.audit_log`:

| Hàm | Việc |
|---|---|
| `set_user_role(p_id, p_role)` | Đổi vai trò |
| `suspend_user(p_id, p_reason)` | Khoá, kèm lý do |
| `restore_user(p_id)` | Mở khoá |
| `rename_user(p_id, p_full_name)` | Sửa tên hiển thị |

Ba chốt chặn, nằm trong hàm chứ không nằm ở màn hình:

1. **Không tự đổi vai trò hay tự khoá mình.** Người ta bấm nhầm, và tự khoá mình là
   thứ không tự sửa được — phải nhờ người khác, mà có khi không còn ai.
2. **Không hạ cấp hay khoá ADMIN cuối cùng còn hoạt động.** Kiểm bằng cách đếm số
   ADMIN chưa bị khoá sau thay đổi; bằng không thì từ chối. Không có chốt này thì có
   ngày cả hệ thống không còn ai quản trị được, và không có đường nào tự cứu.
3. **Khoá phải kèm lý do**, đúng nếp "không xoá cứng, huỷ kèm lý do" của cả hệ thống.

Không xoá người dùng. Một tài khoản đã ghi bút toán là một phần của sổ sách; xoá nó là
làm mất câu trả lời cho "ai đã nhập dòng này".

## Phần Auth — hai server action

**Tạo tài khoản.** Kiểm tra người gọi bằng **phiên đăng nhập thường trước**, rồi mới
dùng khoá service role. Thứ tự này quan trọng: khoá service role bỏ qua toàn bộ RLS,
nên nếu kiểm tra sau thì một lỗi ở đó là leo thang đặc quyền. Sinh mật khẩu tạm, bật
`must_change_password`, trả về mật khẩu **một lần duy nhất** và không lưu ở đâu cả.

**Đặt lại mật khẩu.** Y hệt, cho người quên mật khẩu.

## Bắt đổi mật khẩu lần đầu

Đăng nhập xong, nếu cờ còn bật thì **mọi màn hình đều đẩy về `/settings/password`**.
Đổi xong mới đi tiếp được.

Màn này mở cho mọi vai trò — ai cũng tự đổi mật khẩu mình được bất cứ lúc nào — và
dùng phiên của chính người đó, không đụng tới khoá service role. Đổi xong thì cờ tắt.

Mật khẩu tạm hiện trong một ô riêng, có nút sao chép, ghi rõ **"chỉ hiện một lần"**.
Nó không được lưu, nên đóng đi là mất thật; nói trước còn hơn để người ta đóng rồi mới
biết.

## Màn hình

`/settings/users`, chỉ ADMIN, thêm một thẻ vào trang Cấu hình bên cạnh Danh mục và Kỳ
kế toán. Bảng: tên, email, vai trò, trạng thái, ngày tạo. Thao tác: thêm người, đổi
vai trò, khoá/mở, đặt lại mật khẩu.

## Lỗi

Mọi lời từ chối do cơ sở dữ liệu phát ra, viết cho người đọc chứ không phải cho lập
trình viên, và màn hình chuyển nguyên văn — như lưới nhập liệu đang làm với quy tắc
luân chuyển vàng ("DEPOSIT is not a valid movement for Scrap Gold").

## Kiểm thử

**Test SQL** (`tests/sql/user-admin.test.ts`, chạy trên pglite):
- người gọi không phải ADMIN bị từ chối, cả bốn hàm
- không tự đổi vai trò mình, không tự khoá mình
- không hạ cấp / khoá ADMIN cuối cùng còn hoạt động
- khoá không lý do bị từ chối
- mỗi thay đổi để lại đúng một dòng `audit_log`
- người bị khoá mất `effective_role()`

**`verify:users`** (Playwright, chạy trên máy và trên bản deploy):
admin tạo người → thấy mật khẩu một lần → người mới đăng nhập → bị bắt đổi mật khẩu →
đổi xong vào được màn hình của vai trò mình → bị khoá thì mất quyền. Tự dọn dẹp: tài
khoản do bài kiểm tra tạo ra phải bị xoá khỏi `auth.users` khi chạy xong, bằng không
danh sách người dùng của khách sẽ mọc thêm một cái tên giả sau mỗi lần chạy.

## Một việc để lại, không gộp vào đây

Trên hệ thống thật đang có bốn tài khoản test — `kt@pc49.test`, `gsus@`, `oc@`,
`admin@` — và một trong số đó là quản trị. Khi người dùng thật vào thì nên khoá chúng.
Nhưng toàn bộ các script kiểm tra đang đăng nhập bằng chính chúng, nên khoá đi là mất
khả năng tự kiểm tra. Đây là một quyết định riêng cần cân nhắc, không phải một dòng
code thêm vào dự án này.
