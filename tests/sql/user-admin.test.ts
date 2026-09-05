import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'

let db: PGlite

// Two administrators, so that tests about the last one can take one away and
// still have something to look at.
const BOSS = '11111111-1111-1111-1111-111111111111'
const SECOND = '22222222-2222-2222-2222-222222222222'
const CLERK = '33333333-3333-3333-3333-333333333333'
const OWNER = '44444444-4444-4444-4444-444444444444'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${BOSS}',   'boss@pc49.test'),
      ('${SECOND}', 'second@pc49.test'),
      ('${CLERK}',  'clerk@pc49.test'),
      ('${OWNER}',  'owner@pc49.test');
    INSERT INTO pc49.app_user (id, full_name, role) VALUES
      ('${BOSS}',   'Boss',   'ADMIN'),
      ('${SECOND}', 'Second', 'ADMIN'),
      ('${CLERK}',  'Clerk',  'KT'),
      ('${OWNER}',  'Owner',  'OC');
  `)
}, 60_000)

afterAll(async () => { await db?.close() })

/** Puts the four back the way `beforeAll` left them. */
async function reset() {
  await db.exec(`
    UPDATE pc49.app_user SET role = 'ADMIN', suspended_at = NULL WHERE id IN ('${BOSS}', '${SECOND}');
    UPDATE pc49.app_user SET role = 'KT',    suspended_at = NULL WHERE id = '${CLERK}';
    UPDATE pc49.app_user SET role = 'OC',    suspended_at = NULL WHERE id = '${OWNER}';
  `)
}

describe('only an administrator may administer', () => {
  it('refuses the list of people to everybody else', async () => {
    await asRole(db, CLERK, async () => {
      await expect(db.query('SELECT * FROM pc49.user_directory()'))
        .rejects.toThrow(/only an administrator may see the list/)
    })
  })

  it('gives an administrator everybody, with their address', async () => {
    const rows = await asRole(db, BOSS, () =>
      db.query<{ email: string; full_name: string }>('SELECT * FROM pc49.user_directory()'))
    expect(rows.rows).toHaveLength(4)
    // The address comes from auth.users and is not copied into app_user, so
    // this is also the proof that the join is the only place it lives.
    expect(rows.rows.map((r) => r.email)).toContain('clerk@pc49.test')
  })

  it('refuses every change to somebody who is not an administrator', async () => {
    await asRole(db, CLERK, async () => {
      await expect(db.query(`SELECT pc49.set_user_role('${OWNER}', 'ADMIN')`))
        .rejects.toThrow(/only an administrator/)
      await expect(db.query(`SELECT pc49.suspend_user('${OWNER}', 'no reason')`))
        .rejects.toThrow(/only an administrator/)
      await expect(db.query(`SELECT pc49.restore_user('${OWNER}')`))
        .rejects.toThrow(/only an administrator/)
      await expect(db.query(`SELECT pc49.rename_user('${OWNER}', 'Nope')`))
        .rejects.toThrow(/only an administrator/)
    })
  })
})

describe('an administrator acting on themselves', () => {
  afterAll(reset)

  it('may step down while somebody else holds the job', async () => {
    // Handing over is a real thing people do, and forbidding it outright is
    // what made the last-administrator rule unreachable.
    await asRole(db, BOSS, () => db.query(`SELECT pc49.set_user_role('${BOSS}', 'KT')`))
    const r = await db.query<{ role: string }>(
      `SELECT role::text FROM pc49.app_user WHERE id = '${BOSS}'`)
    expect(r.rows[0].role).toBe('KT')
    await reset()
  })

  it('may not close their own account', async () => {
    // Stepping down leaves you signed in as something. Closing yourself leaves
    // you signed in as nothing, and the undo is behind the door you just locked.
    await asRole(db, BOSS, async () => {
      await expect(db.query(`SELECT pc49.suspend_user('${BOSS}', 'leaving')`))
        .rejects.toThrow(/cannot close their own account/)
    })
  })

  it('says so plainly when the person does not exist', async () => {
    await asRole(db, BOSS, async () => {
      await expect(
        db.query(`SELECT pc49.set_user_role('99999999-9999-9999-9999-999999999999', 'KT')`),
      ).rejects.toThrow(/no such person/)
    })
  })
})

describe('somebody has to be left to administer', () => {
  afterAll(reset)

  it('lets one step down while another remains', async () => {
    await asRole(db, BOSS, () => db.query(`SELECT pc49.set_user_role('${SECOND}', 'KT')`))
    const r = await db.query<{ role: string }>(
      `SELECT role::text FROM pc49.app_user WHERE id = '${SECOND}'`)
    expect(r.rows[0].role).toBe('KT')
  })

  it('refuses to let the last one step down', async () => {
    // SECOND is a clerk after the test above, so BOSS is the only one left.
    await asRole(db, BOSS, async () => {
      await expect(db.query(`SELECT pc49.set_user_role('${BOSS}', 'KT')`))
        .rejects.toThrow(/nobody able to administer/)
    })
  })

  it('refuses to close the last one', async () => {
    // A suspended administrator cannot call anything, so the only way to reach
    // this is a second administrator whose own account is closed — which is
    // exactly the state that makes the count, not the names, the thing to read.
    await reset()
    await db.exec(`UPDATE pc49.app_user SET suspended_at = now() WHERE id = '${SECOND}'`)
    await asRole(db, BOSS, async () => {
      await expect(db.query(`SELECT pc49.suspend_user('${BOSS}', 'leaving')`))
        .rejects.toThrow(/cannot close their own account/)
    })
    // And BOSS may not be demoted either, being the only one active.
    await asRole(db, BOSS, async () => {
      await expect(db.query(`SELECT pc49.set_user_role('${BOSS}', 'OC')`))
        .rejects.toThrow(/nobody able to administer/)
    })
  })

  it('counts only administrators who can actually sign in', async () => {
    // A suspended administrator is not somebody who can administer anything.
    await reset()
    await db.exec(`UPDATE pc49.app_user SET suspended_at = now() WHERE id = '${SECOND}'`)
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.app_user
        WHERE role = 'ADMIN' AND suspended_at IS NULL AND is_active`)
    expect(Number(r.rows[0].n)).toBe(1)
  })
})

describe('closing an account', () => {
  afterAll(reset)

  it('needs a reason', async () => {
    await asRole(db, BOSS, async () => {
      await expect(db.query(`SELECT pc49.suspend_user('${CLERK}', '   ')`))
        .rejects.toThrow(/needs a reason/)
    })
  })

  it('takes the role away entirely', async () => {
    await asRole(db, BOSS, () =>
      db.query(`SELECT pc49.suspend_user('${CLERK}', 'nghỉ việc từ 30-09')`))
    // Not "has a role but may not use it": effective_role returns nothing at
    // all, which is what every policy in the system reads.
    const r = await asRole(db, CLERK, () =>
      db.query<{ r: string | null }>(`SELECT pc49.effective_role()::text AS r`))
    expect(r.rows[0].r).toBeNull()
  })

  it('and giving it back restores them', async () => {
    await asRole(db, BOSS, () => db.query(`SELECT pc49.restore_user('${CLERK}')`))
    const r = await asRole(db, CLERK, () =>
      db.query<{ r: string }>(`SELECT pc49.effective_role()::text AS r`))
    expect(r.rows[0].r).toBe('KT')
  })
})

describe('what was done is recorded', () => {
  afterAll(reset)

  async function rowsFor(id: string): Promise<number> {
    const r = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pc49.audit_log
        WHERE entity_type = 'app_user' AND entity_id = '${id}'`)
    return Number(r.rows[0].n)
  }

  it('writes one audit row per change, naming who made it', async () => {
    const before = await rowsFor(OWNER)

    await asRole(db, BOSS, async () => {
      await db.query(`SELECT pc49.set_user_role('${OWNER}', 'KT')`)
      await db.query(`SELECT pc49.rename_user('${OWNER}', 'Owner Renamed')`)
    })

    expect(await rowsFor(OWNER)).toBe(before + 2)

    const who = await db.query<{ actor: string }>(
      `SELECT actor::text FROM pc49.audit_log
        WHERE entity_type = 'app_user' AND entity_id = '${OWNER}'
        ORDER BY id DESC LIMIT 2`)
    expect(who.rows.every((r) => r.actor === BOSS)).toBe(true)
  })

  it('does not write a row for a change that changes nothing', async () => {
    // Setting a role to the role somebody already has is not an event, and a
    // log full of non-events is a log nobody reads.
    const before = await rowsFor(CLERK)
    await asRole(db, BOSS, () => db.query(`SELECT pc49.set_user_role('${CLERK}', 'KT')`))
    expect(await rowsFor(CLERK)).toBe(before)
  })
})

describe('the temporary password flag', () => {
  it('starts off', async () => {
    const r = await db.query<{ f: boolean }>(
      `SELECT must_change_password AS f FROM pc49.app_user WHERE id = '${CLERK}'`)
    expect(r.rows[0].f).toBe(false)
  })

  it('is cleared only by the person holding it', async () => {
    await db.exec(
      `UPDATE pc49.app_user SET must_change_password = true WHERE id = '${CLERK}'`)

    // An administrator clearing it would leave a temporary password in place
    // while the system stopped asking for it to be changed.
    await asRole(db, BOSS, () => db.query('SELECT pc49.password_was_changed()'))
    const still = await db.query<{ f: boolean }>(
      `SELECT must_change_password AS f FROM pc49.app_user WHERE id = '${CLERK}'`)
    expect(still.rows[0].f).toBe(true)

    await asRole(db, CLERK, () => db.query('SELECT pc49.password_was_changed()'))
    const cleared = await db.query<{ f: boolean }>(
      `SELECT must_change_password AS f FROM pc49.app_user WHERE id = '${CLERK}'`)
    expect(cleared.rows[0].f).toBe(false)
  })
})
