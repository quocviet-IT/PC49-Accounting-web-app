# Sổ giao dịch vàng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/gold-transactions` hiện toàn bộ giao dịch (mới nhất trước), lọc trên database theo khoảng ngày và các bộ lọc hiện có, dải tổng theo bộ lọc, phân trang, xuất Excel.

**Architecture:** Migration 0068 thêm `fold_search`, `gold_txn_ledger_match`, `gold_txn_ledger`, `gold_txn_ledger_totals` (SECURITY INVOKER). Module thuần `ledgerQuery.ts` đọc/ghi bộ lọc trên URL. Trang server gọi hai RPC; `TxnScreen` điều khiển bộ lọc bằng URL. Route `/gold-transactions/export` đọc RPC từng lượt 1.000 dòng, trả CSV qua `lib/export/csv.ts`. Đặc tả: `docs/superpowers/specs/2026-09-14-so-giao-dich-vang-design.md`.

**Tech Stack:** PostgreSQL/PGlite, Next.js 16, React 19, antd 6, vitest, Playwright.

## Global Constraints

- Migration số 0068, kết thúc bằng `NOTIFY pgrst, 'reload schema';` và dòng `schema_migrations`.
- Chạy `npm run migrate` lên database thật **trước** khi đẩy code.
- Link cũ `?date=YYYY-MM-DD` = `from=to=date`. Form nhập: đang xem một ngày thì mặc định ngày đó, không thì hôm nay; sửa giao dịch giữ ngày của dòng.
- Tìm kiếm cùng quy tắc `normalizeTransactionSearch`: bỏ dấu, hoa thường, mọi ký tự không phải chữ/số.
- Chữ giao diện qua i18n (vi + en). Màu chỉ từ biến `--pc-*`.
- Commit không có dòng Claude/Codex. Đẩy lên main chỉ khi cổng xanh.
- Trang `/gold-transactions` (mặc định) dựng xong ≤ 800 ms trên Production.

## Tasks

- [ ] **Task 1 — Migration 0068 + `tests/sql/gold-ledger.test.ts`.** Test đỏ trước (hàm chưa có), rồi migration. Test: fold_search (bảng chữ có dấu đủ 134 ký tự; "KHÁNH"→"khanh"; "090 123 4567"→"0901234567"), khoảng ngày tính cả hai đầu, từng bộ lọc, nhân viên khớp người chia phần, thanh toán, trạng thái (cọc có phiếu giao hàng = locked), dòng đã huỷ không có, thứ tự + limit/offset + total_count, totals khớp tay, gọi được bằng `asRole` với tài khoản KT. Commit.
- [ ] **Task 2 — `src/components/gold/ledgerQuery.ts` + `tests/lib/ledger-query.test.ts`.** `parseLedgerQuery(params)`, `ledgerSearch(query, patch)`, `presetRange(preset, today)`, `LEDGER_TXN_TYPES`, `PAGE_SIZES`. Test đỏ trước. Commit.
- [ ] **Task 3 — Xuất Excel.** `src/components/gold/ledgerCsv.ts` (thuần: dòng → `Sheet`) + test; route `src/app/(app)/gold-transactions/export/route.ts` (quyền `goldTxn.write`, lượt 1.000 dòng). Commit.
- [ ] **Task 4 — Trang + `TxnScreen`.** Page gọi `gold_txn_ledger` + `gold_txn_ledger_totals` + danh mục; `SavedRow` thêm `txn_date`, `partner_phone`; TxnScreen: thanh lọc URL (khoảng ngày, nút nhanh, loại, vàng, nhân viên, thanh toán, trạng thái, tìm có debounce 400 ms), dải tổng, cột Ngày, phân trang server, nút Xuất Excel; bỏ `filterGoldTransactions` + test cũ (giữ `normalizeTransactionSearch`); khoá i18n mới trong `ui-gold.ts`; render test lỗi tải / rỗng. Commit.
- [ ] **Task 5 — Ô Ngày trong `TxnForm`.** Prop `defaultDate`; field `txnDate` (input date, bắt buộc); sửa giao dịch thì ngày của dòng, khoá. Commit.
- [ ] **Task 6 — Kiểm chứng + đẩy lên.** `scripts/verify-ledger.mjs` + `npm run verify:ledger`; `probe-speed` thêm `/gold-transactions`; cổng (test, tsc, lint, build); trình duyệt trên dev (`verify:grid`, `verify:layout`, `verify:ledger`); `npm run migrate`; đẩy lên; trên Production: `probe:speed`, `verify:ledger`, `verify:screens`; ghi kết quả vào đặc tả.
