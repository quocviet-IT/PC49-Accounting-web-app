# PC49 — Đặc tả cải thiện giao diện và độ tin cậy thao tác

Tài liệu bàn giao triển khai cho Tech Lead, Frontend, Backend và QA

Phiên bản: 1.0 | Ngày: 05/09/2026 | Trạng thái: Đề xuất kỹ thuật để chia task và triển khai

Baseline: workspace PC49_WEBAPP, HEAD e559d2711960e26a681b80bc14708aec18d26bba, có thay đổi chưa commit tại thời điểm review.

## 1. Mục tiêu, cách sử dụng và ranh giới

### 1.1 Kết quả cần đạt

PC49 là hệ thống kế toán và quản lý giao dịch vàng thay thế chuỗi bảng tính. Giao diện cần giúp người dùng nhập nhanh, đọc đúng tiền và trọng lượng, biết chắc dữ liệu đã được lưu, và tìm được việc cần xử lý trong ngày. Nâng cấp này tập trung vào giao diện nghiệp vụ; các thay đổi backend chỉ được đưa vào khi cần bảo đảm hành vi giao diện là đúng.

- Không hiển thị số 0 để thay thế lỗi tải dữ liệu.
- Không đảo giao dịch gốc chỉ vì người dùng mở chế độ sửa.
- Không cắt mất chữ số của tiền, khối lượng, đơn giá hoặc tổng cộng.
- Không làm mất dòng đang nhập khi chuyển ngày hoặc điều hướng mà người dùng chưa được cảnh báo.
- Phân biệt rõ nháp, đang lưu, đã lưu, lỗi xác nhận và chưa xác định kết quả lưu.
- Dashboard cho biết số liệu thuộc ngày nào, dùng nguồn giá nào và có việc gì cần xử lý.
- Hoạt động nhất quán ở tiếng Việt/Anh, light/dark mode, desktop và điện thoại.

### 1.2 Cách đọc tài liệu

Tech Lead đọc mục 2–4 và 15–18 để chốt phạm vi, phụ thuộc và chia PR. Frontend đọc mục 5–12 để triển khai thành phần và hành vi. Backend đọc mục 4, 6, 7, 13 để thiết kế hợp đồng dữ liệu và migration. QA dùng mục 14 làm checklist kiểm thử, kết hợp tiêu chí nghiệm thu trong từng mục.

Các tên file mới, RPC mới, kiểu dữ liệu và mã thông báo được ghi là “đề xuất”. Chúng chưa tồn tại trong baseline và không được coi là API đã triển khai. Mốc dòng dùng để tìm vị trí ở baseline; khi code thay đổi, tìm theo tên hàm/component.

### 1.3 Trong và ngoài phạm vi

Trong phạm vi: sửa luồng tạo/sửa giao dịch; bảo vệ nháp; bảng số liệu responsive; dashboard; page header/toolbar; trạng thái tải/lỗi/rỗng; điều hướng; chuẩn hóa component, i18n và accessibility; kiểm thử hồi quy cho các thay đổi đó.

Ngoài phạm vi: thay framework; đổi thư viện UI; đổi chính sách giá vốn; thay quy tắc quy đổi vàng; đổi hệ thống tài khoản; tính lại dữ liệu lịch sử; tự động xử lý giao dịch dở dang của production; mở rộng sang các pháp nhân khác; triển khai hệ thống biểu đồ mới hoặc một ứng dụng mobile độc lập.

Tài liệu này không thay thế đặc tả nghiệp vụ kế toán. Không chạy migration, seed, demo hoặc các script verify ghi dữ liệu trên production chỉ để nghiệm thu giao diện.

### 1.4 Mức độ bằng chứng

“Xác nhận từ code” nghĩa là nhánh thực thi/CSS tồn tại trong workspace đã đọc; không đồng nghĩa đã tái hiện trên production. “Ảnh tham chiếu” là ảnh có sẵn trong ui-shots; một số ảnh từ tháng 08/2026 cũ hơn code ngày 05/09/2026. “Thiết kế đề xuất” là hành vi mục tiêu của đợt nâng cấp. “Cần xác nhận” là điểm phải chốt trước khi triển khai phần phụ thuộc.

Review chưa có phiên kiểm thử trình duyệt trực tiếp và chưa kiểm tra toàn bộ database đang triển khai. Typecheck, lint và 33 unit test về token màu, stylesheet, navigation, i18n đã pass ở lượt review trước. Chưa chạy toàn bộ SQL suite, build production hoặc E2E cho thay đổi đề xuất.

## 2. Hiện trạng kỹ thuật và các nguyên tắc cần giữ

### 2.1 Stack và kiến trúc

package.json khai báo Next.js ^16.2.11, React ^19.2.4, Ant Design ^6.6.1, TypeScript ^5.9.3, Supabase JS ^2.112.4, Zod ^4.4.3 và Vitest ^4.1.11. Đây là dải phiên bản khai báo, không phải cam kết mọi dependency đã resolve đúng bằng phiên bản tối thiểu. Dùng package-lock.json và npm ci cho môi trường tái lập.

App Router dùng route group src/app/(app), layout đăng nhập dùng AppShell, dữ liệu được đọc ở Server Component và truyền xuống component client. Mutation chủ yếu đi qua Server Actions và RPC PostgreSQL. CSS dùng globals.css và CSS Modules; không có yêu cầu chuyển sang Tailwind.

Trước khi viết code Next.js, đọc guide đi kèm bản Next đã cài trong node_modules/next/dist/docs theo AGENTS.md. Đã đối chiếu các guide 01-app/01-getting-started/07-mutating-data.md và 10-error-handling.md để xây dựng hướng dẫn này. Server Action cần xác thực/phân quyền độc lập; route đã được bảo vệ không thay thế bảo vệ action.

### 2.2 Những nền tảng nên tái sử dụng

- src/lib/design/tokens.ts đã là nguồn màu chung cho CSS variables và Ant Design. Giữ một nguồn quyết định màu.
- src/components/ledger/Ledger.tsx có Page, Section, Frame, Stat, Stats, Empty và formatter số. Mở rộng có kiểm soát thay vì tạo bộ UI thứ hai.
- AppShell đã có sidebar thu gọn, drawer trên mobile, active navigation, skip link, locale switch và theme switch.
- src/lib/nav.ts lưu cấu trúc menu dưới dạng dữ liệu; src/lib/auth/roles.ts lưu capability. Sử dụng hai nguồn này để quyết định link và hành động.
- src/lib/i18n/dictionary.ts có VI/EN. Mọi nhãn mới, thông báo trạng thái và lỗi người dùng đều phải có hai ngôn ngữ.
- Quy tắc kế toán, period lock và audit nằm ở database. UI chỉ diễn đạt trạng thái, không tự quyết định bỏ qua một ràng buộc nghiệp vụ.

### 2.3 Bất biến nghiệp vụ của đợt cải thiện

USD là tiền cơ sở theo đặc tả nghiệp vụ. Tiền và trọng lượng hiển thị 2 chữ số thập phân; đơn giá và độ tinh khiết có yêu cầu độ chính xác cao hơn trong đặc tả. Giá trị chuẩn dùng numeric ở database; phép tính preview JavaScript không phải số hạch toán cuối cùng.

Giữ quy ước mua: số lượng dương, thành tiền âm; bán: số lượng âm, thành tiền dương. Không tự đảo dấu đã nhập khi người dùng đổi loại giao dịch. Nếu loại và dấu mâu thuẫn, hiển thị lỗi tại trường và yêu cầu người dùng sửa.

Không hợp nhất hằng số quy đổi trọng lượng và định giá. Đặc tả phân biệt 31.105 g/Oz cho trọng lượng với 31.1 cho định giá; lấy hằng số nghiệp vụ từ nguồn đang được hệ thống sử dụng, không hardcode thêm trong UI.

Không gộp tiền đang chuyển/clearing vào tiền mặt và ngân hàng thực. Không cộng vàng của chủ khác vào tài sản PC49. Tồn sổ sách, tồn vật lý và tổng tài sản phải được ghi nhãn riêng, kèm thời điểm chốt số.

Không hard delete. Sửa giao dịch đã hạch toán phải giữ lịch sử và sử dụng giao dịch đảo. Khi tháng gốc đã khóa, không sửa lùi vào tháng khóa; ngày đảo/ngày thay thế phải được kiểm tra với chính sách kỳ kế toán.

### 2.4 Điểm lệch giữa đặc tả cũ và code hiện tại

Business specification v1.0 ngày 27/08/2026 còn ghi tối đa hai thanh toán và loại trừ một số phạm vi chia nhân viên. Code hiện tại đã hỗ trợ đến 20 dòng thanh toán và 10 dòng nhân viên với tỷ lệ phân chia; migration 0046 đã bỏ giới hạn hai thanh toán. Đợt UI phải bảo toàn khả năng hiện có; không dùng tài liệu cũ để thu hẹp lại chức năng.

Mô tả trách nhiệm role trong đặc tả cũ cũng không hoàn toàn trùng capability hiện tại. Giữ quyền đang được code/database áp dụng cho đến khi chủ sản phẩm chốt thay đổi riêng. Một yêu cầu cải thiện menu không phải là quyết định cấp thêm quyền.

## 3. Danh sách phát hiện và độ ưu tiên

### 3.1 PC49-01 — Sửa giao dịch gây đảo dữ liệu quá sớm — P1

Bằng chứng: src/components/gold/TxnGrid.tsx, correctRow(), khoảng dòng 343–379; src/app/(app)/gold-transactions/actions.ts, voidTransaction(); supabase/migrations/0034_void_gold_txn.sql.

Hiện trạng: chọn Sửa, nhập lý do trong window.prompt, code gọi voidTransaction và chờ thành công rồi mới thêm dòng nháp bằng setDrafts. RPC void_gold_txn đảo journal/inventory và đặt voided_at. Dòng thay thế chưa được lưu ở thời điểm đó.

Tình huống: người dùng mở sửa, sau đó đổi ý/đổi trang/mất kết nối/lưu bản thay thế thất bại. Giao dịch gốc đã bị đảo nhưng bản thay thế chưa tồn tại. Chú thích trong component về việc tạo nháp trước không khớp thứ tự thực thi.

Mục tiêu: mở sửa không ghi database; chỉ khi xác nhận mới đảo gốc và tạo bản thay thế trong cùng transaction. Tiêu chí bắt buộc: mọi lỗi trước commit đều giữ nguyên trạng thái tài chính ban đầu.

### 3.2 PC49-02 — Lỗi truy vấn bị trình bày như số 0 — P1

Bằng chứng: src/app/(app)/page.tsx, khoảng dòng 14–43. Các query trả data/error nhưng code lấy data ?? [] và cash.data ?? 0, deposits.count ?? 0 mà không phân nhánh error. Pattern tương tự có trong Cash, Inventory và Reports; cần rà soát toàn bộ các trang đọc số trước khi đóng ticket.

Tình huống: truy vấn số dư thất bại nhưng ô Cash hiển thị 0; lỗi inventory bị chuyển thành tổng khối lượng 0 rồi nhân giá; người dùng tưởng dữ liệu là số thực. Promise.all không giải quyết việc này vì Supabase có thể trả error trong kết quả thay vì reject promise.

Mục tiêu: tách success, empty, error, unavailable; tổng hợp phụ thuộc vào một nguồn lỗi cũng phải báo thiếu dữ liệu, không cộng như 0. Retry giữ nguyên filter và ngày đang xem.

### 3.3 PC49-03 — Bảng số liệu cắt chữ số trên màn hình hẹp — P1

Bằng chứng: src/components/ledger/Ledger.module.css, .table và .table td, khoảng dòng 76–105; pattern tương tự trong globals.css. Ảnh ui-shots/phone-light-cash.png cho thấy tiền thu, chi, cuối kỳ và tổng cộng bị ellipsis.

Nguyên nhân: width:100%, table-layout:fixed, cột chia theo phần trăm, mọi td đều nowrap + overflow:hidden + text-overflow:ellipsis. Wrapper overflow-x:auto không tạo đủ chiều rộng khi chính bảng vẫn bị ép vừa container.

Mục tiêu: cột số có min-width theo kiểu dữ liệu; table có min-width phù hợp; cuộn nằm trong frame; không có ellipsis cho số. Bố cục điện thoại bổ sung danh sách tóm tắt mở chi tiết.

### 3.4 PC49-04 — Đổi ngày làm mất nháp — P2

Bằng chứng: TxnGrid.tsx, useState(drafts), goToDate(); gold-transactions/page.tsx dùng key={txnDate}. Key theo ngày là đúng để tránh lưu nhầm ngày, nhưng chưa có bước giải quyết nháp trước khi remount.

Mục tiêu: trước khi đổi ngày, kiểm tra nháp có dữ liệu; cho Lưu rồi chuyển / Bỏ thay đổi / Ở lại. Nháp đang lưu hoặc kết quả lưu chưa rõ không được tự bỏ. Không giải quyết bằng cách bỏ key theo ngày vì sẽ tái tạo rủi ro lưu nháp sang ngày khác.

### 3.5 PC49-05 — Ghi chú không xuất hiện ở dòng đã lưu — P2

Bằng chứng: TxnGrid.tsx, phần render existing.map(), khoảng dòng 474–499. Header vẫn là Ghi chú nhưng ô chỉ có nút Sửa/Hủy, không render r.remarks. Dữ liệu remarks vẫn được query.

Mục tiêu: cột Ghi chú hiển thị nội dung đã lưu; cột Thao tác độc lập. Ghi chú dài có thể xuống dòng hoặc mở chi tiết bằng click/keyboard; không chỉ có tooltip khi hover.

### 3.6 PC49-06 — Luồng lưu mới chưa nguyên tử — P1, phát hiện bổ sung

Bằng chứng: gold-transactions/actions.ts, saveTransaction(). Hàm insert gold_txn, upsert partner, insert gold_txn_sales_person, insert gold_txn_payment và gọi post_gold_txn bằng các request riêng.

Nguy cơ từ code: khi ghi nhân viên/thanh toán/post thất bại, những request trước có thể đã commit. UI trả lỗi nhưng một phần giao dịch đã tồn tại; lần thử lại có thể tạo thêm gold_txn. Chưa tái hiện lỗi giữa chừng trên môi trường thực; cần fault-injection test trên database thử nghiệm.

Mục tiêu: gom các phần dữ liệu tài chính cần đồng nhất vào một RPC atomic; requestId ổn định giúp retry không tạo trùng; thông tin phụ về danh bạ có contract rõ ràng, không biến một lần lưu tài chính thành thất bại mơ hồ.

### 3.7 PC49-07 — Dashboard thiếu ngữ cảnh và đường vào nghiệp vụ — P2

Bằng chứng: src/components/home/Overview.tsx chỉ render Page và bốn Stat. Chưa có đường dẫn từ KPI, hàng đợi công việc, danh sách giao dịch gần đây, ngày giá spot hoặc thời điểm tải thành công.

Mục tiêu: tận dụng diện tích để trả lời ba câu hỏi: hôm nay có bao nhiêu tài sản/tiền, dữ liệu có đầy đủ không, việc nào cần xử lý tiếp. Không thêm biểu đồ không có dữ liệu lịch sử đáng tin cậy chỉ để lấp chỗ trống.

### 3.8 PC49-08 — Chữ nhỏ và nhiều hệ style trùng chức năng — P2

Bằng chứng: nhãn bảng/KPI ở Ledger.module.css dùng 10.5–11px, viết hoa; TxnGrid có header/controls riêng; globals.css và Ledger.module.css đều định nghĩa bảng, stats và trạng thái số.

Mục tiêu: một thang chữ và spacing; một bộ primitive dùng chung; hỗ trợ mật độ đọc bình thường và nhập liệu compact. Không xóa các class cũ trước khi kiểm tra toàn bộ nơi sử dụng.

### 3.9 PC49-09 — Nguồn dữ liệu và quyền cần đồng bộ — P2

gold-transactions/page.tsx tải payments và sales shares không giới hạn theo tập giao dịch của ngày. Đây là điểm cần sửa phạm vi query và kiểm thử với dữ liệu lớn; chưa kết luận cấu hình API production đang cắt ở bao nhiêu dòng. Không dựa vào một con số giới hạn mặc định chưa kiểm chứng.

Menu /cash yêu cầu bankImport.run trong nav.ts, trong khi trang Cash cho phép report.read. GS_US/OC có report.read nhưng không có bankImport.run nên có thể xem bằng URL mà không thấy menu tương ứng. Đề xuất menu theo quyền đọc và ẩn riêng Import/Reconcile theo quyền mutation, sau khi xác nhận với Tech Lead; không cấp quyền ghi chỉ để làm menu hiện.

## 4. Kiến trúc đích và hợp đồng chung

### 4.1 Ranh giới trách nhiệm

Database tính số chuẩn, thực thi period lock, kiểm tra quyền, đảm bảo transaction và audit. Server Action validate input, gọi một RPC, chuyển lỗi thành mã ổn định và revalidate các route bị ảnh hưởng. Loader trang chuẩn hóa kết quả truy vấn nhưng không làm mất trạng thái lỗi. Component client quản lý nháp, focus, thao tác và thông báo; không tự tính số dư kế toán từ dữ liệu hiển thị đã phân trang.

### 4.2 Kết quả đọc dữ liệu — đề xuất

Mỗi khối dữ liệu trả trạng thái ready, empty, unavailable hoặc error. ready mang data, fetchedAt và effectiveDate nếu có. empty chỉ hợp lệ khi query thành công và không có bản ghi theo filter. unavailable dùng khi không đủ điều kiện nghiệp vụ để tính, ví dụ chưa có spot. error mang code, messageKey, retryable và requestId để tra log; không mang secret hoặc SQL nội bộ ra màn hình.

Số 0 chỉ xuất hiện nếu truy vấn thành công và giá trị thực là 0. Không đưa fetchedAt vào nhãn “Cập nhật dữ liệu cuối” nếu đó chỉ là thời điểm tải; nhãn phải là “Tải thành công lúc”. Ngày dữ liệu và ngày giá spot là metadata khác nhau.

### 4.3 Kết quả mutation — đề xuất

Thành công trả status=success, requestId, transactionId, postedEntryId và canonicalRow; correction trả thêm originalTransactionId, replacementTransactionId và reversalEntryId. Có thể trả warnings cho tác vụ phụ đã được xác định là không ảnh hưởng commit tài chính.

Lỗi dự kiến trả status=error, code, messageKey, fieldErrors khi có và retryable. Mã đề xuất: VALIDATION_FAILED, PERIOD_CLOSED, FORBIDDEN, CONFLICT, SOURCE_ALREADY_VOIDED, PRICE_MISSING, REQUEST_KEY_REUSED và TEMPORARY_UNAVAILABLE. Lỗi transport hoặc timeout phía client là kết quả unknown, không tự kết luận database đã rollback.

requestId phải được tạo một lần cho mỗi ý định lưu, giữ nguyên khi retry cùng payload. Nếu đã biết thất bại và người dùng sửa payload, tạo ý định mới theo quy tắc ở mục 6. Không tạo UUID mới trong mỗi lần bấm Thử lại của một request chưa rõ kết quả.

### 4.4 Component và file mới — đề xuất

- src/components/ui/ActionButton.tsx: wrapper mỏng cho Ant Button nếu cần chuẩn hóa loading, danger và kích thước. Không viết lại focus/keyboard đã có của Ant.
- src/components/ui/DataState.tsx: trạng thái lỗi, empty, unavailable và retry cho từng khối.
- src/components/ui/StatusBadge.tsx: nhãn trạng thái có chữ và màu semantic.
- src/components/ui/ConfirmActionDialog.tsx: dialog xác nhận, lý do, pending, focus return.
- src/components/ledger/ReportToolbar.tsx: ngày/kỳ/filter/export thống nhất, giữ query params liên quan.
- src/components/ledger/NumericCell.tsx: format theo kind, không ellipsis, tabular-nums, metadata đơn vị.
- src/components/gold/useTransactionDrafts.ts: reducer nháp và trạng thái per-row.
- src/components/gold/TransactionActions.tsx và CorrectionEditor.tsx: tách luồng sửa/hủy khỏi render bảng lớn.
- src/components/home/AttentionList.tsx và RecentTransactions.tsx: nội dung mới của dashboard.
- src/lib/domain/transaction-input.ts và src/lib/domain/transaction-result.ts: schema/contract dùng chung, không import component client vào server.
- src/lib/data/overview.ts và src/lib/data/reports.ts: loader nếu việc tái sử dụng đủ rõ; không tạo abstraction chỉ để bọc một dòng query.

Tên có thể điều chỉnh theo convention repo, nhưng trách nhiệm và acceptance criteria cần giữ nguyên. Tránh một PR vừa thay toàn bộ folder structure vừa sửa accounting.

## 5. Hệ giao diện chung

### 5.1 Định hướng thị giác

Giữ nền trung tính, sidebar navy, teal cho hành động chính, xanh/đỏ cho chiều tiền, amber cho việc cần chú ý. Giữ diện mạo sổ kế toán với các hàng dễ quét và số thẳng cột. Không thêm gradient lớn, ảnh nền, animation cuộn, bóng đổ nặng hoặc card lồng nhiều lớp vào màn nhập liệu.

Giữ font sans hiện có ở vòng đầu để giảm rủi ro font tiếng Việt và chi phí tải. Cải thiện bằng size, weight và khoảng cách trước. Sau UAT chỉ đổi font nếu có lợi ích rõ ràng ở chữ có dấu và chữ số.

### 5.2 Token kích thước mục tiêu

| Vai trò | Desktop | Điện thoại |
|---|---|---|
| Tiêu đề trang | 24px / 32px, weight 650 | 22px / 30px |
| Tiêu đề section | 15px / 22px, weight 600 | 15px / 22px |
| Nội dung thường | 14px / 21px | 14px / 21px |
| Nhãn bảng, helper | 12px / 18px | 12px / 18px |
| Giá trị KPI | 26px / 34px, tabular | 24px / 32px |
| Nút/ô nhập thường | Cao tối thiểu 36px | Vùng chạm tối thiểu 44px |
| Dòng bảng đọc | Tối thiểu 40px, tự tăng | Theo nội dung |
| Dòng nhập compact | Tối thiểu 32px, tự tăng | Dùng form chi tiết |

Các số trên là design target, không phải kết quả đo hiện trạng. Line-height tính theo cặp size/line-height. Dòng có nhiều thanh toán/nhân viên được tăng chiều cao tự nhiên, không ép height khiến nội dung mất.

Spacing scale: 4, 8, 12, 16, 24, 32px. Padding nội dung 24px desktop, 16px mobile. Khoảng giữa section 24–32px. Border radius 6px cho input/button, 10px cho frame, 12px cho dialog. Chuyển động hover/focus 120–180ms; không animation trên giá trị tiền.

### 5.3 Màu và tương phản

Giữ token màu hiện tại làm baseline. Thay đổi màu phải cập nhật tokens.ts, cssVariableBlock tương ứng và antdThemeTokens đồng bộ. Không chèn hex trực tiếp vào CSS Module. Tương phản mục tiêu: 4.5:1 cho chữ nhỏ, 3:1 cho chữ lớn và dấu focus/biên tương tác quan trọng; QA cần đo trước khi tuyên bố đạt, không chỉ xem bằng mắt.

Màu không phải tín hiệu duy nhất: số âm có dấu âm, trạng thái có chữ, trường lỗi có mô tả. Giá trị 0 trung tính; không tô đỏ 0 hoặc -0.00. Màu nhận diện teal không dùng để thay màu cảnh báo hoặc trạng thái nghiệp vụ.

### 5.4 Page header và toolbar

Một H1 trong vùng nội dung, mô tả ngắn nếu cần, hành động chính ở cạnh tiêu đề trên desktop. Header trên cùng của AppShell thể hiện vị trí/breadcrumb; tránh lặp cùng một tiêu đề với mức nhấn mạnh ngang nhau.

Toolbar nằm ngay trên khối dữ liệu gồm kỳ/ngày, tìm kiếm/filter thực sự có tác dụng, hành động phụ và export. Mobile xuống hàng theo nhóm, không thu nhỏ chữ. Chỉ thêm filter khi đã có loader hỗ trợ; mọi filter phải phản ánh trong URL để reload/back/share giữ ngữ cảnh.

### 5.5 Chuẩn component

Primary: một hành động nổi bật trong mỗi vùng công việc. Secondary: chuyển ngày, mở filter, xuất file. Danger: hủy/đảo, luôn có nhãn cụ thể. Nút icon-only cần accessible name và tooltip nhưng không dùng tooltip làm nhãn duy nhất trên touch.

Loading không chỉ là disabled: nút nói “Đang lưu”, dòng hiển thị pending và vùng trạng thái thông báo bằng aria-live. Dialog mở phải focus đúng nơi, đóng trả focus về nút gọi, Escape chỉ đóng khi an toàn, không mất dữ liệu đang gửi.

## 6. Luồng tạo giao dịch và trạng thái lưu

### 6.1 Luồng người dùng mục tiêu

Người dùng chọn ngày và thêm dòng, nhập dữ liệu, thấy thành tiền preview, kiểm tra thanh toán/nhân viên, bấm Lưu dòng hoặc dùng Ctrl/Cmd+Enter trong dòng. Dòng chuyển sang Đang lưu. Thành công nhận canonicalRow và hiện Đã lưu; thất bại giữ dữ liệu, focus trường lỗi; timeout hiện Chưa xác định kết quả với hướng kiểm tra/thử lại cùng requestId.

Vòng đầu ưu tiên nút Lưu rõ ràng và Ctrl/Cmd+Enter. Hành vi Enter đơn hiện tại cần UAT trước khi thay: Enter trong autocomplete chỉ chọn option, trong textarea xuống dòng; không submit do người dùng đang gõ tiếng Việt bằng IME. Không tiếp tục tự lưu bằng onBlur của ô ghi chú nếu chưa định nghĩa và kiểm thử đầy đủ hành vi đó.

### 6.2 State machine của mỗi dòng

| State | Ý nghĩa | Hành động được phép |
|---|---|---|
| blank | Chưa có dữ liệu nghiệp vụ | Nhập, xóa dòng |
| dirty | Đã thay đổi, chưa lưu | Sửa, lưu, bỏ nháp |
| validating | Kiểm tra cục bộ | Chờ kiểm tra hoàn tất |
| saving | Request đang gửi | Xem dữ liệu; không gửi trùng |
| saved | Server xác nhận commit | Xem, mở sửa, hủy nếu có quyền |
| error | Thất bại có kết quả xác định | Sửa lỗi, thử lại phù hợp |
| unknown | Mất phản hồi, chưa biết commit | Kiểm tra trạng thái, retry cùng ý định |

State lưu tách khỏi state sửa/hủy. Một dòng đang saving không disable toàn bộ bảng; các dòng khác vẫn nhập được. Guard inFlight phía client phải được giải phóng trong finally khi kết quả đã xử lý; không để một exception làm dòng mắc kẹt. unknown vẫn giữ requestId và payload snapshot để tránh retry với nội dung khác.

### 6.3 Validation và số liệu

Không silently return khi thiếu loại vàng, qty hoặc giá như commit() hiện tại. Mỗi điều kiện không hợp lệ có field error, thông báo đọc được và focus vào trường đầu tiên. Validate finite number, dấu theo txn type, đơn vị hợp lệ, precision và giới hạn schema. Các loại được phép unitPrice=null phải giữ đúng quy tắc hiện hành, không áp một required chung lên mọi loại.

Payment row hoàn toàn trống được bỏ qua; có số tiền nhưng thiếu method hoặc có method và nội dung số tiền không hợp lệ phải báo lỗi, không silently filter mất phần đã nhập. Giữ tối đa 20 payment và 10 sales share theo code hiện tại; không giảm còn hai dòng. Một nhân viên mặc định 100%; nhiều nhân viên phải đủ 100% theo precision thống nhất với DB; không tự chia đều.

Hiện tuổi vàng/purity là fraction 0–1 ở schema. UI phải ghi rõ dạng nhập hoặc chuyển đổi phần trăm hiển thị một cách nhất quán. Không đổi ý nghĩa 0.583 thành 58.3 trong payload. Đơn giá cần giữ precision nghiệp vụ khi hiển thị/xuất, dù số tiền cuối cùng làm tròn 2 chữ số.

Giá trị nhập giữ dạng text trong draft để không phá dấu thập phân hoặc số âm đang gõ. Preview cần ghi rõ tạm tính; database dùng numeric và trả số chuẩn đã tính. Số chuẩn ghi đè preview sau khi lưu; tổng cuối trang dựa vào giao dịch đã commit, không cộng nháp chưa lưu vào tổng kế toán.

### 6.4 RPC lưu nguyên tử — đề xuất save_gold_transaction

Input gồm requestId, transaction payload, payments và salesPeople. Actor lấy từ session/database, không tin actorId do client gửi. Amount chuẩn do server/database tính và đối chiếu chính sách hiện tại; client không được tự quyết định số hạch toán bằng cách sửa payload amount.

Các bước trong một transaction: xác thực quyền; kiểm tra idempotency; validate ngày/kỳ và dữ liệu; tạo giao dịch; tạo các quan hệ thanh toán/nhân viên; gọi post_gold_txn; ghi audit/request outcome; trả canonical data. Bất kỳ lỗi ở phần tài chính phải rollback cả khối. Không gọi nhiều Supabase request từ action rồi coi đó là một SQL transaction.

Danh bạ partner/phone cần chốt một trong hai cách: đưa vào cùng transaction nếu bắt buộc để lưu hợp lệ, hoặc tách thành bước phụ với warning rõ ràng nếu tài chính đã commit. Không trả “Lưu thất bại” sau khi tài chính đã thành công chỉ vì phone chưa cập nhật. Không dùng console.error chứa thông tin khách hàng làm cơ chế xử lý duy nhất.

RPC mặc định giữ RLS và quyền hiện có; ưu tiên SECURITY INVOKER. Nếu cần SECURITY DEFINER, Tech Lead phải review search_path cố định, auth.uid, capability, scope dữ liệu, EXECUTE grants và các bảng truy cập. Không dùng service-role trong browser để vượt lỗi quyền.

### 6.5 Chống lưu trùng và concurrency

Đề xuất bảng request/outcome hoặc cột liên kết có unique constraint theo phạm vi actor và requestId, lưu operation, canonical payload hash và kết quả transactionId. Cùng key/cùng payload trả lại kết quả cũ; cùng key/khác payload trả REQUEST_KEY_REUSED. Race giữa hai request phải được giải quyết ở database bằng constraint/lock, không chỉ bằng ref trong React.

Retry khi mất phản hồi dùng lại key và payload cũ. Khi kiểm tra xác nhận request chưa commit và lỗi validation đã rõ, người dùng sửa payload thì tạo ý định/key mới. Không lưu plaintext payload nhạy cảm chỉ để làm idempotency; hash được tính ở server trên payload canonical, có schema version.

Nếu request rollback hoàn toàn thì không đánh dấu thành công. Nếu response bị mất sau commit, retry vẫn nhận transaction cũ. UI chỉ thêm/cập nhật đúng một dòng theo transactionId; revalidation không được đếm hai lần cùng bản ghi giữa existing và draft.

### 6.6 Nghiệm thu luồng lưu

- Tạo PO/SALE với nhiều payment và nhiều nhân viên trả đúng dữ liệu, journal, inventory và tổng.
- Gây lỗi ở payment, sales share hoặc post thì không còn bản ghi tài chính một phần.
- Bấm lưu hai lần, Enter kèm blur, retry timeout và hai request đồng thời không tạo trùng.
- Lỗi trường nằm cạnh trường; không rơi ra ngoài viewport ở cuối bảng.
- Lưu xong vẫn thấy ghi chú, thanh toán, nhân viên và precision đã nhập.
- Tổng đã lưu không bao gồm nháp; có thể hiển thị riêng số dòng nháp hoặc tổng nháp với nhãn rõ ràng.

## 7. Luồng sửa, hủy và bảo vệ nháp

### 7.1 Sửa giao dịch đã lưu

Chọn Sửa chỉ tạo correction draft chứa originalTransactionId, version/concurrency token, dữ liệu gốc và dữ liệu có thể chỉnh. Desktop có thể mở editor trong dòng hoặc panel bên cạnh; mobile dùng form toàn chiều rộng. Giao dịch gốc vẫn hiển thị đang có hiệu lực trong khi người dùng chỉnh.

Trước xác nhận, hiển thị so sánh các trường thay đổi: qty, unitPrice, amount, loại vàng, ngày, payments, shares, remarks. Bắt buộc lý do tối thiểu theo schema; hiển thị ngày đảo và ngày giao dịch thay thế. Nếu tháng gốc khóa, báo rõ phải chọn ngày hợp lệ theo chính sách, không tự đoán một ngày kế toán mới.

Nút cuối là “Xác nhận sửa giao dịch”, không dùng nhãn mơ hồ “OK”. Khi pending, khóa xác nhận của editor và giữ nguyên dữ liệu. Thành công thông báo đã sửa, cho xem bản gốc/bản thay thế và lịch sử; thất bại giữ editor cùng lỗi, bản gốc không đổi nếu transaction đã rollback.

### 7.2 RPC sửa nguyên tử — đề xuất correct_gold_transaction

Input: requestId, originalTransactionId, expectedVersion, reason, reversalDate và replacement payload. Khóa dòng gốc bằng SELECT FOR UPDATE; kiểm tra chưa void, quyền thao tác, quan hệ deposit/pickup và version. Không chỉ so sánh dữ liệu từ client.

Trong cùng transaction, gọi logic void_gold_txn để giữ cơ chế đảo journal/inventory hiện có, tạo và post giao dịch thay thế bằng logic dùng chung, lưu quan hệ correction và audit, lưu kết quả idempotency rồi commit. Việc tạo/đảo có thể được sắp thứ tự theo ràng buộc SQL, nhưng tuyệt đối không lộ trạng thái nửa chừng ra ngoài transaction.

Chỉ dùng updated_at làm optimistic token sau khi xác nhận mọi writer đều cập nhật nó đáng tin cậy; nếu chưa, thêm revision/version bằng migration. Hai người cùng sửa một giao dịch: người thắng commit, người còn lại nhận CONFLICT, có thể xem bản mới rồi bắt đầu lại. Không tự ghi đè.

Phải xác định trường nào cho sửa an toàn. TxnGrid hiện không tải đủ mọi quan hệ nghiệp vụ như deposit_ref_id/conversion_id. Với giao dịch có pickup, conversion, refining hoặc ràng buộc nguồn liên quan, đọc đủ dữ liệu và xử lý chuyên biệt; nếu chưa hỗ trợ, disable Sửa với lý do cụ thể. Không tạo bản thay thế thiếu quan hệ chỉ vì một số field không nằm trong SavedRow.

### 7.3 Hủy giao dịch độc lập

Thay window.prompt bằng dialog có mã/ngày giao dịch, khách/NCC, loại vàng, số tiền và lý do. Hủy độc lập vẫn là thao tác riêng với Sửa. Hiển thị ảnh hưởng: giao dịch bị hủy, journal và inventory được đảo theo ngày đã chọn; không mô tả là xóa khỏi hệ thống.

Kiểm tra lý do ngay tại dialog, hiển thị lỗi period/dependency ở đó; có hành động Quay lại. Sau thành công, refresh danh sách/tổng và thông báo kết quả. Nếu timeout, giữ trạng thái chưa rõ và kiểm tra request outcome trước khi gửi lại.

### 7.4 Bảo vệ nháp và điều hướng

Mức tối thiểu vòng đầu: dirty detection và guard cho đổi ngày, link trong app, đóng editor và reload/đóng tab. Blank draft tự sinh không được kích hoạt cảnh báo; dữ liệu nhập thật, lỗi chưa xử lý và correction draft phải được nhận diện.

Ba lựa chọn khi điều hướng: Lưu rồi chuyển / Bỏ thay đổi / Ở lại. Lưu rồi chuyển chỉ tiếp tục khi tất cả dòng liên quan được xác nhận thành công. Có một dòng error hoặc unknown thì ở lại; không đổi ngày để làm biến mất lỗi. Bỏ thay đổi phải bỏ đúng tập nháp và không tạo mutation tài chính.

beforeunload chỉ đăng ký khi có dirty; browser có thể dùng thông báo mặc định và không bảo đảm mọi trường hợp mobile. Với navigation nội bộ, dùng wrapper/điểm điều phối điều hướng có kiểm soát và kiểm tra API phù hợp bản Next hiện tại; không tự patch router private API. Browser Back cần E2E riêng, không chỉ kiểm tra nút đổi ngày.

Mức mở rộng nếu cần phục hồi sau crash: lưu nháp theo user + ngày + schemaVersion, có thời hạn và dọn khi sign-out/đổi user. Do nháp chứa dữ liệu giao dịch và điện thoại, không mặc định đưa toàn bộ vào localStorage. Đề xuất server-side draft có RLS; việc lưu nháp lâu dài là ticket riêng, không dùng để trì hoãn guard tối thiểu.

### 7.5 Nghiệm thu sửa và nháp

- Mở sửa rồi Cancel không có bất kỳ write/void nào.
- Lỗi tạo replacement không làm gốc bị void; journal và inventory giữ nguyên.
- Hai người sửa đồng thời chỉ có một correction hợp lệ.
- Giao dịch đã có pickup/quan hệ không được sửa bằng payload thiếu dữ liệu.
- Đổi ngày khi có nháp cho đúng ba lựa chọn; chọn Ở lại giữ cả dữ liệu và focus.
- Chọn Lưu rồi chuyển với một dòng lỗi không điều hướng; với tất cả thành công điều hướng một lần.
- Reload/Back/sign-out có hành vi đã kiểm thử; mọi giới hạn browser phải được ghi rõ trong release note.

## 8. Bảng số liệu, responsive và màn giao dịch vàng

### 8.1 Quy tắc cột số

NumericCell có kind money, quantity, unitPrice, ratio hoặc count. money/quantity hiển thị 2 decimals; unitPrice/ratio theo precision đã chốt với nghiệp vụ. Tất cả số căn phải, tabular-nums, không ellipsis, không wrap giữa chữ số. Header ghi đơn vị USD/g/Oz/Lượng hoặc nhóm cột có nhãn đơn vị đủ rõ.

Mục tiêu min-width tham khảo: money 140–160px, quantity 110–130px, unitPrice 130–150px; giá trị thực dài hơn được làm cột rộng hơn. Test bằng số âm/dương rất lớn và bốn chữ số thập phân, không dựa vào dữ liệu demo ít chữ số. Thêm chiều rộng table bằng tổng min-width cột; wrapper cuộn ngang. Không chỉ thêm overflow-x:auto vì frame hiện đã có thuộc tính này.

Các cột văn bản dài như tên khách, mô tả, ghi chú có thể xuống dòng hoặc thu gọn kèm nút xem đầy đủ. Số liệu không dùng tooltip để thay cho phần đã cắt. Header sticky không che dòng đầu; cột nhận diện sticky có nền opaque đúng theme và đường phân cách nhẹ.

### 8.2 Bố cục desktop của giao dịch vàng

Header gồm H1, ngày giao dịch có nhãn, nút Ngày trước/Hôm nay/Ngày sau và Thêm dòng. Hướng dẫn quy ước dấu nằm ở helper ngắn dưới toolbar, không cạnh tranh với hành động chính. Trên màn hình thấp, helper có thể thu gọn nhưng quy ước vẫn truy cập được bằng keyboard.

Nhóm cột hiển thị theo trật tự công việc:

- Nhận diện: trạng thái, loại giao dịch, khách/NCC, nhân viên. Khi cuộn ngang luôn giữ được tối thiểu trạng thái và khách/mã dòng.
- Hàng hóa: loại vàng, chi tiết scrap, purity, đơn vị, số lượng và gram quy đổi.
- Giá trị: đơn giá, thành tiền và thanh toán; tổng payment có thể hiện ở dòng chính, mở phần phân bổ để xem nhiều dòng.
- Thông tin thêm: điện thoại, ghi chú; vẫn sửa/xem được, không loại bỏ dữ liệu hiện có.
- Thao tác: Lưu ở dòng nháp; Sửa và menu Hủy ở dòng đã lưu; có cột riêng, không dùng ô Ghi chú.

Những thay đổi thứ tự/ẩn bớt cột cần UAT với KT vì tốc độ nhập theo trí nhớ có giá trị. Vòng đầu có thể giữ thứ tự hiện tại, chỉ thêm trạng thái, sửa clipping và tách thao tác. Chế độ compact là tùy chọn cho desktop, không áp lên mobile.

### 8.3 Tổng cuối bảng

Footer hiển thị Mua vào, Bán ra và biến động theo loại vàng với đơn vị rõ. Tổng dựa trên toàn bộ phạm vi ngày/filter đã định nghĩa, không chỉ các dòng đang nhìn thấy vì pagination. Nếu chỉ có tổng trang thì phải ghi “Tổng trang này”; ưu tiên tổng ngày từ server.

Footer sticky chỉ nằm trong vùng grid, không chiếm toàn bộ màn hình điện thoại. Khi nhiều loại vàng, cho mở chi tiết tổng thay vì xuống quá nhiều hàng và che bảng. Lỗi lưu nằm ở dòng và summary phía trên, không chỉ đặt ở góc footer cuối màn hình.

### 8.4 Responsive theo breakpoint

| Chiều rộng | Navigation | Bảng và thao tác |
|---|---|---|
| Từ 1440px | Sidebar mở hoặc theo preference | Bảng nhiều cột, toolbar một đến hai hàng |
| 1024–1439px | Giữ tùy chọn thu gọn | Cuộn trong frame, cột nhận diện sticky |
| 768–1023px | Drawer theo breakpoint hiện có | Toolbar wrap, bảng cuộn, editor rộng |
| Dưới 768px | Drawer, title ưu tiên | Danh sách tóm tắt + chi tiết; bảng đầy đủ tùy chọn |

Không bắt buộc thay breakpoint lg hiện tại 992px chỉ để khớp con số tròn trong bảng; Tech Lead chọn một nguồn breakpoint nhất quán và kiểm thử vùng 991/992/1024. Phạm vi 768–1023 trong bảng mô tả trải nghiệm tablet, không phải yêu cầu hai breakpoint cạnh tranh.

Mỗi giao dịch trên mobile hiển thị khách/NCC, loại mua/bán, ngày, loại vàng, số lượng + đơn vị, thành tiền USD và trạng thái. Chạm mở chi tiết có payment/share/remarks và thao tác theo quyền. Có thể giữ “Xem bảng đầy đủ” để người dùng chuyên sâu đối chiếu nhiều cột.

Viewport tối thiểu phải nghiệm thu: 390×844, 430×932, 768×1024, 1280×720 và 1440×900. Kiểm tra thêm 320px và zoom 200% cho reflow. Bảng dữ liệu được phép cuộn trong vùng của nó; body không tràn ngang.

### 8.5 Hiệu năng và tập dữ liệu

Không tải toàn bộ payment/share của mọi ngày rồi ghép client. Lấy tập transactionId thuộc ngày/phân trang rồi query quan hệ theo tập đó, hoặc dùng nested select/RPC trả dữ liệu theo ngày và phân quyền đúng. Giữ sort ổn định bằng created_at + id nếu giá trị thời gian trùng nhau.

Phân trang không được làm tổng ngày sai. API phải trả count/hasMore hoặc token phù hợp; danh sách bị giới hạn phải thông báo phạm vi đang hiển thị. Chỉ thêm virtualization sau khi đo với dữ liệu lớn và đã kiểm thử focus/editor; virtualization không được unmount mất ô đang nhập.

## 9. Dashboard hành động được

### 9.1 Bố cục mục tiêu

Hàng đầu: “Tổng quan”, ngày dữ liệu, nút làm mới và nhãn thời điểm tải. Hàng hai: bốn KPI hiện có, bổ sung đơn vị và ngữ cảnh. Khối dưới chia desktop khoảng 2/3 cho Giao dịch gần đây và 1/3 cho Việc cần xử lý; mobile xếp Việc cần xử lý trước danh sách. Thao tác nhanh xuất hiện theo quyền.

Không dùng chart tăng trưởng hoặc % so kỳ trước nếu chưa có dữ liệu so sánh cùng phương pháp. Dashboard vòng đầu không cần biểu đồ; diện tích trống được dùng cho thông tin có thể hành động và đủ nguồn dữ liệu.

### 9.2 Định nghĩa KPI và đường dẫn

| KPI | Metadata phải có | Điểm đến đề xuất |
|---|---|---|
| Trị giá tồn kho | USD, loại tồn, ngày số liệu, ngày spot | /inventory?asOf=YYYY-MM-DD |
| Tiền mặt & ngân hàng | USD, ngày chốt; loại trừ clearing | /cash?period=YYYY-MM |
| Đơn cọc chưa giao | Số đơn, phạm vi thời điểm | /reports?report=deposits&date=YYYY-MM-DD |
| Đang phân kim | Gram thuộc PC49, phạm vi thời điểm | /refining nếu có quyền |

Đường dẫn chỉ hiển thị khi capability cho phép vào trang. Với người đọc không có quyền refining.write, có thể dùng báo cáo đọc nếu route đó được triển khai và cấp quyền rõ; không thêm link dẫn đến Forbidden. KPI không có điểm đến hợp lệ vẫn là thông tin tĩnh có mô tả.

Điểm cần xử lý khi thêm bộ chọn ngày: dashboard baseline dùng view tổng inventory và movement refinery không giới hạn theo ngày, trong khi cash lấy today. Không chỉ đổi nhãn ngày ở frontend. Vòng đầu có thể giữ dashboard “hiện tại”; muốn chọn ngày quá khứ phải dùng RPC as-of cho mọi KPI liên quan, cùng cutoff và timezone. Ngày được chọn phải ảnh hưởng dữ liệu thật.

Trị giá tồn kho có spot ngày trước vẫn có thể hợp lệ theo chính sách carry-forward, nhưng phải hiện “Dùng giá ngày …”. Không gán màu cảnh báo hết hạn theo ngưỡng tùy ý; ngưỡng cần cấu hình hoặc xác nhận ở mục 17. Không có spot thì hiển thị “Chưa có giá để định giá”, không ra 0 USD.

### 9.3 Việc cần xử lý

Nguồn có thể tận dụng: bank_import_row chưa resolved, các khoản cash chưa đối chiếu trong kỳ, giá thiếu theo phạm vi đang dùng và lô phân kim chưa hoàn tất. Mỗi mục gồm tiêu đề, số lượng, phạm vi ngày/kỳ, trạng thái và link tới đúng bộ lọc. Chỉ hiển thị việc mà role có thể xem; không lấy count bằng tài khoản đặc quyền rồi lộ số liệu cho role hạn chế.

Vòng đầu chưa có filter đích thì liên kết đến màn liên quan với mô tả rõ; không dùng query parameter giả mà trang bỏ qua. Chỉ đặt nhãn “Quá hạn” khi có due date hoặc rule thời hạn thật. Nếu chỉ biết lô chưa kết thúc, ghi “Chưa hoàn tất”.

Không có việc: “Không có mục cần xử lý trong phạm vi này”. Query lỗi: “Không tải được danh sách cần xử lý” và Retry. Hai trường hợp không dùng chung trạng thái trống.

### 9.4 Giao dịch gần đây và thao tác nhanh

Tải giới hạn 10 giao dịch theo quyền, sort ổn định. Hiện ngày, loại, khách/NCC, vàng, số lượng, USD và trạng thái đã ghi nhận. Link mở đúng ngày và có row anchor/highlight nếu được triển khai. Không công khai phone ở dashboard chỉ vì query có sẵn.

Thao tác nhanh đề xuất: Nhập giao dịch, Cập nhật giá, Nhập sao kê và Xem báo cáo. Chọn theo capability thực tế. GS_US/OC không nhìn thấy nút tạo giao dịch nếu không có goldTxn.write.

### 9.5 Data contract và nghiệm thu

Loader trả từng KPI độc lập theo trạng thái ở mục 4, thêm effectiveDate, priceDate, currency=USD, fetchedAt và destination có kiểm tra quyền. Một KPI lỗi không làm mất KPI khác đã tải thành công; mọi giá trị tổng phụ thuộc nguồn lỗi phải là unavailable/error.

Nghiệm thu: tiền không bao gồm clearing; inventory chỉ PC49; thiếu spot không thành 0; ngày trên KPI khớp query; KPI và trang đích đối chiếu được cùng định nghĩa; bốn vai trò không có link sai quyền; desktop và mobile không cắt số; refresh không đổi filter.

## 10. Các màn nghiệp vụ còn lại

### 10.1 Tiền mặt & ngân hàng

Cash page hiện có bảng số dư, clearing, unplaced bank rows, đối chiếu, khoản vay và phát sinh. Ưu tiên đưa kỳ và tổng tiền thật lên đầu; nút Nhập sao kê là action của role có quyền, không chiếm phần lớn vùng nội dung.

Chia thành các section rõ ràng hoặc tabs giữ được deep link: Số dư / Cần xử lý / Phát sinh. Không làm biến mất clearing hoặc khoản vay khi gom bố cục. Phần đối chiếu phải giữ Our closing, US closing, Difference, Status và Reason đủ đọc; không ép năm cột vào màn điện thoại.

Cash loader hiện giới hạn movements 500 và unplaced 100. Thêm pagination/count hoặc chỉ báo đang xem số dòng giới hạn; không mô tả danh sách giới hạn là toàn bộ lịch sử. Tổng tài khoản vẫn lấy từ RPC đầy đủ, không tính từ 500 dòng đó.

Trên mobile, một tài khoản hiển thị tên, cuối kỳ USD và expandable detail cho đầu kỳ/thu/chi. Form đối chiếu mở rõ label, validation tại chỗ; khi lưu giữ nguyên kỳ và tài khoản đang thao tác. Trạng thái “Không tìm thấy” là trạng thái nghiệp vụ hợp lệ, không đồng nghĩa lỗi kết nối.

### 10.2 Tồn kho

Hiển thị rõ các định nghĩa tồn sổ sách, tồn vật lý và tổng tài sản; không gọi tất cả là “Tồn kho”. Chọn ngày asOf và kỳ báo cáo movement là hai điều khiển khác nhau, giải thích phạm vi ngay cạnh label. Giữ gram/native unit và phân biệt trọng lượng với giá trị.

Số âm cần dấu và màu nhưng không mặc định gắn lỗi nếu nghiệp vụ cho phép. Query failure của inventory_as_of không được biến thành 0 ở từng loại vàng. Báo cáo NXT phải giữ cột điều chỉnh theo chính sách hiện tại, không gộp ẩn vào giá vốn để bảng gọn hơn.

### 10.3 Giá vàng

Giữ lưới theo ngày và loại vàng. Nêu rõ giá thị trường, giá mua bình quân, spot và đơn vị mỗi giá. Nếu giữ autosave onBlur ở PriceGrid thì mỗi ô/dòng phải báo đang lưu/lỗi/đã lưu; điều hướng khi có thay đổi chưa xác nhận đi qua draft guard phù hợp.

Thiếu giá là trạng thái dữ liệu, không là số 0. Kiểm thử decimal precision của đơn giá và spot; không format 2 decimals rồi ghi ngược giá trị đã làm tròn vào dữ liệu cần 4 decimals. Thêm nút lưu rõ nếu autosave không đáp ứng UAT.

### 10.4 Phân kim và quy đổi ngân hàng

Giữ tiến trình SENT → ASSAYED → RECEIVED và thao tác theo quyền. Mỗi bước có ngày, thông số chính và kết quả; trạng thái không chỉ được biểu diễn bằng màu. Phân biệt xác nhận trọng lượng/purity tại assay với lượng Grain thực nhận; không nhập nhằng để rút gọn UI.

Màn quy đổi ngân hàng giữ giá tham chiếu, giá suy ra, độ lệch và tiền bù; các cảnh báo nghiệp vụ đang có phải còn rõ trên mobile. Nhóm dòng theo đối tác khi dữ liệu hỗ trợ. Đây là nâng cấp trình bày, không tự đổi ngưỡng giá hoặc tolerance quy đổi.

### 10.5 Báo cáo và xuất file

ReportHub giữ nhóm Tổng quan / Sổ sách / Vàng / Đối tác và mô tả ngắn đang có. Có thể thêm mục dùng gần đây sau khi có dữ liệu thật; vòng đầu không cần thuật toán đề xuất. Mỗi report có toolbar theo đúng range: month, day hoặc from/to; không hiện điều khiển không được query sử dụng.

UI và export phải dùng cùng parser ngày/kỳ, bộ lọc và loader nghiệp vụ. Hiện page.tsx và report-data.ts là hai nơi map kết quả; ưu tiên gom query/normalization để tránh một bên báo lỗi còn bên kia tải CSV rỗng. File hiện xuất CSV; label phải nói CSV, không hứa workbook XLSX chưa có.

Query report lỗi không trả file thành công rỗng với HTTP 200. Export trả lỗi phù hợp và UI hiển thị thông báo thử lại, giữ filter. Phải xác nhận toàn bộ báo cáo thực thi cutoff ngày thật; không chỉ mang ngày vào filename.

### 10.6 Người dùng, cài đặt, đăng nhập

Phần Users đang có thay đổi chưa commit nên phối hợp người đang thực hiện trước khi refactor. Dùng role label thân thiện kèm mã nếu cần; thêm empty/error state; đổi window.prompt thành dialog đóng tài khoản có lý do. Tách Reset password, Đóng tài khoản và đổi role khỏi các click dễ nhầm.

Input đổi tên đang dùng defaultValue + onBlur; khi mutation lỗi, phải khôi phục hoặc hiển thị rõ giá trị chưa lưu, không để người dùng tưởng server đã nhận. Lỗi copy password cần phản hồi, không chỉ đổi nhãn khi thành công. Không lưu password tạm vào log, ảnh QA hoặc nháp lâu dài.

Giữ luồng bắt buộc đổi mật khẩu ở /password và xử lý tài khoản đóng qua /auth/closed. Không thay luồng auth trong PR style. Kiểm tra login VI/EN, validation, pending, keyboard và focus; không đưa thay đổi branding màn đăng nhập lên trước lỗi thao tác tài chính.

## 11. Loading, lỗi, rỗng và thông báo

### 11.1 Phân loại giao diện

Loading đầu trang dùng skeleton theo hình khối thực và aria-busy, giữ kích thước để tránh layout shift. Tải lại khi đã có dữ liệu có thể giữ số cũ với nhãn “Đang tải lại” và thời điểm tải cũ; không thay bằng số mới cho đến khi thành công. Nếu refresh lỗi, đánh dấu dữ liệu cũ và Retry; không cho hiểu nhầm là snapshot mới.

Empty sau query thành công phải nói rõ phạm vi: “Chưa có giao dịch ngày 05/09/2026”. Empty do filter khác với chưa có dữ liệu hệ thống: trường hợp filter có nút Xóa bộ lọc; trường hợp chưa tạo dữ liệu có action theo quyền. Error dùng lời giải thích và retry; thiếu spot dùng unavailable với action Cập nhật giá nếu có quyền.

### 11.2 Next.js boundaries

Đề xuất thêm loading.tsx/error.tsx theo route group hoặc màn có tải dài, chọn granularity để lỗi một widget không phá cả AppShell. error.tsx xử lý unexpected render/load failures theo guide phiên bản cài đặt. Lỗi nghiệp vụ dự kiến trả object từ action và render inline; không dùng error boundary để xử lý mọi validation.

Exception trong event handler/async transition vẫn cần xử lý phù hợp ở component/action. Không giả định một error.tsx sẽ tự bắt toàn bộ lỗi mọi callback. Log server dùng mã trace và context tối thiểu; message cho người dùng không chứa SQL constraint nội bộ nếu có thể map sang messageKey ổn định.

### 11.3 Bộ thông báo VI/EN đề xuất

| Message key đề xuất | Tiếng Việt | English |
|---|---|---|
| common.retry | Thử lại | Retry |
| common.loadFailed | Không tải được dữ liệu | Could not load data |
| common.lastLoaded | Tải thành công lúc | Last loaded at |
| txn.state.draft | Chưa lưu | Unsaved |
| txn.state.saving | Đang lưu | Saving |
| txn.state.saved | Đã lưu | Saved |
| txn.state.unknown | Chưa xác định kết quả lưu | Save status unknown |
| txn.draft.stay | Ở lại | Stay |
| txn.draft.discard | Bỏ thay đổi | Discard changes |
| txn.draft.saveAndLeave | Lưu rồi chuyển | Save and continue |
| txn.correct.confirm | Xác nhận sửa giao dịch | Confirm correction |
| txn.correct.conflict | Giao dịch đã được thay đổi. Hãy tải bản mới. | This transaction has changed. Load the latest version. |
| txn.remarks.view | Xem ghi chú đầy đủ | View full remarks |
| home.priceDate | Ngày giá áp dụng | Price date |
| home.attention | Việc cần xử lý | Needs attention |
| table.fullView | Xem bảng đầy đủ | View full table |

Đây là key/value đề xuất; rà soát key hiện có trước khi thêm để tránh trùng ý nghĩa. Nội suy ngày/số dùng formatter chung, không nối câu VI rồi tái sử dụng nguyên chuỗi cho EN. Role code, enum nghiệp vụ có thể giữ để đối chiếu nhưng cần tên hiển thị được dịch.

## 12. Accessibility, bàn phím và định dạng

### 12.1 Bàn phím và focus

Giữ skip link và một main landmark. Link là link, action là button; không dùng div onClick cho thao tác quan trọng. Table có caption hoặc accessible name, th có scope phù hợp; field nhập có label chứa ngữ cảnh dòng để screen reader phân biệt nhiều ô cùng loại.

Tab đi theo thứ tự công việc; không đưa focus vào control ẩn. Sau Thêm dòng, focus trường đầu cần nhập. Sau lỗi validation, focus trường lỗi đầu tiên và giữ scroll để nhìn thấy. Sau dialog đóng, focus trở về nút gọi hoặc dòng liên quan nếu danh sách đã thay đổi.

Thông báo saving/saved dùng role=status hoặc aria-live polite. Lỗi chặn lưu dùng mô tả liên kết aria-describedby; alert chỉ khi cần, không đọc lặp một thông báo mỗi keystroke. Không dùng ký hiệu checkmark đơn độc để thể hiện trạng thái đã lưu cho screen reader.

### 12.2 Quy ước số, ngày và đơn vị

Giữ format số en-US hiện tại ở vòng đầu để không thay thói quen kế toán: 1,234.56, USD rõ ở header hoặc giá trị. Chuyển ngôn ngữ nhãn không tự đổi dấu phân cách nhập số. Nếu muốn format theo locale, phải làm parser/formatter/export thống nhất và có UAT riêng; không parseFloat chuỗi có dấu phân cách hàng nghìn.

Ngày lưu là ISO date YYYY-MM-DD; ngày hiển thị có thể DD/MM/YYYY cho VI và định dạng rõ ràng cho EN, nhưng không thay date-only bằng timestamp qua timezone một cách vô ý. Validate cả ngày lịch thực, không chỉ regex: 2026-02-31 phải bị từ chối, from không lớn hơn to.

Múi giờ ngày nghiệp vụ chưa được chốt trong phạm vi review. Baseline có new Date().toISOString() tức cutoff UTC; người dùng làm việc cả Việt Nam và US. Tập trung hàm xác định businessDate; chưa đổi mặc định trước khi trả lời D-01 ở mục 17. Chọn ngày thủ công vẫn phải hoạt động đúng xuyên múi giờ.

### 12.3 Reflow và theme

Kiểm thử zoom 200%, nội dung tiếng Việt dài, màn thấp 720px, touch và reduced-motion. Popover, dropdown, sticky header/cột, backdrop dialog đều theo cùng theme. Bảng cuộn ngang phải có dấu hiệu còn nội dung và có thể cuộn bằng bàn phím; focus không bị sticky header/footer che.

Mục tiêu là đạt các tiêu chí accessibility nêu trong tài liệu; không tuyên bố chứng nhận WCAG toàn ứng dụng chỉ từ checklist này. Kiểm tra tương phản, focus và screen reader cần có bằng chứng QA riêng.

## 13. Backend, dữ liệu và triển khai an toàn

### 13.1 Phạm vi migration

Migration mới cần định nghĩa RPC atomic create/correct, cơ chế idempotency, liên kết correction và version nếu schema hiện tại chưa đủ. Tên/số migration lấy số tiếp theo sau khi đồng bộ branch; không mặc định chiếm 0054 vì workspace có migration 0053 chưa commit và có thể có nhánh khác đang chạy.

Không sửa nội dung migration đã áp dụng để tránh lệch lịch sử. Hàm cũ có thể giữ làm wrapper trong giai đoạn chuyển tiếp; frontend chỉ chuyển sang contract mới khi RPC đã có và test pass. RLS/grants của bảng mới phải được kiểm thử đủ bốn role và tài khoản bị đình chỉ.

### 13.2 Dữ liệu dở dang đã tồn tại

Trước rollout atomic save, viết truy vấn chẩn đoán read-only trên môi trường được phép để tìm gold_txn thiếu journal_entry_id, thiếu payment/share không phù hợp nghiệp vụ, hoặc có dấu hiệu retry trùng. Đây là danh sách cần đối chiếu, không bằng chứng mọi dòng đều sai; một số trạng thái có thể hợp lệ.

Không tự delete/post/void dữ liệu tìm thấy. Lập báo cáo tổng hợp không chứa thông tin nhạy cảm không cần thiết, đối chiếu với người phụ trách kế toán và xử lý qua quy trình riêng. Sửa UI không được âm thầm thay đổi kỳ đã chốt.

### 13.3 Invalidation và nhất quán đọc

Sau create/correct/void thành công, cập nhật grid từ canonical response và revalidate dữ liệu ảnh hưởng: ngày giao dịch, dashboard, inventory, journal, cash và báo cáo liên quan. Chọn path/tag theo guide Next đang cài; không gọi refresh mọi nơi để che lỗi contract.

Với correction khác ngày, phải invalidation cả ngày gốc, ngày đảo và ngày thay thế. Các view as-of trước/sau ngày đảo phải phản ánh đúng lịch sử. Không ép inventory của ngày quá khứ bằng trạng thái giao dịch hiện tại nếu report cần lịch sử movement.

### 13.4 Logging và số đo vận hành

Log operation, requestId, result code, duration và transactionId khi được phép; không log password, phone, access token hoặc toàn bộ payload tài chính. Có thể đo tỷ lệ error/unknown, số conflict và thời gian mutation để kiểm tra rollout, nhưng chưa có baseline nên không ghi một tỷ lệ cải thiện giả định.

Đề xuất mục tiêu kiểm thử tương tác: phản hồi thị giác sau click trong 100ms; filter không nhảy bố cục; thời gian server được đo trên staging với data fixture được công bố. SLA truy vấn cần lấy số đo trước/sau, không đặt cam kết ms cho production từ máy review.

## 14. Kế hoạch kiểm thử và tiêu chí nghiệm thu

### 14.1 Môi trường và dữ liệu

Dùng database test cô lập/PGlite cho transaction và constraints; staging riêng cho auth/RLS/E2E. Không dùng .env.local đang trỏ live mà chưa xác nhận đích. Các script verify có thể ghi dữ liệu nên đọc code script trước khi chạy.

Fixture chỉ dùng dữ liệu tổng hợp: tên khách TEST-CUSTOMER-A/B, mã đơn TEST-TXN, email thuộc miền test; không chép khách thật, số điện thoại, số tài khoản hay password từ workbook. Seed đủ PO, SALE, DEPOSIT/PICKUP, kỳ mở/khóa, lô phân kim, thiếu spot, clearing âm, số 0 và số rất lớn.

Tập số giao diện gồm 0.00, -0.00 cần chuẩn hóa, 1,234.56, -1,234,567,890.12; trọng lượng 0.01 và 123,456.78; đơn giá bốn decimals. Kiểm tra số lớn là test hiển thị; không mặc định đó là giới hạn nghiệp vụ hợp lệ.

### 14.2 Test hồi quy bắt buộc cho transaction

| ID | Ca kiểm thử | Kết quả bắt buộc |
|---|---|---|
| TX-01 | Tạo PO hợp lệ | Một txn, journal/inventory đúng |
| TX-02 | Tạo SALE hợp lệ | Dấu và giá trị chuẩn đúng |
| TX-03 | Ba payment trở lên | Không mất dòng thanh toán |
| TX-04 | Hai nhân viên, đủ 100% | Tỷ lệ giữ nguyên sau reload |
| TX-05 | Payment thiếu method | Lỗi tại trường; chưa commit |
| TX-06 | Share không đủ 100% | Không có dữ liệu tài chính một phần |
| TX-07 | Lỗi insert payment | Rollback txn/share/journal/movement |
| TX-08 | Lỗi post hoặc thiếu giá | Rollback toàn bộ phần tài chính |
| TX-09 | Hai request cùng key/payload | Cùng một transactionId |
| TX-10 | Cùng key, payload khác | REQUEST_KEY_REUSED |
| TX-11 | Timeout sau commit rồi retry | Trả kết quả cũ, không tạo thêm |
| TX-12 | Exception ở client | Dòng không mắc saving vô hạn |
| TX-13 | Mở sửa rồi Cancel | Không có mutation |
| TX-14 | Sửa thành công | Một đảo + một thay thế, có liên kết |
| TX-15 | Replacement post thất bại | Gốc chưa void, số dư giữ nguyên |
| TX-16 | Hai người sửa đồng thời | Một thành công, một conflict |
| TX-17 | Gốc đã void | Không sửa lần hai ngoài policy |
| TX-18 | Kỳ gốc khóa | Bị chặn hoặc ngày đảo hợp lệ rõ ràng |
| TX-19 | Deposit có pickup | Không phá quan hệ phụ thuộc |
| TX-20 | Bấm lưu kèm blur/Enter | Không lưu trùng |
| TX-21 | Remarks dài có dấu | Reload vẫn xem đủ nội dung |
| TX-22 | Lưu xong revalidation | Tổng không đếm đôi |

Fault injection cần kiểm tra cả các bảng liên quan và giá trị tổng, không chỉ assert toast “Lỗi”. Idempotency/concurrency cần test database thật hỗ trợ các connection đồng thời; nếu PGlite harness không mô phỏng đủ concurrency thì dùng PostgreSQL staging test cô lập và ghi rõ giới hạn.

### 14.3 Test frontend, dữ liệu và quyền

| ID | Ca kiểm thử | Kết quả bắt buộc |
|---|---|---|
| UI-01 | Cash ở 390px | Toàn bộ chữ số xem được |
| UI-02 | Bảng ở 1280×720 | Header/footer không che ô đang nhập |
| UI-03 | Light/dark trên mọi bảng | Sticky cell và dropdown đúng theme |
| UI-04 | VI/EN, nhãn dài | Không đè control hoặc mất nhãn |
| UI-05 | Chỉ dùng keyboard | Truy cập và hoàn tất thao tác chính |
| UI-06 | Đang gõ IME nhấn Enter | Không submit ngoài ý định |
| UI-07 | Đổi ngày khi dirty, chọn Stay | Nháp và ngày cũ giữ nguyên |
| UI-08 | Save and continue, một dòng lỗi | Không điều hướng, focus lỗi |
| UI-09 | Discard khi dirty | Bỏ nháp, không ghi DB |
| UI-10 | Reload/Back khi dirty | Guard theo contract và giới hạn browser |
| UI-11 | Blank draft tự sinh | Không cảnh báo rời trang sai |
| UI-12 | Cash query error | Không hiện 0 thay lỗi |
| UI-13 | Inventory query error | Không định giá từ gram=0 giả |
| UI-14 | Spot thiếu/cũ | Unavailable hoặc priceDate rõ |
| UI-15 | Một KPI lỗi | KPI độc lập khác vẫn đọc được |
| UI-16 | Filter không có kết quả | Empty có phạm vi và reset filter |
| UI-17 | Refresh fail có số cũ | Ghi rõ dữ liệu cũ và retry |
| UI-18 | GS_US/OC mở Cash | Menu đọc đúng, mutation theo quyền |
| UI-19 | Role không được phép gọi action | Server/DB từ chối dù bypass UI |
| UI-20 | Tài khoản đóng/đổi mật khẩu bắt buộc | Giữ đúng luồng auth hiện tại |
| UI-21 | Quá 500 movements/100 unplaced | Pagination hoặc giới hạn được nói rõ |
| UI-22 | Payment/share nhiều ngày | Ngày đang xem không mất quan hệ |
| UI-23 | Export cùng filter màn hình | Cùng số, phạm vi, loại report |
| UI-24 | Export query fail | Không tải CSV rỗng như thành công |
| UI-25 | Ngày không tồn tại/from > to | Validation rõ, không normalize im lặng |
| UI-26 | USD/g/Oz/Lượng và số 0 | Đơn vị, dấu, precision đúng |
| UI-27 | Zoom 200%, width 320px | Reflow; body không cuộn ngang |
| UI-28 | Dropdown/dialog trong bảng cuộn | Không bị clip, focus return đúng |
| UI-29 | Nhiều tab/đổi user nếu có lưu nháp | Không lộ hoặc trộn nháp giữa user |
| UI-30 | Màn Users rename thất bại | Hiển thị chưa lưu hoặc phục hồi giá trị |

### 14.4 Lệnh và bằng chứng cần thu

Lệnh đã có: npm ci; npm run typecheck; npm run lint; npm run test:low-memory; npm run build. Khi chỉ sửa frontend cơ bản, chọn test liên quan; khi đổi atomic SQL/correction, phải chạy cả nhóm SQL liên quan và suite hồi quy đầy đủ theo CI. Không dùng kết quả 33 test ở review làm bằng chứng tính năng mới đã pass.

Unit test hiện có cần giữ: tests/lib/design-tokens.test.ts, stylesheets.test.ts, navigation.test.ts, i18n.test.ts, roles.test.ts và units.test.ts. Đề xuất thêm tests cho reducer nháp, parser ngày/số, data state, request contract và RPC atomic/correction. Test i18n hiện kiểm tra key parity, chưa tự chứng minh mọi literal trong JSX được dịch; QA và lint rule có thể bổ sung đúng nhu cầu.

Nhóm SQL liên quan: gold-txn, txn-journal, void-txn, deposit, inventory, period, prices-coverage, audit và user-admin khi ảnh hưởng quyền. Script tham khảo đã có: verify-grid.mjs, verify-correct.mjs, verify-payments.mjs, verify-void.mjs, verify-reports.mjs, verify-export.mjs, verify-rls.mjs và shoot-ui.mjs. Chỉ chạy trên môi trường test được chỉ định sau khi đọc script.

Mỗi PR cần: mô tả trigger trước/sau, test ID đã chạy, kết quả lệnh và commit hash, ảnh VI/EN light/dark ở viewport liên quan, ghi rõ ca chưa chạy. Ảnh chụp phải là bản code cuối của PR; không tái sử dụng ui-shots cũ làm bằng chứng pass.

### 14.5 Definition of Done của đợt nâng cấp

- Các finding P1 có test hồi quy và đã được xử lý; không còn luồng sửa đảo gốc trước xác nhận.
- Không có chữ số tài chính bị ellipsis tại các viewport nghiệm thu.
- Tất cả mutation mới có quyền ở server/DB và xử lý error/unknown/idempotency theo contract.
- Dashboard và báo cáo phân biệt lỗi, trống, thiếu giá và số 0; metadata ngày/đơn vị đúng.
- Ghi chú/payment/share hiển thị đủ sau lưu; draft guard hoạt động theo lựa chọn đã chốt.
- Nhãn mới có VI/EN; keyboard/focus/reduced-motion/zoom đã được QA.
- CI và kiểm tra liên quan pass; screenshot mới có ngày, viewport, theme và role.
- KT xác nhận nhập liệu đủ nhanh; GS_US/OC xác nhận dashboard/report dễ đọc theo quyền.
- Migration và rollback có rehearsal trên staging; không chỉnh dữ liệu production ngoài quy trình được chấp thuận.

## 15. Backlog để chia task

### 15.1 Danh mục ticket

| Ticket | Nội dung | Owner chính | Phụ thuộc |
|---|---|---|---|
| T01 | Chốt contract, baseline và test fixture | Tech Lead + QA | Không |
| T02 | Atomic create + idempotency | Backend | T01 |
| T03 | Atomic correction + version/link audit | Backend | T02 |
| T04 | State per-row, validation, Save/Retry | Frontend | T01, tích hợp T02 |
| T05 | Editor sửa/hủy và dirty guard | Frontend | T03, T04 |
| T06 | Numeric table, remarks và action column | Frontend | T01 |
| T07 | Data state, loader lỗi và export parity | Fullstack | T01 |
| T08 | Token chữ/spacing, shared controls | Frontend | T06 thống nhất API |
| T09 | Dashboard KPI context + attention/recent | Fullstack | T07, T08 |
| T10 | Cash/report toolbar và pagination | Fullstack | T06, T07 |
| T11 | Mobile summary/detail | Frontend | T05, T06, T08 |
| T12 | Menu theo quyền đọc, mutation guards | Fullstack | T01, chốt D-04 |
| T13 | E2E, a11y, visual regression và UAT | QA + Frontend | T02–T12 |
| T14 | Migration rehearsal, rollout và theo dõi | Tech Lead + Backend | T13 |

T01 đầu ra là contract đã review, fixture và danh sách quyết định D-01…D-07 có owner; không phải một giai đoạn chỉ họp. T02/T03 đầu ra có migration và SQL tests. T04/T05 đầu ra có reducer/component và E2E. T06 là PR độc lập có thể xử lý sớm lỗi cắt số và ghi chú. T07 không cần chờ dashboard mới để sửa số 0 giả. T08 không thay logic tiền. T09 chỉ thêm widget có query đúng scope. T13 bắt đầu viết ca và fixture từ T01, không đợi toàn bộ UI xong mới tham gia.

### 15.2 Ước lượng lập kế hoạch

Ước lượng sơ bộ theo công, chưa là cam kết lịch: T01 1–2 ngày công; T02 3–5; T03 3–5; T04 2–4; T05 3–5; T06 1–2; T07 2–4; T08 1–2; T09 2–4; T10 2–3; T11 3–5; T12 1–2; T13 3–5; T14 1–2. Tổng khoảng 28–50 ngày công, gồm độ bất định backend và kiểm thử; không cộng cơ học thành thời gian lịch vì có thể làm song song và chia scope.

Tech Lead cần hiệu chỉnh sau T01 theo chất lượng test harness, dữ liệu staging, API pagination, tình trạng migration 0053 và phạm vi mobile được chọn. Nếu cần bản nhỏ trước: ưu tiên T06 + T07 để sửa hiển thị, đồng thời làm T02/T03/T04/T05 để đóng rủi ro lưu/sửa; không phát hành redesign che mất các P1 chưa xử lý.

### 15.3 Thứ tự PR đề xuất

PR-A: thêm fixture và test hồi quy cho lỗi cắt số, remarks, load-error, save/correction atomic. PR-B: sửa numeric table và remarks/action column, ảnh before/after. PR-C: data state/loader và export errors. PR-D: migration atomic create + idempotency, chưa chuyển client. PR-E: correction RPC + concurrency/dependency tests. PR-F: client row state/editor/dirty guard dùng contract mới. PR-G: typography/shared controls. PR-H: dashboard/cash/report improvements. PR-I: mobile và visual regression. PR-J: rollout notes và UAT sign-off.

Các PR có thể điều chỉnh để tránh test cố ý fail làm main đỏ: viết test cùng fix trong PR hoặc giữ ở branch feature trước merge. Không merge một test fail đã biết vào main với lý do để làm baseline.

## 16. Danh sách file cần thay đổi và phạm vi review

### 16.1 Frontend đang có

- src/components/gold/TxnGrid.tsx: tách state/render/action; sửa remarks; tích hợp atomic save/correct; nhãn và guard.
- src/components/gold/TxnGrid.module.css: chiều rộng cột, sticky, kích thước control, footer và mobile.
- src/components/ledger/Ledger.tsx: primitive số, state và props tương thích; không thay public API đồng loạt nếu không cần.
- src/components/ledger/Ledger.module.css: bỏ ellipsis cho numeric, min-width, typographic scale và frame scrolling.
- src/components/PageHeader.tsx: actions wrap, title hierarchy và hỗ trợ toolbar nhất quán.
- src/components/AppShell.tsx: điều hướng qua dirty guard, group mở theo route, xử lý quyền/menu và header mobile.
- src/components/home/Overview.tsx: KPI metadata, trạng thái độc lập, link theo role và section mới.
- src/components/cash/CashView.tsx: bố cục, cột số, kỳ/filter, pagination, permission cho action.
- src/components/reports/ReportView.tsx và ReportHub.tsx: toolbar, dữ liệu lỗi, export feedback và navigation.
- src/components/prices/PriceGrid.tsx: trạng thái autosave và precision hiển thị nếu nằm trong scope đã chốt.
- src/components/settings/UsersView.tsx: phối hợp branch hiện tại; dialog, mutation error, literal i18n.
- src/app/globals.css, src/app/providers.tsx, src/lib/design/tokens.ts: token kích thước và màu đồng bộ, xóa trùng sau audit usage.
- src/lib/i18n/dictionary.ts và src/lib/nav.ts: key mới, labels và capability menu đã duyệt.

### 16.2 Server và database

- src/app/(app)/gold-transactions/actions.ts: dùng một RPC cho một ý định tài chính; schema shared; auth; error mapping; invalidation.
- src/app/(app)/gold-transactions/page.tsx: query theo ngày, lấy đủ payment/share/quan hệ, giữ key ngày có guard.
- src/app/(app)/page.tsx: loader KPI giữ error/metadata, nguồn as-of đồng nhất khi có date picker.
- src/app/(app)/cash/page.tsx và inventory/page.tsx: error states, parser ngày và pagination.
- src/app/(app)/reports/page.tsx, reports/export/route.ts và src/lib/domain/report-data.ts: dùng chung data normalization và xử lý query error.
- supabase/migrations/: migration mới atomic/idempotency/correction/version/RLS; giữ migration đã áp dụng.
- tests/lib và tests/sql: test theo mục 14; scripts/verify-* chỉ chỉnh khi đã hiểu thao tác dữ liệu của script.

### 16.3 Kiểm soát thay đổi đang có

Baseline có sửa package.json, app layout, settings/login, currentUser, dictionary, nav; đồng thời có UsersView, PasswordView, route password/auth, migration 0053 và test user-admin mới. Không reset/stash/xóa các thay đổi đó chỉ để làm sạch review. Đồng bộ với tác giả trước khi chia PR đụng cùng file; ghi rõ commit tích hợp sau cùng trong kết quả QA.

## 17. Các quyết định cần chốt và giả định làm việc

### D-01 — Múi giờ/ngày nghiệp vụ

Owner: người phụ trách kế toán + Tech Lead. Cần chốt timezone IANA của ngày giao dịch PC49, cutoff ngày và cách người Việt Nam xem ngày US. Trước khi chốt, không đổi ngày mặc định hiện tại bằng timezone máy người dùng; vẫn cung cấp chọn ngày rõ ràng. Quyết định này chặn rollout date-default mới, không chặn sửa clipping/remarks/atomicity.

### D-02 — Lưu bằng nút hay autosave

Owner: KT đại diện + Frontend. Đề xuất nút Lưu dòng và Ctrl/Cmd+Enter, Enter thường dùng theo ngữ cảnh control; bỏ autosave chỉ dựa vào blur ghi chú. Nếu KT cần giữ Enter hiện tại, làm UAT với IME/autocomplete và viết acceptance test cụ thể. Backend atomic và idempotency bắt buộc ở cả hai phương án.

### D-03 — Phạm vi sửa giao dịch có quan hệ

Owner: Backend + kế toán. Chốt loại nào được correction tổng quát, loại nào đi qua flow riêng; ngày đảo khi kỳ gốc khóa; có cho đổi txn type/date/gold type hay không. Trước khi đủ dữ liệu, chỉ mở sửa cho nhóm đã chứng minh an toàn, hiển thị lý do cho nhóm còn lại; không suy đoán quan hệ từ UI.

### D-04 — Quyền đọc Cash và quyền mutation

Owner: chủ sản phẩm + Tech Lead. Đề xuất GS_US/OC có report.read được thấy menu Cash như quyền trang hiện tại; Import/Reconcile được kiểm tra riêng theo action/database. Cần đối chiếu permission SQL thực tế trước khi đổi nav. Không lấy mô tả role trong tài liệu cũ để tự mở quyền period close hoặc user admin.

### D-05 — Phục hồi nháp sau đóng browser

Owner: chủ sản phẩm + Tech Lead. Vòng đầu thực hiện guard; nếu cần autosave nháp server-side thì thêm lưu nháp có RLS, retention và version. Chốt thời hạn giữ nháp và hành vi nhiều tab. Không mặc định lưu giao dịch/phone lâu dài trong localStorage.

### D-06 — Ngưỡng cảnh báo giá cũ và lô chậm

Owner: kế toán + GS_US. Chốt spot được carry-forward bao lâu và lô nào được xem là quá hạn. Trước khi chốt, chỉ hiển thị ngày giá và tuổi lô/ngày gửi, không tạo màu đỏ “Quá hạn” theo số ngày tùy ý.

### D-07 — Ưu tiên mobile và density

Owner: chủ sản phẩm + KT/GS_US. Đề xuất desktop phục vụ nhập nhiều dòng, mobile phục vụ xem/kiểm tra và sửa một giao dịch. Nếu mobile phải nhập hàng loạt, cần thêm UAT và effort riêng. Chốt default density sau thử mẫu; không ép mọi người dùng vào cỡ chữ compact.

Các quyết định này là đầu vào triển khai cho team, không phải yêu cầu người dùng phải trả lời ngay để tài liệu có giá trị. Những ticket độc lập vẫn thực hiện được theo backlog.

## 18. Rollout, rollback và bàn giao

### 18.1 Trình tự rollout

Chụp baseline chỉ số/test và xác nhận môi trường. Merge các sửa hiển thị độc lập sau QA. Deploy migration additive cho RPC mới trên staging; chạy atomic/concurrency/RLS tests. Tích hợp client mới, chạy UAT KT/GS_US/OC. Rehearse migration và phương án tắt mutation trước khi đưa production. Rollout một nhóm người dùng thử trước nếu cơ chế cấu hình hiện tại hỗ trợ.

Theo dõi save success/error/unknown/conflict và đối chiếu số transaction/journal/inventory bằng quy trình read-only. Tiếp nhận feedback theo màn/ngày/requestId, tránh chụp dữ liệu cá nhân không cần thiết. Sửa lỗi theo severity, không dùng test fixture/demo data trong production để chứng minh nút chạy.

### 18.2 Rollback thực tế

Rollback UI thuần có thể quay về version giao diện trước nếu vẫn tương thích schema. Với luồng atomic tài chính, không rollback về cách client void trước rồi mới tạo replacement. Khi RPC hoặc client mới có lỗi nghiêm trọng, ưu tiên tạm khóa thao tác ghi bị ảnh hưởng và giữ chế độ đọc, sau đó sửa tiến; không phục hồi hành vi P1 đã biết.

Migration additive giữ lại bảng request/correction và audit khi rollback app. Không drop dữ liệu audit hoặc hoàn tác các giao dịch đã commit bằng migration rollback. Nếu cần đảo một giao dịch nghiệp vụ, thực hiện quy trình kế toán có lý do và ngày hợp lệ, độc lập với rollback phần mềm.

### 18.3 Checklist bàn giao cho team vận hành

- Có release note mô tả cách Lưu, Sửa, Hủy và rời trang khi còn nháp bằng VI/EN.
- Có ảnh mới của Dashboard, Gold transactions, Cash, Reports ở desktop/mobile, không có dữ liệu thật ngoài phạm vi được phép.
- Có danh sách RPC/schema thay đổi và version migration đã áp dụng.
- Có test report gồm pass/fail/not-run và các quyết định còn mở.
- Có hướng dẫn nhận diện unknown save và tra requestId, tránh người dùng bấm nhập lại tạo ý định mới.
- Có người chịu trách nhiệm xử lý lỗi sau rollout và điều kiện tạm tắt mutation.
- Có xác nhận của KT về nhập liệu và của GS_US/OC về đọc số, quyền, đơn vị và ngày dữ liệu.

## 19. Nguồn đối chiếu và giới hạn tài liệu

Nguồn chính là code workspace ngày 05/09/2026 ở HEAD đã ghi đầu tài liệu cùng các thay đổi chưa commit. Các đường dẫn đều tương đối với PC49_WEBAPP, trừ business specification nằm ở thư mục PC49-Accounting kế bên. Người nhận tài liệu cần quyền repo để mở source; không cần workbook khách hàng để triển khai phần UI cơ bản.

- AGENTS.md: bắt buộc đọc guide Next.js cục bộ trước khi viết code.
- README.md và package.json: stack, scripts, convention numeric/i18n/audit.
- ../PC49-Accounting/docs/00-business-specification.md, v1.0 ngày 27/08/2026: USD, precision, quy ước dấu, inventory views và phạm vi nghiệp vụ; các điểm cũ lệch code đã được nêu ở mục 2.4.
- src/components/gold/TxnGrid.tsx và TxnGrid.module.css: input, commit, correctRow, cancelRow, rendering và layout grid.
- src/app/(app)/gold-transactions/actions.ts và page.tsx: quy trình lưu, RPC void, query theo ngày và key remount.
- supabase/migrations/0015_txn_to_journal.sql, 0034_void_gold_txn.sql, 0040_cash_total.sql, 0046_payment_is_not_limited_to_two.sql: posting/void/cash/payments tại các mốc schema; khi triển khai phải đọc mọi migration mới hơn có sửa cùng đối tượng.
- src/components/ledger/Ledger.tsx, Ledger.module.css, src/app/globals.css và src/lib/design/tokens.ts: bảng, format, màu và primitive UI.
- src/components/home/Overview.tsx, src/app/(app)/page.tsx: KPI và loader dashboard.
- src/app/(app)/cash/page.tsx, inventory/page.tsx, reports/page.tsx, reports/export/route.ts: phạm vi query, cap danh sách, export.
- src/lib/domain/reports.ts, report-data.ts, src/lib/auth/roles.ts và src/lib/nav.ts: report catalog, data mapping, capability và menu.
- ui-shots/light-dashboard.png, phone-light-cash.png, phone-light-gold-transactions.png, dark-gold-transactions.png và report-hub.png: ảnh tham chiếu bố cục cũ, không là bằng chứng code mới đã chạy đúng.
- node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md và 10-error-handling.md: guide phiên bản cài tại workspace, không thay bằng giả định từ phiên bản khác.

Tài liệu không khẳng định đã kiểm toán toàn bộ bảo mật, kế toán, dữ liệu production hoặc hiệu năng. Các test, RPC mới, màn hình mới và mục tiêu accessibility mô tả công việc cần thực hiện. Các điểm không tái hiện runtime được ghi theo bằng chứng code và phải được xác nhận bằng regression test trước khi đóng ticket.
