# Giao diện chuẩn app kế toán — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Màu chủ đạo xanh dương, một hệ nút antd có icon thay cho mọi nút tự viết, thao tác trong bảng là icon, nhãn loại giao dịch có màu.

**Architecture:** Đổi màu trong `tokens.ts` rồi sinh lại khối CSS. Hai component dùng chung là `IconAction` và `TxnTypeTag`. Thay nút theo từng nhóm màn hình, bỏ CSS nút trong các module. Thêm quy tắc "nút phải có tên" vào `verify-layout`. Đặc tả: `docs/superpowers/specs/2026-09-15-giao-dien-ke-toan-design.md`.

**Tech Stack:** antd 6, lucide-react, Next.js 16, vitest, Playwright.

## Global Constraints

- Màu chỉ đổi trong `tokens.ts`; khối biến CSS trong `globals.css` phải khớp `cssVariableBlock()`.
- Không đổi bố cục, dữ liệu hay hành vi: chỉ đổi màu, nút, icon, nhãn.
- Tên nút (chữ hoặc `aria-label`) giữ đúng như cũ, vì các script kiểm tra bấm nút theo tên.
- Commit không có dòng đồng tác giả hay tên công cụ. Đẩy lên chỉ khi cổng xanh.

## Tasks

- [x] **Task 1 — Màu xanh dương.** `tokens.ts` sáng + tối; sinh lại khối trong `globals.css`; `design-tokens` test xanh. Commit.
- [x] **Task 2 — `IconAction` + `TxnTypeTag`** (`src/components/ui/`), test trước. Commit.
- [x] **Task 3 — Màn hình vàng + Tổng quan.**
  - `TxnScreen`: `IconAction`, cột thao tác ghim phải, `TxnTypeTag`;
  - `TxnForm`, `InventoryView`;
  - `Overview`: thẻ lối tắt, nút thử lại/làm mới;
  - `TransactionCharts`.
  Commit.
- [x] **Task 4 — Tiền, quy đổi, nạp dữ liệu, giá, báo cáo:** `Reconcile`, `ConversionView`, `ImportView`, `StateFigure`, `PriceGrid`, `ReportView`, `Ledger` (`LoadFailed`). Bỏ CSS nút trong module. Commit.
- [x] **Task 5 — Cài đặt, báo lỗi, phân kim, khung app:** `UsersView`, `PeriodList`, `PasswordView`, `ReportDialog`, `LotDetail`, `LotList`, `PurchasePicker`, `BagTable`, `AppShell`, `ThemeToggle`, `LocaleSwitch`. Commit.
- [ ] **Task 6 — Kiểm chứng, đẩy lên.**
  - quy tắc "nút phải có tên" trong `verify-layout`;
  - cổng: test, tsc, lint, build;
  - trình duyệt: layout, grid, ledger, void, correct, users, screens;
  - ảnh sáng/tối;
  - đẩy lên; `verify:screens` và `probe:speed` trên Production.
