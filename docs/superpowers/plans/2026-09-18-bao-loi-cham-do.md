# Góp ý: chấm đỏ khi có thay đổi — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mục Báo lỗi trên menu hiện số đỏ khi có gì chờ người đang đăng nhập; mở màn là đã xem; góp ý vừa đổi mang thẻ "Mới cập nhật".

**Architecture:** 0088 thêm `feedback_seen` và ba hàm (`feedback_seen_at`, `feedback_unseen`, `mark_feedback_seen`), dựa trên RLS sẵn có của `feedback_report`. Layout đọc số và đưa vào `AppShell`; `NavBadge.tsx` vẽ số và chấm. `FeedbackQueue` ghi nhận đã xem một lần khi mở, rồi làm mới.

**Tech Stack:** PostgreSQL/PGlite + vitest; Next.js 16, React 19, antd 6; Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-bao-loi-cham-do-design.md`

## Global Constraints

- Không có chữ `cl[a]ude`, `cod[e]x` trong commit hay nội dung đẩy lên.
- `git push origin main` là lệnh riêng, ngoài 04:00–08:00 UTC trừ khi người dùng bảo.
- DB thật chỉ ghi bằng `npm run migrate`, sau đó `npm run verify:live`.
- Test SQL chạy một mình.
- File mới tách bằng `node scripts/extract-plan-files.mjs docs/superpowers/plans/2026-09-18-bao-loi-cham-do.md <path>…`.

---

### Task 1: Ai đã xem đến đâu (0088)

**Files:** Create `supabase/migrations/0088_a_reporter_is_told_what_moved.sql`; Modify `tests/sql/feedback.test.ts` (thêm describe cuối file).

**Interfaces — Produces:** bảng `pc49.feedback_seen(user_id, seen_at)`; `pc49.feedback_seen_at() → timestamptz`; `pc49.feedback_unseen() → int`; `pc49.mark_feedback_seen() → timestamptz`.

- [ ] **Step 1: Test** — thêm vào cuối `tests/sql/feedback.test.ts`:

```ts
describe('what is waiting on the reports screen', () => {
  const unseen = async (who: string) => Number((await asRole(db, who, () =>
    db.query<{ n: number }>(`SELECT pc49.feedback_unseen() AS n`))).rows[0].n)
  const markSeen = (who: string) =>
    asRole(db, who, () => db.query(`SELECT pc49.mark_feedback_seen()`))

  async function fileAs(who: string, description: string) {
    const r = await asRole(db, who, () => db.query<{ id: string }>(
      `INSERT INTO pc49.feedback_report (kind, impact, description, page_url, page_route, reporter_id)
       VALUES ('BROKEN', 'MINOR', $1, '/prices', '/prices', $2) RETURNING id`, [description, who]))
    return r.rows[0].id
  }

  it('counts, for an administrator, what nobody has picked up yet', async () => {
    const before = await unseen(BOSS)
    const id = await fileAs(CLERK, 'unseen: a new one for the queue')
    expect(await unseen(BOSS)).toBe(before + 1)
    await triage(`SELECT pc49.set_feedback_status($1, 'LOOKING')`, [id])
    expect(await unseen(BOSS)).toBe(before)
  })

  it('counts, for the reporter, their own reports that moved since they looked', async () => {
    const id = await fileAs(CLERK, 'unseen: mine')
    await markSeen(CLERK)
    expect(await unseen(CLERK)).toBe(0)
    await triage(`SELECT pc49.set_feedback_status($1, 'FIXED', 'done')`, [id])
    expect(await unseen(CLERK)).toBe(1)
    await markSeen(CLERK)
    expect(await unseen(CLERK)).toBe(0)
  })

  it('does not count somebody else’s report as the reporter’s news', async () => {
    const id = await fileAs(BOSS, 'unseen: the boss’s own')
    await markSeen(CLERK)
    await triage(`SELECT pc49.set_feedback_status($1, 'FIXED', 'done')`, [id])
    expect(await unseen(CLERK)).toBe(0)
  })

  it('keeps when each person last looked to themselves', async () => {
    await markSeen(CLERK)
    await markSeen(BOSS)
    const seen = await asRole(db, CLERK, () => db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.feedback_seen`))
    expect(seen.rows[0].n).toBe('1')
    await expect(asRole(db, CLERK, () => db.query(
      `INSERT INTO pc49.feedback_seen (user_id, seen_at) VALUES ($1, now())`, [BOSS])))
      .rejects.toThrow(/row-level security/)
  })
})
```

- [ ] **Step 2: Đỏ** — `npx vitest run tests/sql/feedback.test.ts`

- [ ] **Step 3: Migration**

```sql path=supabase/migrations/0088_a_reporter_is_told_what_moved.sql
-- 0088_a_reporter_is_told_what_moved.sql
-- The menu calls somebody back to the reports screen when something there is
-- waiting for them.
--
-- "Người báo không biết gì tiếp theo" (17-09-2026). The screen already showed a
-- reporter their reports, what became of each and the note beside it (0036).
-- Nothing brought them back to look. A report was filed, its status moved, a
-- note was written for its reporter, and they found out only if they happened
-- to open the screen. Nor did an administrator learn that a report had arrived
-- without going to see.
--
--   feedback_seen        when each person last opened the reports screen
--   feedback_seen_at     that moment for whoever is asking; never is -infinity
--   feedback_unseen      what is waiting for them: for an administrator, the
--                        reports nobody has picked up; for anybody else, their
--                        own reports that moved since they last looked
--   mark_feedback_seen   opening the screen is looking
--
-- Nothing here decides who sees which report. feedback_report's own policies
-- (0036) already give a reporter theirs and an administrator the queue, and
-- these run as the person asking, so the counts follow the same line.

CREATE TABLE IF NOT EXISTS pc49.feedback_seen (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pc49.feedback_seen ENABLE ROW LEVEL SECURITY;

-- Each person's own row, and nobody else's: when somebody last looked is theirs.
DROP POLICY IF EXISTS feedback_seen_own ON pc49.feedback_seen;
CREATE POLICY feedback_seen_own ON pc49.feedback_seen
  FOR ALL USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, INSERT, UPDATE ON pc49.feedback_seen TO authenticated;

CREATE OR REPLACE FUNCTION pc49.feedback_seen_at()
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = pc49, public, auth AS $$
  SELECT coalesce((SELECT s.seen_at FROM pc49.feedback_seen s WHERE s.user_id = auth.uid()),
                  '-infinity'::timestamptz)
$$;

CREATE OR REPLACE FUNCTION pc49.feedback_unseen()
RETURNS int LANGUAGE sql STABLE SET search_path = pc49, public, auth AS $$
  SELECT CASE
    WHEN pc49.effective_role() = 'ADMIN' THEN
      (SELECT count(*) FROM pc49.feedback_report r WHERE r.status = 'NEW')
    ELSE
      (SELECT count(*) FROM pc49.feedback_report r
        WHERE r.reporter_id = auth.uid()
          AND r.triaged_at IS NOT NULL
          AND r.triaged_at > pc49.feedback_seen_at())
  END::int
$$;

CREATE OR REPLACE FUNCTION pc49.mark_feedback_seen()
RETURNS timestamptz LANGUAGE plpgsql SET search_path = pc49, public, auth AS $$
DECLARE
  v_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nobody is signed in'; END IF;
  INSERT INTO pc49.feedback_seen (user_id, seen_at) VALUES (auth.uid(), v_at)
  ON CONFLICT (user_id) DO UPDATE SET seen_at = excluded.seen_at;
  RETURN v_at;
END $$;

GRANT EXECUTE ON FUNCTION pc49.feedback_seen_at() TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.feedback_unseen() TO authenticated;
GRANT EXECUTE ON FUNCTION pc49.mark_feedback_seen() TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0088_a_reporter_is_told_what_moved')
ON CONFLICT (version) DO NOTHING;
```

- [ ] **Step 4: Xanh; commit** — `git commit -m "feat(feedback): count what is waiting for each reader on the reports screen"`

---

### Task 2: Số đỏ trên menu, thẻ "Mới cập nhật"

**Files:** Create `src/components/NavBadge.tsx`, `tests/lib/nav-badge.test.tsx`; Modify `src/components/AppShell.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/feedback/page.tsx`, `src/app/(app)/feedback/actions.ts`, `src/components/feedback/FeedbackQueue.tsx`, `src/lib/i18n/dictionary.ts`.

- [ ] **Step 1: Test**

```tsx path=tests/lib/nav-badge.test.tsx
import { it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NavCount, NavDot } from '@/components/NavBadge'

it('draws nothing when nothing is waiting', () => {
  expect(renderToStaticMarkup(<NavCount count={0} label="0 mục cần xem" />)).toBe('')
  expect(renderToStaticMarkup(<NavDot count={0} label="0 mục cần xem"><i>icon</i></NavDot>))
    .toBe('<i>icon</i>')
})

it('draws the number, named for somebody who cannot see it, when something is', () => {
  const html = renderToStaticMarkup(<NavCount count={3} label="3 mục cần xem" />)
  expect(html).toContain('3')
  expect(html).toContain('3 mục cần xem')
  expect(renderToStaticMarkup(<NavDot count={3} label="3 mục cần xem"><i>icon</i></NavDot>))
    .toContain('ant-badge-dot')
})
```

- [ ] **Step 2: Đỏ** — `npx vitest run tests/lib/nav-badge.test.tsx`

- [ ] **Step 3: Component**

```tsx path=src/components/NavBadge.tsx
'use client'

import type { ReactNode } from 'react'
import { Badge } from 'antd'

/**
 * How many things behind a menu entry are waiting for this reader (spec
 * 2026-09-18): beside its name, and as a dot on its icon for a folded menu.
 *
 * Nothing is drawn for nothing. A badge that reads 0 is an alarm going off
 * every time somebody glances at the menu, and it teaches them to stop looking.
 */
export function NavCount({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null
  return (
    <span className="pc-nav-count" aria-label={label} title={label}>
      <Badge count={count} size="small" />
    </span>
  )
}

export function NavDot({ count, label, children }: {
  count: number
  label: string
  children: ReactNode
}) {
  if (count <= 0) return <>{children}</>
  return <Badge dot title={label}>{children}</Badge>
}
```

- [ ] **Step 4: Chữ** — `dictionary.ts` vi, sau `'fb.mineNote'`: `'fb.updated': 'Mới cập nhật',` và `'fb.unseen': '{0} mục cần xem',`; en: `'fb.updated': 'Updated',` và `'fb.unseen': '{0} to look at',`.

- [ ] **Step 5: `AppShell.tsx`** — prop `unseen = 0` (kiểu `unseen?: number`, comment "What is waiting on the reports screen (0088)"); import `NavCount, NavDot`; trong `menuItems`, nhánh không phải nhóm:

```tsx
      : {
          key: item.key,
          icon: item.key === '/feedback'
            ? <NavDot count={unseen} label={unseenLabel}>{ICONS[item.key]}</NavDot>
            : ICONS[item.key],
          label: (
            <Link href={item.key}>
              {t(item.labelKey)}
              {item.key === '/feedback' && <NavCount count={unseen} label={unseenLabel} />}
              <NavPending />
            </Link>
          ),
        },
```

với `const unseenLabel = t('fb.unseen').replace('{0}', String(unseen))` trước `menuItems`.

- [ ] **Step 6: `layout.tsx`** — trước `return`:

```tsx
  // What is waiting on the reports screen for this reader (0088). A read that
  // fails is no badge, never a broken shell.
  const { data: unseen } = await supabase.rpc('feedback_unseen')
```

và `<AppShell role={user.role} email={user.email} unseen={Number(unseen ?? 0)}>`.

- [ ] **Step 7: `actions.ts`** — cuối file:

```ts
/**
 * Opening the reports screen is looking at it (spec 2026-09-18): from now the
 * menu stops calling this person back until something else moves (0088).
 */
export async function markFeedbackSeen(): Promise<{ ok: boolean }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('mark_feedback_seen')
  if (error) return { ok: false }
  revalidatePath('/feedback')
  return { ok: true }
}
```

- [ ] **Step 8: `feedback/page.tsx`** — trước truy vấn danh sách: `const { data: seenAt } = await supabase.rpc('feedback_seen_at')` (comment: đọc trước khi màn hình ghi nhận đã xem, để lần mở này vẫn thấy cái vừa đổi); select thêm `triaged_at`; mỗi dòng thêm `changedAt: (r.triaged_at as string) ?? null`; `FeedbackQueue` thêm `seenAt={(seenAt as string | null) ?? null}`.

- [ ] **Step 9: `FeedbackQueue.tsx`**
  - `ReportRow` thêm `/** When its status last moved; null while it has not. */ changedAt: string | null`.
  - props thêm `seenAt: string | null` kèm comment.
  - import `useEffect, useRef`, `markFeedbackSeen`.
  - trong component, sau `useLocale()`:

```tsx
  const router = useRouter()
  // Opening this screen is looking at it: marked once, then the shell is read
  // again so the badge on the menu goes out at once (spec 2026-09-18).
  const marked = useRef(false)
  useEffect(() => {
    if (marked.current) return
    marked.current = true
    void markFeedbackSeen().then((r) => { if (r.ok) router.refresh() })
  }, [router])

  /** Their own report, moved since they last looked. */
  const updated = (r: ReportRow) => r.mine && r.changedAt !== null
    && (seenAt === null || Date.parse(r.changedAt) > Date.parse(seenAt))
```

  - ô trạng thái, sau badge/Triage: `{updated(r) && <><br /><span className={styles.updated}>{t('fb.updated')}</span></>}`.
  - `Feedback.module.css`: `.updated { color: var(--pc-danger, #c62828); font-weight: 600; font-size: 12px; }` (dùng token màu đỏ đang có trong file nếu có).

- [ ] **Step 10: Kiểm tra, commit** — `npx tsc --noEmit`, `npx eslint src tests/lib`, `npx vitest run tests/lib`; `git commit -m "feat(feedback): a red count on the menu, and what moved marked on the screen"`

---

### Task 3: Trình duyệt, cổng, đưa lên

- [ ] **Step 1: `verify-feedback.mjs`**
  - Quản trị, ngay sau khi đăng nhập và **trước** khi mở `/feedback`: vào `/`, kiểm tra mục "Báo lỗi" trong menu có số ≥ 1 (`.pc-nav-count`).
  - Sau khi quản trị chuyển báo cáo sang LOOKING rồi DECLINED: mở context kế toán mới, đăng nhập, vào `/`, kiểm tra có `.pc-nav-count` cạnh "Báo lỗi"; bấm "Báo lỗi", kiểm tra dòng của `SAID` có "Mới cập nhật"; tải lại, kiểm tra không còn `.pc-nav-count`.
- [ ] **Step 2: Cổng** — tsc, lint, `tests/lib`, `tests/sql` (một mình).
- [ ] **Step 3: Migrate** — `npm run migrate`; `npm run verify:live`.
- [ ] **Step 4: Trình duyệt cục bộ** — build, `next start -p 3149`, `verify:feedback`.
- [ ] **Step 5: Đẩy** — grep in 0; `git push origin main`; chờ Vercel; `verify:feedback` trên Production; `verify:live`.
