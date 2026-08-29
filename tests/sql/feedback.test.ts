import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { asRole, asUser, createTestDb } from '../support/db'

const BOSS = '00000000-0000-0000-0000-0000000000a1'
const CLERK = '00000000-0000-0000-0000-0000000000b2'

let db: PGlite
beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${BOSS}', 'boss@example.com'), ('${CLERK}', 'clerk@example.com');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES
      ('${BOSS}', 'Boss', 'ADMIN'), ('${CLERK}', 'Clerk', 'KT');
  `)
}, 60_000)
afterAll(async () => { await db?.close() })

/** Triage is an administrator's job, so every triage test speaks as one. */
function triage(sql: string, params: unknown[] = []) {
  return asUser(db, BOSS, () => db.query(sql, params))
}

async function file(description: string, kind = 'BROKEN', impact = 'SLOWS_WORK') {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.feedback_report
       (kind, impact, description, page_url, page_route, page_title)
     VALUES ($1, $2, $3, '/prices?date=2026-01-15', '/prices', 'Giá vàng theo ngày')
     RETURNING id`, [kind, impact, description])
  return r.rows[0].id
}

describe('filing a report', () => {
  it('keeps the page it was filed from, address and all', async () => {
    // "The report was wrong" and "the report for January was wrong" are
    // different reports; the address is what tells them apart.
    const id = await file('the total does not match the sheet')
    const r = await db.query<{ url: string; route: string; status: string }>(
      `SELECT page_url AS url, page_route AS route, status::text
         FROM pc49.feedback_report WHERE id = $1`, [id])
    expect(r.rows[0].url).toBe('/prices?date=2026-01-15')
    expect(r.rows[0].route).toBe('/prices')
    expect(r.rows[0].status).toBe('NEW')
  })

  it('refuses a report with nothing in it', async () => {
    // A report nobody can act on wastes the reporter's goodwill as well as the
    // reader's time.
    await expect(file('   ')).rejects.toThrow()
    await expect(file('')).rejects.toThrow()
  })

  it('takes all three kinds', async () => {
    for (const kind of ['BROKEN', 'WRONG_NUMBER', 'SUGGESTION']) {
      await expect(file(`a ${kind} report`, kind)).resolves.toBeTruthy()
    }
  })
})

describe('a filed report is evidence', () => {
  it('refuses to have its words changed afterwards', async () => {
    const id = await file('the closing balance is out by 250')
    await expect(
      db.query(`UPDATE pc49.feedback_report SET description = 'never mind' WHERE id = $1`, [id]),
    ).rejects.toThrow(/only its status may change/)
  })

  it('refuses to have the page it came from rewritten', async () => {
    const id = await file('this screen is empty')
    await expect(
      db.query(`UPDATE pc49.feedback_report SET page_url = '/somewhere-else' WHERE id = $1`, [id]),
    ).rejects.toThrow(/only its status may change/)
  })

  it('lets the status move', async () => {
    const id = await file('a slow page')
    await triage(`SELECT pc49.set_feedback_status($1, 'LOOKING')`, [id])
    const r = await db.query<{ s: string }>(
      `SELECT status::text AS s FROM pc49.feedback_report WHERE id = $1`, [id])
    expect(r.rows[0].s).toBe('LOOKING')
  })
})

describe('triage', () => {
  it('records who moved it and when', async () => {
    const id = await file('the grid loses a row')
    await triage(`SELECT pc49.set_feedback_status($1, 'FIXED', 'the double-count is gone')`, [id])
    const r = await db.query<{ at: string | null; note: string }>(
      `SELECT triaged_at::text AS at, triage_note AS note
         FROM pc49.feedback_report WHERE id = $1`, [id])
    expect(r.rows[0].at).not.toBeNull()
    expect(r.rows[0].note).toBe('the double-count is gone')
  })

  it('refuses to decline a report without telling the reporter why', async () => {
    // A report declined in silence is the one that teaches somebody not to file
    // the next one.
    const id = await file('please make the font bigger', 'SUGGESTION')
    await expect(
      triage(`SELECT pc49.set_feedback_status($1, 'DECLINED')`, [id]),
    ).rejects.toThrow(/needs a reason the reporter can read/)

    await triage(
      `SELECT pc49.set_feedback_status($1, 'DECLINED', 'the browser zoom does this already')`,
      [id])
    const r = await db.query<{ s: string; note: string }>(
      `SELECT status::text AS s, triage_note AS note FROM pc49.feedback_report WHERE id = $1`,
      [id])
    expect(r.rows[0].s).toBe('DECLINED')
    expect(r.rows[0].note).toMatch(/browser zoom/)
  })

  it('audits every move, with what it moved from', async () => {
    const id = await file('a wrong figure', 'WRONG_NUMBER')
    await triage(`SELECT pc49.set_feedback_status($1, 'LOOKING')`, [id])
    await triage(`SELECT pc49.set_feedback_status($1, 'FIXED', 'rounding')`, [id])
    const r = await db.query<{ before: string; after: string }>(
      `SELECT before->>'status' AS before, after->>'status' AS after
         FROM pc49.audit_log
        WHERE entity_type = 'feedback_report' AND entity_id = $1::text
        ORDER BY at`, [id])
    expect(r.rows.map((x) => [x.before, x.after]))
      .toEqual([['NEW', 'LOOKING'], ['LOOKING', 'FIXED']])
  })

  it('says so when the report does not exist', async () => {
    await expect(
      triage(
        `SELECT pc49.set_feedback_status('00000000-0000-0000-0000-000000000000', 'FIXED')`),
    ).rejects.toThrow(/does not exist/)
  })

  it('keeps an earlier note when a later move adds none', async () => {
    const id = await file('something odd')
    await triage(`SELECT pc49.set_feedback_status($1, 'LOOKING', 'reproduced on Tuesday')`, [id])
    await triage(`SELECT pc49.set_feedback_status($1, 'FIXED')`, [id])
    const r = await db.query<{ note: string }>(
      `SELECT triage_note AS note FROM pc49.feedback_report WHERE id = $1`, [id])
    expect(r.rows[0].note).toBe('reproduced on Tuesday')
  })
})

describe('triage under the permissions the application actually has', () => {
  // These run as `authenticated` rather than as the database owner, so they
  // exercise grants and row-level security. The rest of this file does not, and
  // that is how a triage function with no write access to the audit log passed
  // every test above and then did nothing at all when somebody clicked it.
  it('moves a report, audit entry and all', async () => {
    const id = await file('the totals row is blank')
    await asRole(db, BOSS, () =>
      db.query(`SELECT pc49.set_feedback_status($1, 'LOOKING')`, [id]))
    const r = await db.query<{ s: string; audits: number }>(
      `SELECT status::text AS s,
              (SELECT count(*)::int FROM pc49.audit_log
                WHERE entity_type = 'feedback_report' AND entity_id = $2) AS audits
         FROM pc49.feedback_report WHERE id = $1`, [id, id])
    expect(r.rows[0].s).toBe('LOOKING')
    expect(r.rows[0].audits).toBe(1)
  })

  it('will not let the person who filed it decide it is fixed', async () => {
    const id = await file('the export downloads an empty file')
    await expect(
      asRole(db, CLERK, () =>
        db.query(`SELECT pc49.set_feedback_status($1, 'FIXED')`, [id])),
    ).rejects.toThrow(/only an administrator/)
  })

  it('will not let a signed-out caller move one either', async () => {
    const id = await file('a stray comma in the address')
    await expect(
      asRole(db, '', () => db.query(`SELECT pc49.set_feedback_status($1, 'FIXED')`, [id])),
    ).rejects.toThrow(/only an administrator/)
  })
})

describe('the picture of the screen', () => {
  // The path is written once, by the upload linking itself, and never again.
  // The first version of this elsewhere had two ways to lose a screenshot: the
  // table has no UPDATE policy so a client write changed nothing silently, and
  // the evidence trigger refused the link outright. Reports arrived with the
  // picture stored and unreferenced, and nobody was told.
  it('can be attached once after the report is filed', async () => {
    const id = await file('the closing figure is out by 250')
    const path = `${id}/11111111-1111-4111-8111-111111111111.png`
    await db.query(`UPDATE pc49.feedback_report SET screenshot_path = $2 WHERE id = $1`,
                   [id, path])
    const r = await db.query<{ p: string }>(
      `SELECT screenshot_path AS p FROM pc49.feedback_report WHERE id = $1`, [id])
    expect(r.rows[0].p).toBe(path)
  })

  it('cannot be swapped for another afterwards', async () => {
    const id = await file('a wrong total on the day sheet')
    await db.query(
      `UPDATE pc49.feedback_report SET screenshot_path = $2 WHERE id = $1`,
      [id, `${id}/22222222-2222-4222-8222-222222222222.png`])
    await expect(
      db.query(`UPDATE pc49.feedback_report SET screenshot_path = $2 WHERE id = $1`,
               [id, `${id}/33333333-3333-4333-8333-333333333333.png`]),
    ).rejects.toThrow(/cannot be replaced or removed/)
  })

  it('cannot be taken away afterwards', async () => {
    const id = await file('the export came down empty')
    await db.query(
      `UPDATE pc49.feedback_report SET screenshot_path = $2 WHERE id = $1`,
      [id, `${id}/44444444-4444-4444-8444-444444444444.png`])
    await expect(
      db.query(`UPDATE pc49.feedback_report SET screenshot_path = NULL WHERE id = $1`, [id]),
    ).rejects.toThrow(/cannot be replaced or removed/)
  })

  it('leaves the words alone either way', async () => {
    const id = await file('a slow screen')
    await db.query(
      `UPDATE pc49.feedback_report SET screenshot_path = $2 WHERE id = $1`,
      [id, `${id}/55555555-5555-4555-8555-555555555555.png`])
    await expect(
      db.query(`UPDATE pc49.feedback_report SET description = 'never mind' WHERE id = $1`, [id]),
    ).rejects.toThrow(/only its status may change/)
  })
})

describe('where a screenshot may be written', () => {
  // The storage policy calls this, and it is the only thing between an
  // authenticated browser and the bucket. Anything it lets through can be
  // uploaded by anyone signed in.
  async function allowed(name: string, asUserId: string) {
    return asUser(db, asUserId, async () => {
      const r = await db.query<{ ok: boolean }>(
        `SELECT pc49.feedback_screenshot_path_allowed($1) AS ok`, [name])
      return r.rows[0].ok
    })
  }

  it('accepts the reporter\'s own report, with a uuid and a png', async () => {
    const id = await asUser(db, CLERK, () => db.query<{ id: string }>(
      `INSERT INTO pc49.feedback_report
         (kind, impact, description, page_url, page_route, reporter_id)
       VALUES ('BROKEN', 'MINOR', 'a path check', '/prices', '/prices', $1)
       RETURNING id`, [CLERK]).then((r) => r.rows[0].id))
    expect(await allowed(`${id}/66666666-6666-4666-8666-666666666666.png`, CLERK)).toBe(true)
  })

  it('refuses somebody else\'s report', async () => {
    const id = await asUser(db, CLERK, () => db.query<{ id: string }>(
      `INSERT INTO pc49.feedback_report
         (kind, impact, description, page_url, page_route, reporter_id)
       VALUES ('BROKEN', 'MINOR', 'not yours', '/prices', '/prices', $1)
       RETURNING id`, [CLERK]).then((r) => r.rows[0].id))
    // Even the administrator: writing into somebody's report is not triage.
    expect(await allowed(`${id}/77777777-7777-4777-8777-777777777777.png`, BOSS)).toBe(false)
  })

  it('refuses a path that is not a report at all', async () => {
    expect(await allowed('anything.png', CLERK)).toBe(false)
    expect(await allowed('../secrets.png', CLERK)).toBe(false)
    expect(await allowed('a/b/c.png', CLERK)).toBe(false)
    expect(await allowed(
      '00000000-0000-0000-0000-000000000000/88888888-8888-4888-8888-888888888888.png',
      CLERK)).toBe(false)
  })

  it('refuses anything that is not a png', async () => {
    const id = await asUser(db, CLERK, () => db.query<{ id: string }>(
      `INSERT INTO pc49.feedback_report
         (kind, impact, description, page_url, page_route, reporter_id)
       VALUES ('BROKEN', 'MINOR', 'a type check', '/prices', '/prices', $1)
       RETURNING id`, [CLERK]).then((r) => r.rows[0].id))
    for (const ext of ['svg', 'html', 'js', 'exe']) {
      expect(await allowed(`${id}/99999999-9999-4999-8999-999999999999.${ext}`, CLERK)).toBe(false)
    }
  })
})
