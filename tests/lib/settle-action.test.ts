/*
 * What a screen gets back when it calls a server action.
 *
 * The bug this exists for: on 16-09 an accountant pressed Save on a gold
 * transaction and both buttons spun for ever. Production had been redeployed
 * while the form was open, the page called its save by an id the new build did
 * not have, and the call threw instead of answering. The form waited for an
 * answer that never came, wrote nothing and said nothing.
 *
 * So a throw becomes an answer the screen can read, and the one cause a person
 * can fix themselves — a page older than the server — is named as such.
 */
import { describe, it, expect } from 'vitest'
import { settleAction } from '@/lib/ui/settleAction'

type Saved = { ok: true; docNo: string } | { ok: false; message: string }

const throws = (value: unknown) => async (): Promise<Saved> => { throw value }

describe('calling a server action from a screen', () => {
  it('hands back what the action answered', async () => {
    expect(await settleAction(async (): Promise<Saved> => ({ ok: true, docNo: 'PC49-2609-010' })))
      .toEqual({ ok: true, docNo: 'PC49-2609-010' })
  })

  it('hands back a refusal the action answered, untouched', async () => {
    expect(await settleAction(async (): Promise<Saved> => ({ ok: false, message: 'period 2026-09 is closed' })))
      .toEqual({ ok: false, message: 'period 2026-09 is closed' })
  })

  it('says the page is older than the server when the action is not found', async () => {
    // Word for word what Next.js threw on Production.
    const said = 'Server Action "40de817b85a3a80824668bdf4186f3f95f0243cfb8" was not found on the server. '
      + 'Read more: https://nextjs.org/docs/messages/failed-to-find-server-action'
    const r = await settleAction(throws(new Error(said)))
    expect(r).toEqual({ ok: false, reason: 'STALE', message: said })
  })

  it('says the connection dropped when the request never arrived', async () => {
    const r = await settleAction(throws(new TypeError('Failed to fetch')))
    expect(r).toEqual({ ok: false, reason: 'NETWORK', message: 'Failed to fetch' })
  })

  it('keeps what anything else thrown said', async () => {
    const r = await settleAction(throws(new Error('An unexpected response was received from the server.')))
    expect(r).toEqual({
      ok: false, reason: 'SERVER', message: 'An unexpected response was received from the server.',
    })
  })

  it('reads a thrown value that is not an error', async () => {
    const r = await settleAction(throws('boom'))
    expect(r).toEqual({ ok: false, reason: 'SERVER', message: 'boom' })
  })
})
