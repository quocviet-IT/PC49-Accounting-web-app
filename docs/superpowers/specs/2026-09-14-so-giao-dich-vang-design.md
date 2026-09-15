# Sổ giao dịch vàng — thiết kế

Phần 2 trong ba phần nâng cấp do anh Việt yêu cầu ngày 14-09: "Quản lý giao dịch vàng nên hiển thị full để người dùng họ tự lọc theo mong muốn, lọc được ngày tháng trong khoảng." Phần 1 (tốc độ và loading) đã lên Production. Phần 3 (giao diện chuẩn app kế toán) làm sau.

## Hiện trạng

Màn hình `/gold-transactions` là một ngày. Trang đọc giao dịch của đúng `?date=`, bộ lọc (loại, vàng, nhân viên, thanh toán, trạng thái sửa, ô tìm) chạy trên trình duyệt trong phạm vi ngày đó, dải tổng tính cho cả ngày, và form nhập lấy ngày từ trang. Muốn xem nhiều ngày thì không có cách nào.

## Đã chốt với anh Việt (14-09)

- Mở màn hình: **tất cả giao dịch, mới nhất trước**.
- **Có nút Xuất Excel**, xuất đúng những gì đang lọc.
- **Lọc trên database**, không tải hết lịch sử về trình duyệt.

## Người dùng thấy gì

- Tiêu đề "Giao dịch vàng", nút chính **Thêm giao dịch**, nút **Xuất Excel**.
- Thanh lọc:
  - khoảng ngày **Từ – Đến** (ô ngày gốc của trình duyệt, như ô ngày hiện tại), kèm nút nhanh: Hôm nay · 7 ngày · Tháng này · Tháng trước · Năm nay · Tất cả;
  - Loại giao dịch (mọi giá trị của `pc49.txn_type`) · Loại vàng · Nhân viên · Hình thức thanh toán · Trạng thái sửa (sửa được / không sửa được);
  - ô tìm số CT, khách, SĐT, ghi chú — không phân biệt dấu, hoa thường, khoảng trắng, dấu câu; chờ người gõ ngừng 400 ms rồi mới lọc;
  - nút **Xoá bộ lọc**.
- Dải tổng theo bộ lọc, tính trên **toàn bộ kết quả** chứ không riêng trang đang xem: Số giao dịch · Mua vào · Bán ra · vàng vào/ra theo từng loại (gram).
- Bảng: cột **Ngày** ở đầu, các cột hiện có giữ nguyên. Mới nhất trước: ngày giảm dần, rồi số chứng từ giảm dần. 50 dòng một trang, đổi được 20 / 50 / 100.
- Form nhập có ô **Ngày**:
  - thêm mới khi đang xem đúng một ngày (Từ = Đến): mặc định là ngày đó — nhập nối tiếp trong một ngày như trước;
  - thêm mới trong mọi trường hợp khác: mặc định hôm nay; sửa được;
  - sửa một giao dịch: ngày của giao dịch đó, không đổi được ở đây.
- Link cũ `?date=YYYY-MM-DD` (liên kết "giao dịch gần đây" ở Tổng quan, các script kiểm tra) mở ra đúng ngày đó, tức Từ = Đến = ngày đó.

## Dữ liệu

### Địa chỉ trang là bộ lọc

`from`, `to` (YYYY-MM-DD), `type`, `gold`, `staff`, `method`, `status` (`correctable` | `locked`), `q`, `page` (≥ 1), `size` (20 | 50 | 100). Giá trị không hợp lệ bị bỏ qua như không có, không báo lỗi. Gửi link, tải lại hay bấm Back đều giữ nguyên bộ lọc. Đổi bất kỳ bộ lọc nào đưa về trang 1.

Phần đọc và ghi địa chỉ là một module thuần (`src/components/gold/ledgerQuery.ts`), dùng chung cho trang, nút xuất và route xuất.

### Database — migration 0068

Một điều kiện lọc, ba chỗ dùng, để trang, dải tổng và file Excel không thể lệch nhau:

- `pc49.fold_search(text)` — bỏ dấu tiếng Việt (cả chữ hoa), hạ chữ thường, bỏ mọi ký tự không phải chữ hoặc số. Cùng quy tắc với ô tìm hiện tại (`normalizeTransactionSearch`). Viết bằng `translate()`, không dùng extension `unaccent`, để chạy được cả trên PGlite của test.
- `pc49.gold_txn_ledger_match(t, from, to, type, gold, staff, method, status, query)` — điều kiện cho một giao dịch:
  - chưa huỷ;
  - ngày trong khoảng, tính cả hai đầu;
  - nhân viên khớp người đứng tên hoặc bất kỳ ai có phần trong đơn;
  - hình thức thanh toán khớp bất kỳ dòng thanh toán nào;
  - trạng thái theo `correction_blocked_reason` (0055);
  - ô tìm khớp số CT, mã khách, ghi chú hoặc SĐT của khách.
- `pc49.gold_txn_ledger(…, limit, offset)` — một trang, mới nhất trước, mỗi dòng kèm SĐT khách, lý do không sửa được, danh sách thanh toán, danh sách người chia và tổng số dòng khớp. Lý do không sửa được chỉ tính cho các dòng của trang.
- `pc49.gold_txn_ledger_totals(…)` — số giao dịch, mua vào (`-sum(amount)` của PO, PO_VENDOR), bán ra (`sum(amount)` của SALE, PICKUP), gram theo loại vàng (khác 0).

Cả bốn chạy bằng quyền người gọi (SECURITY INVOKER), nên chính sách đọc hiện có của `gold_txn`, `gold_txn_payment`, `gold_txn_sales_person` và `partner` vẫn quyết định ai đọc được gì. Chỉ mục `gold_txn_date_idx` đã có.

Migration chạy lên database thật **trước** khi đẩy code: bốn hàm chỉ thêm mới, bản đang chạy không dùng tới, còn bản mới gọi chúng ngay khi deploy.

## Xuất Excel

- `GET /gold-transactions/export?…` — cùng tham số với trang (bỏ `page`, `size`). Cùng quyền với màn hình (`goldTxn.write`); không có quyền thì 403.
- Đọc `gold_txn_ledger` từng lượt 1.000 dòng cho tới hết. API của Supabase cắt mỗi phản hồi ở 1.000 dòng mà không báo; đọc một lượt là xuất thiếu.
- CSV có BOM, qua `src/lib/export/csv.ts` như Báo cáo. Tên file `PC49-giao-dich-vang-<from>_<to>.csv`, không có khoảng thì ghi `tat-ca`.
- Cột: Ngày · Số CT · Loại · Khách / NCC · SĐT · Sales (kèm %) · Loại vàng · Tuổi vàng · Số lượng · ĐVT · Gram · Đơn giá · Thành tiền · Thanh toán · Ghi chú. Tiêu đề cột theo ngôn ngữ của người xuất.

## Khi có sự cố

- Không đọc được giao dịch hoặc dải tổng: báo "Không tải được dữ liệu" kèm Thử lại. Thanh lọc và nút ngày vẫn dùng được; không có nút Thêm giao dịch, vì một màn hình trống dễ khiến người ta nhập lại giao dịch đã có.
- Không có kết quả khi đang lọc: "Không có giao dịch khớp bộ lọc." kèm Xoá bộ lọc. Không có giao dịch nào và không lọc gì: "Chưa có giao dịch nào." kèm Thêm giao dịch.
- Đổi bộ lọc: khung chờ của phần 1 hiện trong lúc trang dựng lại.

## Kiểm chứng

- Test SQL (PGlite) cho migration 0068:
  - khoảng ngày tính cả hai đầu; từng bộ lọc riêng và kết hợp;
  - tìm không dấu: "khanh" ra "KHÁNH", "0901234567" ra "090 123 4567", "po-001" ra "PO-001";
  - thứ tự mới nhất trước, `limit` và `offset`, tổng số dòng không phụ thuộc trang;
  - dải tổng khớp tay; trạng thái sửa được / không sửa được;
  - gọi được bằng vai trò `authenticated` với tài khoản KT.
- Unit test `ledgerQuery`: đọc địa chỉ (kể cả `?date=` cũ và giá trị rác), nút chọn nhanh quanh đầu tháng, đầu năm, đổi bộ lọc về trang 1.
- Unit test dựng file CSV: đúng cột, số âm, nhiều dòng thanh toán, tiếng Việt.
- Trình duyệt:
  - `verify:grid` (form nhập) và `verify:layout` vẫn đạt;
  - `verify:ledger` mới: khoảng tháng 1/2026 có đúng số dòng và tổng mua vào như database; nút "Tháng này" đổi địa chỉ; file Excel xuất về có đúng số dòng đó.
- Tốc độ: `probe:speed` thêm `/gold-transactions` (mặc định, tất cả); mọi màn hình ≤ 800 ms trên Production.

## Không thuộc phần này

- Đổi ngày khi sửa một giao dịch.
- Sắp xếp theo cột khác ngày; chọn nhiều giá trị trong một bộ lọc.
- File `.xlsx` thật — `csv.ts` đã giải thích vì sao là CSV.
- Màu nút, icon, bố cục chung — phần 3.
