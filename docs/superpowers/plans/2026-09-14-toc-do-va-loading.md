# Tốc độ tải và trạng thái đang tải — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi màn hình dựng xong trong ≤ 800 ms trên Production (hiện 1,5–2,7 s), đăng nhập ≤ 4 s (hiện 11,3 s), và bấm menu là có phản hồi trong ≤ 200 ms.

**Architecture:** Chạy code ở Singapore cạnh database (`vercel.json`). Xác minh phiên ngay trên máy chủ bằng `getClaims()` thay cho một lượt hỏi Supabase Auth. Đọc hồ sơ người dùng một lần mỗi lượt tải qua `cache()` của React. Thêm `loading.tsx` với khung chờ, và dấu đang mở trên menu bằng `useLinkStatus`. Đặc tả: [`docs/superpowers/specs/2026-09-14-toc-do-va-loading-design.md`](../specs/2026-09-14-toc-do-va-loading-design.md).

**Tech Stack:** Next.js 16.3.3 (App Router, `proxy.ts`), React 19.2, `@supabase/ssr` 0.12.5 / `@supabase/supabase-js` 2.112.4, antd 6, vitest 4, Playwright, Vercel.

## Global Constraints

- Không đổi database, không có migration.
- Các thao tác ghi đang gọi `auth.getUser()` giữ nguyên: `src/app/password/actions.ts`, `src/app/(app)/feedback/actions.ts`, `src/app/(app)/settings/actions.ts`, `src/app/(app)/bank-conversion/actions.ts`, `src/app/(app)/cash/actions.ts`.
- Nhánh "không có người dùng" trong `src/app/(app)/layout.tsx` (gọi `auth.getUser()` để phân biệt chưa đăng nhập với tài khoản đã đóng) giữ nguyên.
- Mỗi lượt tải vẫn đọc `app_user`. Tài khoản bị khoá hay không đọc được hồ sơ thì trả về không có người dùng — hỏng thì đóng cửa.
- Chữ trên giao diện đi qua `src/lib/i18n/dictionary.ts`, đủ cặp tiếng Việt và tiếng Anh (có test kiểm tra đủ cặp).
- Màu chỉ lấy từ biến CSS `--pc-*` (sinh từ `src/lib/design/tokens.ts`), không viết mã màu trực tiếp.
- Commit không có dòng `Co-Authored-By` hay tên công cụ nào (Claude, Codex).
- Đẩy lên `main` là Vercel deploy Production. Chỉ đẩy khi cổng kiểm tra xanh.
- Tiêu chí đạt, sau deploy:
  - HTML dựng xong ≤ 800 ms ở cả mười màn hình của `scripts/probe-speed.mjs`;
  - đăng nhập tới trang chủ ≤ 4000 ms;
  - bấm menu có phản hồi ≤ 200 ms;
  - `x-vercel-id` có `::sin1::`.

---

### Task 1: Danh tính từ claims, hồ sơ đọc một lần

**Files:**
- Modify: `src/lib/auth/currentUser.ts`
- Test: `tests/lib/current-user.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `createServerSupabase(): Promise<SupabaseClient>` từ `src/lib/supabase/server.ts` (không đổi).
- Produces: `getCurrentUser(): Promise<CurrentUser | null>` — cùng tên, cùng kiểu trả về như trước, nay là hàm đã bọc `cache()`. `CurrentUser` không đổi: `{ id, email, fullName, role, locale, mustChangePassword }`.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/lib/current-user.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }))

type Profile = {
  id: string
  full_name: string
  role: string
  locale: string
  suspended_at: string | null
  must_change_password: boolean
}

const KT: Profile = {
  id: 'u-1', full_name: 'Ke toan VN', role: 'KT', locale: 'vi',
  suspended_at: null, must_change_password: false,
}

/**
 * A fresh copy of the module for each test. `getCurrentUser` is wrapped in
 * React's `cache`, and a copy kept between tests could hand one test the
 * answer another test set up.
 */
async function load({ claims, profile }: {
  claims: Record<string, unknown> | null
  profile: Profile | null
}) {
  vi.resetModules()
  const server = await import('@/lib/supabase/server')
  const getUser = vi.fn(async () => ({ data: { user: null }, error: null }))
  const getClaims = vi.fn(async () => (claims
    ? { data: { claims, header: {}, signature: new Uint8Array() }, error: null }
    : { data: null, error: new Error('Auth session missing!') }))
  const single = vi.fn(async () => (profile
    ? { data: profile, error: null }
    : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }))
  const eq = vi.fn(() => ({ single }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  vi.mocked(server.createServerSupabase).mockResolvedValue({ auth: { getClaims, getUser }, from } as never)
  const { getCurrentUser } = await import('@/lib/auth/currentUser')
  return { getCurrentUser, getUser, getClaims, from, eq }
}

describe('who is signed in', () => {
  it('reads identity from the session claims, without a round trip to Auth', async () => {
    const s = await load({ claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' }, profile: KT })
    expect(await s.getCurrentUser()).toEqual({
      id: 'u-1', email: 'accountant@ctyhp.vn', fullName: 'Ke toan VN',
      role: 'KT', locale: 'vi', mustChangePassword: false,
    })
    expect(s.getClaims).toHaveBeenCalledTimes(1)
    expect(s.getUser).not.toHaveBeenCalled()
    expect(s.eq).toHaveBeenCalledWith('id', 'u-1')
  })

  it('is nobody without a verified session, and reads no profile', async () => {
    const s = await load({ claims: null, profile: KT })
    expect(await s.getCurrentUser()).toBeNull()
    expect(s.from).not.toHaveBeenCalled()
  })

  it('is nobody when the account is suspended', async () => {
    const s = await load({
      claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' },
      profile: { ...KT, suspended_at: '2026-09-01T00:00:00Z' },
    })
    expect(await s.getCurrentUser()).toBeNull()
  })

  it('is nobody when the profile cannot be read', async () => {
    const s = await load({ claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' }, profile: null })
    expect(await s.getCurrentUser()).toBeNull()
  })

  it('carries the flag that forces a new password', async () => {
    const s = await load({
      claims: { sub: 'u-1', email: 'accountant@ctyhp.vn' },
      profile: { ...KT, must_change_password: true },
    })
    expect((await s.getCurrentUser())?.mustChangePassword).toBe(true)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/lib/current-user.test.ts`
Expected: FAIL — "reads identity from the session claims…" nhận `null` (code hiện tại gọi `auth.getUser()`, bản giả trả `user: null`), và "carries the flag…" cũng đỏ vì cùng lý do.

- [ ] **Step 3: Viết lại `getCurrentUser`**

Thay toàn bộ `src/lib/auth/currentUser.ts` bằng:

```ts
import { cache } from 'react'
import { createServerSupabase } from '@/lib/supabase/server'
import type { Role } from '@/lib/auth/roles'
import type { Locale } from '@/lib/i18n'

export type CurrentUser = {
  id: string
  /** From the session rather than the profile: it is what people sign in as. */
  email: string
  fullName: string
  role: Role
  locale: Locale
  /**
   * Set when an administrator issued the password and it has not been changed.
   *
   * It is read here, with the role, rather than by the layout on its own. That
   * read discarded its error, so a query that failed left the flag undefined
   * and let somebody who was required to change their password straight in.
   * Folded into this one, a failed read returns no user at all — which sends
   * them to the door. An authentication check has to fail closed.
   */
  mustChangePassword: boolean
}

/**
 * The signed-in person, read once per request.
 *
 * Who they are comes from the session's claims, verified here against the
 * project's ES256 signing key, not from a round trip to Supabase Auth. That
 * trip was one of six in a row on every page, and the layout and the page each
 * made it — `cache` is what lets the two share this read now.
 *
 * The profile is still read on every request. Suspending an account or
 * requiring a new password takes effect at once, whatever the token says.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createServerSupabase()
  const { data: session, error } = await supabase.auth.getClaims()
  const claims = session?.claims
  if (error || !claims?.sub) return null

  const { data } = await supabase
    .from('app_user')
    .select('id, full_name, role, locale, suspended_at, must_change_password')
    .eq('id', claims.sub)
    .single()

  if (!data) return null

  // A closed account is not a role that may do less. It is no role at all —
  // which is what `pc49.effective_role()` has always said, and what every
  // policy in the database reads. Reading `role` here without asking whether
  // the account is open put the two out of step: the database returned nothing
  // to somebody the screens still let in, so they reached the entry grid and
  // found it empty rather than being turned round at the door.
  if (data.suspended_at) return null
  return {
    id: data.id as string,
    email: typeof claims.email === 'string' ? claims.email : '',
    fullName: data.full_name as string,
    role: data.role as Role,
    locale: data.locale as Locale,
    mustChangePassword: Boolean(data.must_change_password),
  }
})
```

- [ ] **Step 4: Chạy test, xác nhận xanh; typecheck**

Run: `npx vitest run tests/lib/current-user.test.ts && npx tsc --noEmit`
Expected: `Tests  5 passed (5)`; `tsc` không in lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/currentUser.ts tests/lib/current-user.test.ts
git commit -m "perf(auth): who is signed in comes from the session, read once per request"
```

---

### Task 2: Proxy xác minh phiên tại chỗ

**Files:**
- Modify: `src/lib/supabase/session.ts`
- Modify: `src/proxy.ts`
- Test: `tests/lib/session.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `createServerClient` từ `@supabase/ssr`; `readEnv` từ `src/lib/env.ts` (cần `NEXT_PUBLIC_SUPABASE_URL` và `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` hoặc `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- Produces: `updateSession(request: NextRequest): Promise<{ response: NextResponse; signedIn: boolean }>` — trường `user` cũ thay bằng `signedIn`; `src/proxy.ts` là nơi duy nhất gọi nó.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/lib/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ getClaims: vi.fn(), getUser: vi.fn() }))
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn(() => ({ auth })) }))

const { updateSession } = await import('@/lib/supabase/session')
const request = () => new NextRequest('http://localhost:3000/gold-transactions')

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  auth.getClaims.mockReset()
  auth.getUser.mockReset()
})

describe('the proxy in front of every page', () => {
  it('lets a verified session through without asking Supabase Auth', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: { sub: 'u-1' } }, error: null })
    const { signedIn, response } = await updateSession(request())
    expect(signedIn).toBe(true)
    expect(response.status).toBe(200)
    expect(auth.getUser).not.toHaveBeenCalled()
  })

  it('treats a session it cannot verify as signed out', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: new Error('Invalid JWT') })
    expect((await updateSession(request())).signedIn).toBe(false)
  })

  it('treats claims with nobody in them as signed out', async () => {
    auth.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })
    expect((await updateSession(request())).signedIn).toBe(false)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/lib/session.test.ts`
Expected: FAIL — `signedIn` là `undefined` ở cả ba test (hàm hiện trả `user` và gọi `auth.getUser`).

- [ ] **Step 3: Viết lại `updateSession` và cập nhật proxy**

Thay toàn bộ `src/lib/supabase/session.ts` bằng:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { readEnv } from '@/lib/env'

export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; signedIn: boolean }> {
  let response = NextResponse.next({ request })
  const env = readEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  // Verified here against the project's signing key (ES256) rather than by
  // asking Supabase Auth. This runs before every page and every prefetch, and
  // that question was the first of six round trips in a row. An expired access
  // token is still refreshed: getClaims goes through getSession to do it.
  const { data, error } = await supabase.auth.getClaims()
  return { response, signedIn: !error && Boolean(data?.claims?.sub) }
}
```

Trong `src/proxy.ts`, thay thân hàm `proxy` bằng:

```ts
export async function proxy(request: NextRequest) {
  const { response, signedIn } = await updateSession(request)
  const { pathname } = request.nextUrl

  if (!signedIn && !PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  if (signedIn && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }
  return response
}
```

- [ ] **Step 4: Chạy test, xác nhận xanh; typecheck**

Run: `npx vitest run tests/lib/session.test.ts && npx tsc --noEmit`
Expected: `Tests  3 passed (3)`; `tsc` không in lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/session.ts src/proxy.ts tests/lib/session.test.ts
git commit -m "perf(auth): the proxy verifies the session itself instead of asking Auth"
```

---

### Task 3: Khung chờ khi chuyển trang

**Files:**
- Create: `src/components/ui/PageSkeleton.tsx`
- Create: `src/components/ui/PageSkeleton.module.css`
- Create: `src/app/(app)/loading.tsx`
- Modify: `src/lib/i18n/dictionary.ts` (thêm `common.loading` ở khối tiếng Việt, ngay sau `'common.reloading': 'Đang tải lại…',`, và ở khối tiếng Anh, ngay sau `'common.reloading': 'Reloading…',`)
- Test: `tests/lib/page-skeleton.test.tsx` (tạo mới)

**Interfaces:**
- Consumes: `useLocale()` từ `src/lib/i18n/provider` (`{ t, locale }`); `LocaleProvider` với prop `initialLocale`.
- Produces: `PageSkeleton(): JSX.Element` — phần tử gốc có `role="status"`, `aria-busy="true"` và thuộc tính `data-pc-skeleton`; Task 5 dùng `[data-pc-skeleton]` để nhận ra khung chờ trên trình duyệt. Khoá i18n `common.loading`.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/lib/page-skeleton.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const { LocaleProvider } = await import('@/lib/i18n/provider')
const { PageSkeleton } = await import('@/components/ui/PageSkeleton')

const render = (locale: 'vi' | 'en') => renderToStaticMarkup(
  <LocaleProvider initialLocale={locale}><PageSkeleton /></LocaleProvider>)

describe('the page skeleton', () => {
  it('says the screen is loading, to assistive technology, in the reader\'s language', () => {
    const vi = render('vi')
    expect(vi).toContain('role="status"')
    expect(vi).toContain('aria-busy="true"')
    expect(vi).toContain('Đang tải…')
    expect(render('en')).toContain('Loading…')
  })

  it('marks itself so a browser check can tell it from the page it stands in for', () => {
    expect(render('vi').match(/data-pc-skeleton/g)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/lib/page-skeleton.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/ui/PageSkeleton"`.

- [ ] **Step 3: Thêm chữ "Đang tải…" vào từ điển**

Trong `src/lib/i18n/dictionary.ts`, khối tiếng Việt, ngay sau `'common.reloading': 'Đang tải lại…',` thêm:

```ts
    'common.loading': 'Đang tải…',
```

Khối tiếng Anh, ngay sau `'common.reloading': 'Reloading…',` thêm:

```ts
    'common.loading': 'Loading…',
```

- [ ] **Step 4: Viết `PageSkeleton` và `loading.tsx`**

Tạo `src/components/ui/PageSkeleton.tsx`:

```tsx
'use client'

import { useLocale } from '@/lib/i18n/provider'
import styles from './PageSkeleton.module.css'

const STATS = 4
const ROWS = 8

/**
 * What a screen looks like while its figures are on their way.
 *
 * Shaped like the pages it stands in for — a title, a strip of figures, a table
 * on its card — at the same width and spacing, so nothing jumps when the real
 * page replaces it. `app/(app)/loading.tsx` shows it the moment a menu item is
 * clicked; before it existed, a click did nothing visible for two seconds.
 */
export function PageSkeleton() {
  const { t } = useLocale()
  return (
    <div className={styles.page} role="status" aria-busy="true" aria-live="polite" data-pc-skeleton="">
      <span className={styles.srOnly}>{t('common.loading')}</span>
      <div className={styles.header} aria-hidden="true">
        <span className={`${styles.block} ${styles.title}`} />
        <span className={`${styles.block} ${styles.description}`} />
      </div>
      <div className={styles.stats} aria-hidden="true">
        {Array.from({ length: STATS }, (_, i) => (
          <span key={i} className={styles.stat}>
            <span className={`${styles.block} ${styles.statLabel}`} />
            <span className={`${styles.block} ${styles.statValue}`} />
          </span>
        ))}
      </div>
      <div className={styles.table} aria-hidden="true">
        <span className={styles.tableHead} />
        {Array.from({ length: ROWS }, (_, i) => (
          <span key={i} className={styles.row}>
            <span className={`${styles.block} ${styles.cellWide}`} />
            <span className={`${styles.block} ${styles.cell}`} />
            <span className={`${styles.block} ${styles.cellNum}`} />
          </span>
        ))}
      </div>
    </div>
  )
}
```

Tạo `src/components/ui/PageSkeleton.module.css`:

```css
/*
 * Placeholder shapes for a screen still loading. Spacing copies the ledger
 * page (Ledger.module.css: .stats, .frame, the page header's 20px) so the real
 * page lands where the skeleton was. Colours come from the tokens, so the dark
 * theme gets dark placeholders; globals.css already stops the shimmer for
 * anybody who has asked for reduced motion.
 */
.page { display: flex; flex-direction: column; min-width: 0; }

.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.block {
  display: block;
  border-radius: 6px;
  background: linear-gradient(90deg,
    var(--pc-surface-muted) 0%, var(--pc-surface-subtle) 50%, var(--pc-surface-muted) 100%);
  background-size: 200% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

@keyframes shimmer {
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
}

.header { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.title { width: min(320px, 60%); height: 30px; }
.description { width: min(560px, 90%); height: 14px; }

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1px;
  background: var(--pc-border-default);
  border: 1px solid var(--pc-border-default);
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 20px;
}
.stat { display: flex; flex-direction: column; gap: 8px; padding: 13px 16px; background: var(--pc-surface-card); }
.statLabel { width: 45%; height: 12px; }
.statValue { width: 70%; height: 22px; }

.table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--pc-border-default);
  border-radius: 10px;
  background: var(--pc-surface-card);
  overflow: hidden;
}
.tableHead { display: block; height: 44px; background: var(--pc-surface-muted); }
.row {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) minmax(0, 1fr);
  gap: 16px;
  align-items: center;
  padding: 14px 16px;
  border-top: 1px solid var(--pc-border-subtle);
}
.cellWide { height: 14px; }
.cell { height: 14px; width: 80%; }
.cellNum { height: 14px; width: 60%; justify-self: end; }
```

Tạo `src/app/(app)/loading.tsx`:

```tsx
import { PageSkeleton } from '@/components/ui/PageSkeleton'

/**
 * Shown the moment a signed-in screen is asked for, while the server builds it.
 *
 * Every screen here is dynamic, so without a loading boundary nothing of the
 * next screen can be prefetched and a click on the menu showed nothing until
 * the whole page had arrived.
 */
export default function Loading() {
  return <PageSkeleton />
}
```

- [ ] **Step 5: Chạy test, xác nhận xanh; kiểm tra từ điển đủ cặp; typecheck**

Run: `npx vitest run tests/lib/page-skeleton.test.tsx tests/lib/i18n.test.ts && npx tsc --noEmit`
Expected: `page-skeleton` 2 test xanh; `tests/lib/i18n.test.ts` (kiểm tra từ điển đủ cặp tiếng Việt – tiếng Anh) xanh; `tsc` không in lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/PageSkeleton.tsx src/components/ui/PageSkeleton.module.css "src/app/(app)/loading.tsx" src/lib/i18n/dictionary.ts tests/lib/page-skeleton.test.tsx
git commit -m "feat(ui): a screen shows its outline the moment it is asked for"
```

---

### Task 4: Dấu đang mở trên menu

**Files:**
- Create: `src/components/NavPending.tsx`
- Modify: `src/components/AppShell.tsx:144-161` (hai nhãn `<Link>` trong `menuItems`)
- Modify: `src/app/globals.css` (thêm cuối tệp)
- Test: `tests/lib/nav-pending.test.tsx` (tạo mới)

**Interfaces:**
- Consumes: `useLinkStatus(): { pending: boolean }` từ `next/link` (có trong Next 16.3.3, `node_modules/next/dist/client/app-dir/link.d.ts:200`); chỉ dùng được trong component con của `<Link>`.
- Produces: `NavPending()` (gọi hook) và `NavPendingMark({ pending }: { pending: boolean })` (chỉ vẽ). Class CSS `pc-nav-pending`, thêm `is-pending` khi đang mở.

- [ ] **Step 1: Viết test đỏ**

Tạo `tests/lib/nav-pending.test.tsx`:

```tsx
import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NavPendingMark } from '@/components/NavPending'

it('keeps its place in the menu whether or not a screen is on its way', () => {
  // Same element, same size, either way: only the class changes, so the label
  // beside it never moves when a click starts or finishes.
  expect(renderToStaticMarkup(<NavPendingMark pending={false} />))
    .toBe('<span aria-hidden="true" class="pc-nav-pending"></span>')
  expect(renderToStaticMarkup(<NavPendingMark pending />))
    .toBe('<span aria-hidden="true" class="pc-nav-pending is-pending"></span>')
})
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/lib/nav-pending.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/NavPending"`.

- [ ] **Step 3: Viết `NavPending`, gắn vào menu, thêm CSS**

Tạo `src/components/NavPending.tsx`:

```tsx
'use client'

import { useLinkStatus } from 'next/link'

/**
 * The mark beside a menu item while its screen is on its way.
 *
 * It has to sit inside the `<Link>` it reports on, because that is where
 * `useLinkStatus` reads from.
 */
export function NavPending() {
  const { pending } = useLinkStatus()
  return <NavPendingMark pending={pending} />
}

/** Always rendered at a fixed size and faded in, so the label never shifts. */
export function NavPendingMark({ pending }: { pending: boolean }) {
  return <span aria-hidden="true" className={`pc-nav-pending${pending ? ' is-pending' : ''}`} />
}
```

Trong `src/components/AppShell.tsx`, thêm import cạnh các import component khác:

```tsx
import { NavPending } from '@/components/NavPending'
```

và thay hai nhãn trong `menuItems`:

```tsx
            label: <Link href={child.key}>{t(child.labelKey)}<NavPending /></Link>,
```

```tsx
          label: <Link href={item.key}>{t(item.labelKey)}<NavPending /></Link>,
```

Thêm vào cuối `src/app/globals.css`:

```css
/* The mark beside a menu item whose screen is on its way (NavPending). Always
   there at a fixed size and only faded in, so the label never moves. */
.pc-nav-pending {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-inline-start: 8px;
  border-radius: 50%;
  background: var(--pc-accent-onDark);
  vertical-align: middle;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.pc-nav-pending.is-pending { opacity: 1; animation: pc-nav-pending 0.9s ease-in-out infinite; }
@keyframes pc-nav-pending { 50% { opacity: 0.35; } }
```

- [ ] **Step 4: Chạy test, xác nhận xanh; typecheck và lint**

Run: `npx vitest run tests/lib/nav-pending.test.tsx && npx tsc --noEmit && npm run lint`
Expected: `Tests  1 passed (1)`; `tsc` và lint không in lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/components/NavPending.tsx src/components/AppShell.tsx src/app/globals.css tests/lib/nav-pending.test.tsx
git commit -m "feat(ui): the menu marks the screen it is opening"
```

---

### Task 5: Chạy ở Singapore, đo, kiểm tra, đẩy lên

**Files:**
- Create: `vercel.json`
- Create: `scripts/probe-speed.mjs`
- Create: `scripts/verify-loading.mjs`
- Modify: `package.json` (thêm hai script)
- Modify: `docs/superpowers/specs/2026-09-14-toc-do-va-loading-design.md` (ghi số đo sau khi deploy)

**Interfaces:**
- Consumes: `openPage(target)`, `signIn(page, base, email, password)` từ `scripts/support/page.mjs`; `accountFor(role)` từ `scripts/support/accounts.mjs`; `[data-pc-skeleton]` từ Task 3; menu `.pc-shell__nav` có link "Tổng quan" (`/`) và "Báo lỗi" (`/feedback`) cho mọi vai trò.
- Produces: `npm run probe:speed`, `npm run verify:loading` — cả hai đọc `PC49_BASE_URL`, thoát mã 1 khi không đạt.

- [ ] **Step 1: Chọn vùng chạy code**

Tạo `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"]
}
```

- [ ] **Step 2: Đưa script đo tốc độ vào repo**

Tạo `scripts/probe-speed.mjs`:

```js
// How long the screens really take, and whether that meets the targets.
//
//   PC49_BASE_URL=https://pc49-accounting.vercel.app npm run probe:speed
//
// Each screen is opened twice and the second visit counts, once the browser has
// its cache. "Built" is when the last byte of HTML arrived, measured from the
// request, which is the column recorded before this work in
// docs/superpowers/specs/2026-09-14-toc-do-va-loading-design.md. Targets from
// that design: every screen within 800 ms, and signing in within 4 seconds.
import { chromium } from 'playwright'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const HTML_TARGET_MS = 800
const SIGN_IN_TARGET_MS = 4000
const ROUTES = [
  '/', '/gold-transactions?date=2026-01-08', '/prices?date=2026-01-08', '/inventory',
  '/cash?period=2026-08', '/journal?period=2026-01', '/reports', '/refining', '/import',
  '/settings/reference',
]

const browser = await chromium.launch()
const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 900 } }))
const admin = accountFor('ADMIN')
const started = Date.now()
await signIn(page, BASE, admin.email, admin.password)
const signInMs = Date.now() - started

const measured = []
for (const round of [1, 2]) {
  for (const route of ROUTES) {
    const t0 = Date.now()
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
    const settled = Date.now() - t0
    const timing = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0]
      return {
        firstByte: Math.round(n.responseStart - n.requestStart),
        built: Math.round(n.responseEnd - n.requestStart),
      }
    })
    if (round === 2) measured.push({ route, ...timing, settled })
  }
}
await browser.close()

console.table(measured)
console.log(`Signing in to the home page: ${signInMs} ms (target ${SIGN_IN_TARGET_MS})`)
const slow = measured.filter((m) => m.built > HTML_TARGET_MS)
for (const m of slow) console.log(`SLOW  ${m.route}: built in ${m.built} ms (target ${HTML_TARGET_MS})`)
const ok = slow.length === 0 && signInMs <= SIGN_IN_TARGET_MS
console.log(ok ? '\nSPEED TARGETS MET' : '\nSPEED TARGETS NOT MET')
process.exitCode = ok ? 0 : 1
```

- [ ] **Step 3: Viết kiểm tra "bấm menu có phản hồi ngay"**

Tạo `scripts/verify-loading.mjs`:

```js
// A click on the menu answers at once: the skeleton or the destination is on
// screen within 200 ms.
//
//   PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:loading
//
// Run it against a built deployment. The development server compiles each
// route the first time it is asked for and does not prefetch, so a number from
// there says nothing about what a person clicking the menu sees.
import { chromium } from 'playwright'
import { openPage, signIn } from './support/page.mjs'
import { accountFor } from './support/accounts.mjs'

const BASE = process.env.PC49_BASE_URL ?? 'http://localhost:3000'
const TARGET_MS = 200
const ATTEMPTS = 3

let failures = 0
function check(name, ok, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(56)}${detail}`)
}

const browser = await chromium.launch()
const page = await openPage(await browser.newContext({ viewport: { width: 1440, height: 900 } }))
const admin = accountFor('ADMIN')
await signIn(page, BASE, admin.email, admin.password)

/** Milliseconds from the click until the skeleton or the destination shows. */
async function clickToFeedback(label, path) {
  const link = page.locator('.pc-shell__nav').getByRole('link', { name: label, exact: true }).first()
  // The time a person takes to read the menu, in which the router prefetches
  // the loading boundary of the links on screen.
  await page.waitForTimeout(1500)
  const before = await page.locator('h1').first().textContent()
  const start = Date.now()
  await link.click()
  await page.waitForFunction(([previous, target]) =>
    Boolean(document.querySelector('[data-pc-skeleton]'))
      || (location.pathname === target && document.querySelector('h1')?.textContent !== previous),
  [before, path], { polling: 'raf', timeout: 15000 })
  const elapsed = Date.now() - start
  await page.waitForURL((url) => new URL(url).pathname === path)
  await page.waitForLoadState('networkidle')
  return elapsed
}

for (const [from, label, path] of [['/', 'Báo lỗi', '/feedback'], ['/feedback', 'Tổng quan', '/']]) {
  const times = []
  for (let i = 0; i < ATTEMPTS; i += 1) {
    await page.goto(`${BASE}${from}`, { waitUntil: 'networkidle' })
    times.push(await clickToFeedback(label, path))
  }
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]
  check(`clicking "${label}" answers within ${TARGET_MS} ms`, median <= TARGET_MS, `${times.join(', ')} ms`)
}

await browser.close()
console.log(failures === 0 ? '\nALL LOADING CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
```

Trong `package.json`, khối `scripts`, ngay sau dòng `"verify:layout": …` (nhớ thêm dấu phẩy vào cuối dòng đó), thêm:

```json
    "probe:speed": "node --env-file=.env.local scripts/probe-speed.mjs",
    "verify:loading": "node --env-file=.env.local scripts/verify-loading.mjs"
```

- [ ] **Step 4: Cổng kiểm tra trên máy**

Run: `npm test && npx tsc --noEmit && npm run lint && npx next build`
Expected: toàn bộ test xanh (643 cũ + 11 mới); `tsc` và lint không lỗi; build in `✓ Compiled successfully`.

- [ ] **Step 5: Kiểm tra trên trình duyệt với máy dev**

Dev server phải đang chạy (`http://localhost:3000`). Run lần lượt:
- `npm run verify:signin` — mong đợi: in dòng tổng kết đạt, không có `FAIL`.
- `npm run verify:screens` — mong đợi: `ALL SCREEN CHECKS PASSED`.
- `npm run verify:layout` — mong đợi: `ALL LAYOUT CHECKS PASSED`.
- `npm run verify:grid` — mong đợi: `ALL TRANSACTION FORM CHECKS PASSED`.

Nếu một kiểm tra đỏ: dừng lại, tìm nguyên nhân, sửa bằng một test đỏ trước. Không đẩy lên khi còn đỏ.

- [ ] **Step 6: Commit**

```bash
git add vercel.json scripts/probe-speed.mjs scripts/verify-loading.mjs package.json
git commit -m "perf: run the pages in Singapore, next to the database"
```

- [ ] **Step 7: Đẩy lên và chờ deploy**

```bash
git fetch origin
git log --oneline HEAD..origin/main    # phải rỗng; có commit lạ thì dừng lại hỏi
git log origin/main..HEAD --format=%B | grep -iE 'claude|codex'   # phải không in gì
git push origin HEAD:main
sha=$(git rev-parse HEAD)
npx vercel ls -m githubCommitSha=$sha  # chạy lại mỗi 15 giây tới khi dòng Production là "● Ready"
curl -s -o /dev/null -D - https://pc49-accounting.vercel.app/login | grep -i x-vercel-id
```

Expected: deploy `● Ready`; header dạng `X-Vercel-Id: hkg1::sin1::…` — phần giữa là `sin1`.

- [ ] **Step 8: Đo và kiểm tra trên Production**

Run lần lượt:
- `PC49_BASE_URL=https://pc49-accounting.vercel.app npm run probe:speed` — mong đợi `SPEED TARGETS MET`.
- `PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:loading` — mong đợi `ALL LOADING CHECKS PASSED`.
- `PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:signin` — mong đợi không có `FAIL`.
- `PC49_BASE_URL=https://pc49-accounting.vercel.app npm run verify:screens` — mong đợi `ALL SCREEN CHECKS PASSED`.

Nếu `probe:speed` chưa đạt: ghi lại màn hình nào chậm bao nhiêu, rồi báo lại cho anh Việt kèm số. Không nới mục tiêu cho khớp.

- [ ] **Step 9: Ghi số đo sau vào đặc tả, commit và đẩy lên**

Thêm vào cuối `docs/superpowers/specs/2026-09-14-toc-do-va-loading-design.md` một mục `## Kết quả sau khi deploy (14-09)`. Mục này gồm:
- bảng `console.table` của `probe:speed`: màn hình, byte đầu, dựng xong, tới lúc im mạng;
- dòng thời gian đăng nhập;
- ba thời gian bấm menu của `verify:loading`;
- header `x-vercel-id`.

Chép đúng số in ra.

```bash
git add docs/superpowers/specs/2026-09-14-toc-do-va-loading-design.md
git commit -m "docs(spec): what the pages take now that they run next to the database"
git push origin HEAD:main
```
