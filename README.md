# PC49 Web App

Accounting and cash-management system for Pacific Four Nine (PC49), a gold trading company. Replaces a chain of linked Google Sheets.

## Documentation

The specification lives outside this repository, alongside the client's source workbooks:

| Document | Path |
|---|---|
| Business specification | `PC49-Accounting/docs/00-business-specification.md` |
| Data model | `PC49-Accounting/docs/01-data-model.md` |
| Implementation roadmap (packages P0–P9) | `PC49-Accounting/docs/02-implementation-roadmap.md` |
| Acceptance fixtures | `PC49-Accounting/docs/fixtures/` |
| Open questions for the US team | `PC49-Accounting/docs/open-questions-for-us.md` |

Read the business specification before touching anything. The domain is not ordinary bookkeeping: every ledger line carries both money and gold weight, cost of goods sold moves with the daily spot price, and inventory has more than one correct value at the same time.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Ant Design 6 · Supabase (Postgres + Auth + RLS) · vitest · deployed on Vercel.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in the four values
npm run migrate                # applies supabase/migrations in order
npm run dev
```

`.env.local` needs:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role |
| `SUPABASE_DB_URL` | Supabase → Settings → Database → **Connection pooler** |

> Use the **pooler** connection string, not the direct one. Direct Postgres ports are blocked on the development network; `npm run migrate` will hang and time out with a direct connection.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Test suite |
| `npm run test:watch` | Tests in watch mode |
| `npm run migrate` | Applies pending migrations through the pooler; idempotent |

CI runs typecheck, lint, tests and build on every push and pull request to `main`.

## Conventions

- Money and weight are stored as `numeric`. Never `float`.
- No hard deletes. Records are cancelled with `voided_at` and a reason.
- Row-level security is on for every table in the `pc49` schema. Permissions are enforced in the database, not in the UI.
- Business constants live in the `system_param` table, never hardcoded.
- Interface labels come from `src/lib/i18n/dictionary.ts`. Never write a display string directly into a component — every label needs both a Vietnamese and an English form, and a test enforces that.
- Migrations are numbered SQL files under `supabase/migrations/`, applied in filename order and recorded in `pc49.schema_migrations`.

## Data warning

The client's source workbooks contain live production data: customer names, phone numbers, bank account numbers, balances, and staff salaries. Do not commit any of them, and do not commit extracts of them, to a public repository.
