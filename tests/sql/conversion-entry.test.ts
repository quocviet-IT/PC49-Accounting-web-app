import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, asRole } from '../support/db'
import { GRAIN_TO_RP, NINI, conversionPayload } from '../support/conversion'

let db: PGlite
const KT = '11111111-1111-1111-1111-111111111111'
const GS = '22222222-2222-2222-2222-222222222222'

beforeAll(async () => {
  db = await createTestDb()
  await db.exec(`
    INSERT INTO auth.users (id, email)
      VALUES ('${KT}', 'accountant@ctyhp.vn'), ('${GS}', 'supervisor@ctyhp.vn');
    INSERT INTO pc49.app_user (id, full_name, role)
      VALUES ('${KT}', 'Ke toan', 'KT'), ('${GS}', 'Giam sat', 'GS_US');
  `)
}, 60_000)

afterAll(async () => { await db?.close() })

/** A leg written straight into the table, as the loader and the refining screen write them. */
async function rawLeg(v: {
  type: string; gold: string; uom: string; qty: number
  conversionId?: string | null; lotId?: string | null; doc?: string | null; date?: string
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_txn (txn_date, txn_type, gold_type_code, uom, qty, amount,
                                conversion_id, refining_lot_id, doc_no)
     VALUES ($1, $2::pc49.txn_type, $3, $4::pc49.uom, $5, 0, $6, $7, $8) RETURNING id`,
    [v.date ?? '2026-06-03', v.type, v.gold, v.uom, v.qty, v.conversionId ?? null,
     v.lotId ?? null, v.doc ?? null])
  return r.rows[0].id
}

async function rawConversion(kind = 'TRANSFER', note: string | null = null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO pc49.gold_conversion (conv_date, kind, note)
     VALUES ('2026-06-03', $1::pc49.conversion_kind, $2) RETURNING id`, [kind, note])
  return r.rows[0].id
}

describe('where a transfer leg leaves the gold', () => {
  it('keeps a conversion inside the vault: nothing goes to the refinery', async () => {
    const c = await rawConversion()
    const out = await rawLeg({ type: 'TRANSFER_OUT', gold: 'GRAIN', uom: 'GRAM', qty: -37.5, conversionId: c })
    const into = await rawLeg({ type: 'TRANSFER_IN', gold: 'RP', uom: 'LUONG', qty: 1, conversionId: c })
    await db.query(`SELECT pc49.post_gold_txn($1)`, [out])
    await db.query(`SELECT pc49.post_gold_txn($1)`, [into])
    const moves = await db.query<{ refinery: number; on_hand: string }>(
      `SELECT count(*) FILTER (WHERE m.bucket = 'AT_REFINERY')::int AS refinery,
              coalesce(sum(m.qty_gram) FILTER (WHERE m.bucket = 'ON_HAND'), 0)::float8::text AS on_hand
         FROM pc49.inventory_movement m WHERE m.source_id IN ($1, $2)`, [out, into])
    expect(moves.rows[0]).toEqual({ refinery: 0, on_hand: '0' })
  })

  it('still sends a refining lot to the refinery', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.MOVE') RETURNING id`)
    const leg = await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -30, lotId: lot.rows[0].id })
    await db.query(`SELECT pc49.post_gold_txn($1)`, [leg])
    const moves = await db.query<{ g: string }>(
      `SELECT coalesce(sum(qty_gram), 0)::float8::text AS g FROM pc49.inventory_movement
        WHERE source_id = $1 AND bucket = 'AT_REFINERY'`, [leg])
    expect(moves.rows[0].g).toBe('30')
  })
})

describe('what may not be corrected from the ledger', () => {
  it('names a refining lot leg, after every older reason', async () => {
    const lot = await db.query<{ id: string }>(
      `INSERT INTO pc49.refining_lot (lot_code) VALUES ('T.BLOCK') RETURNING id`)
    const leg = await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -12, lotId: lot.rows[0].id })
    const r = await db.query<{ code: string; reason: string }>(
      `SELECT pc49.correction_blocked_code($1) AS code, pc49.correction_blocked_reason($1) AS reason`, [leg])
    expect(r.rows[0]).toEqual({
      code: 'REFINING_LEG', reason: 'this row belongs to a refining lot; correct it on the refining screen',
    })
  })
})

describe('a conversion as a record of its own', () => {
  it('moves its revision whenever it changes', async () => {
    const c = await rawConversion()
    await db.query(`UPDATE pc49.gold_conversion SET note = 'doi lai' WHERE id = $1`, [c])
    const r = await db.query<{ revision: number }>(
      `SELECT revision FROM pc49.gold_conversion WHERE id = $1`, [c])
    expect(r.rows[0].revision).toBe(2)
  })

  it('is not cancelled without a reason', async () => {
    const c = await rawConversion()
    await expect(db.query(
      `UPDATE pc49.gold_conversion SET voided_at = now() WHERE id = $1`, [c]))
      .rejects.toThrow(/gold_conversion_void_needs_reason/)
  })
})

type SavedConversion = { conversionId: string; docNo: string; repeated: boolean }

async function saveConversion(key: string, body: string, as = KT): Promise<SavedConversion> {
  const r = await asRole(db, as, () => db.query<{ r: SavedConversion }>(
    `SELECT pc49.save_gold_conversion($1, $2::jsonb) AS r`, [key, body]))
  return r.rows[0].r
}

type Leg = { txn_type: string; gold_type_code: string; qty: string; grams: string; doc_no: string; posted: boolean }

async function legsOf(conversionId: string): Promise<Leg[]> {
  const r = await db.query<Leg>(
    `SELECT txn_type::text, gold_type_code, qty::float8::text AS qty, qty_gram::float8::text AS grams,
            doc_no, journal_entry_id IS NOT NULL AS posted
       FROM pc49.gold_txn WHERE conversion_id = $1
      ORDER BY (qty > 0), line_no`, [conversionId])
  return r.rows
}

const conversionCount = async () => (await db.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM pc49.gold_conversion`)).rows[0].n

describe('saving a conversion', () => {
  it('writes one conversion and its legs under one number, every leg posted', async () => {
    const saved = await saveConversion('grain-to-rp', conversionPayload(GRAIN_TO_RP))
    const conv = await db.query<{ doc_no: string; kind: string; completed: boolean; variance: string | null }>(
      `SELECT doc_no, kind::text, completed_at IS NOT NULL AS completed, variance_note AS variance
         FROM pc49.gold_conversion WHERE id = $1`, [saved.conversionId])
    expect(conv.rows[0]).toEqual({ doc_no: saved.docNo, kind: 'TRANSFER', completed: true, variance: null })
    expect(saved.docNo).toMatch(/^PC49-2606-\d{3}$/)

    const legs = await legsOf(saved.conversionId)
    expect(legs.map((l) => [l.txn_type, l.gold_type_code, l.qty])).toEqual([
      ['TRANSFER_OUT', 'GRAIN', '-637.5'], ['TRANSFER_IN', 'RP', '17'],
    ])
    expect(legs.every((l) => l.doc_no === saved.docNo && l.posted)).toBe(true)
  })

  it('weighs ounces and luong in grams, and finds the Nini exchange in balance', async () => {
    const saved = await saveConversion('nini', conversionPayload(NINI))
    const legs = await legsOf(saved.conversionId)
    expect(legs.map((l) => [l.gold_type_code, Number(l.grams)])).toEqual([
      ['RP', -150], ['CS', 62.21], ['OTH', 31.105], ['GRAIN', 56.7],
    ])
    const conv = await db.query<{ variance: string | null; partner: string }>(
      `SELECT variance_note AS variance, partner_code AS partner FROM pc49.gold_conversion WHERE id = $1`,
      [saved.conversionId])
    expect(conv.rows[0]).toEqual({ variance: null, partner: 'Nini' })
  })

  it('refuses weights that do not meet, unless somebody says why', async () => {
    const short = { ...NINI, in: [NINI.in[0], NINI.in[1], { goldTypeCode: 'GRAIN', uom: 'GRAM' as const, qty: 50 }] }
    const before = await conversionCount()
    await expect(saveConversion('short', conversionPayload(short)))
      .rejects.toThrow(/CONVERSION_UNBALANCED: out 150\.0000 in 143\.3150/)
    expect(await conversionCount()).toBe(before)

    const saved = await saveConversion('short-explained',
      conversionPayload(short, { varianceReason: 'hao hut khi nau' }))
    const conv = await db.query<{ note: string | null; reason: string }>(
      `SELECT variance_note AS note, variance_reason AS reason FROM pc49.gold_conversion WHERE id = $1`,
      [saved.conversionId])
    expect(conv.rows[0].note).toMatch(/percent difference/)
    expect(conv.rows[0].reason).toBe('hao hut khi nau')
  })

  it('writes Ra RP as Ra RP, and only from Grain into Rong Phung', async () => {
    const raRp = {
      kind: 'RA_RP' as const,
      out: [{ goldTypeCode: 'GRAIN', uom: 'GRAM' as const, qty: 600 }],
      in: [{ goldTypeCode: 'RP', uom: 'LUONG' as const, qty: 16 }],
    }
    const saved = await saveConversion('ra-rp', conversionPayload(raRp))
    expect((await legsOf(saved.conversionId)).map((l) => l.txn_type)).toEqual(['RA_RP', 'RA_RP'])

    await expect(saveConversion('ra-rp-wrong', conversionPayload({
      ...raRp, out: [{ goldTypeCode: '9999', uom: 'LUONG', qty: 16 }],
    }))).rejects.toThrow(/CONVERSION_RA_RP/)
  })

  it('needs something on both sides, and a quantity on every line', async () => {
    await expect(saveConversion('one-side', conversionPayload({ ...GRAIN_TO_RP, in: [] })))
      .rejects.toThrow(/CONVERSION_SIDES/)
    await expect(saveConversion('no-qty', conversionPayload({
      ...GRAIN_TO_RP, in: [{ goldTypeCode: 'RP', uom: 'LUONG', qty: 0 }],
    }))).rejects.toThrow(/CONVERSION_QTY: in 1/)
  })

  it('is one conversion however many times it is saved', async () => {
    const body = conversionPayload(GRAIN_TO_RP, { note: 'hai lan' })
    const first = await saveConversion('twice', body)
    const again = await saveConversion('twice', body)
    expect(first.repeated).toBe(false)
    expect(again).toEqual({ conversionId: first.conversionId, docNo: first.docNo, repeated: true })
    await expect(saveConversion('twice', conversionPayload(GRAIN_TO_RP, { note: 'khac' })))
      .rejects.toThrow(/REQUEST_KEY_REUSED/)
  })

  it('is refused to somebody who may only read', async () => {
    await expect(saveConversion('supervisor', conversionPayload(GRAIN_TO_RP), GS)).rejects.toThrow()
  })
})

async function correctConversion(key: string, original: string, revision: number, body: string,
  reason = 'bot 1 oz Other'): Promise<SavedConversion & { replaced?: string }> {
  const r = await asRole(db, KT, () => db.query<{ r: SavedConversion & { replaced?: string } }>(
    `SELECT pc49.correct_gold_conversion($1, $2, $3, $4, $5::jsonb) AS r`,
    [key, original, revision, reason, body]))
  return r.rows[0].r
}

async function voidConversion(original: string, reason = 'nhap trung'): Promise<number> {
  const r = await asRole(db, KT, () => db.query<{ n: number }>(
    `SELECT pc49.void_gold_conversion($1, $2) AS n`, [original, reason]))
  return r.rows[0].n
}

const revisionOfConversion = async (id: string) => (await db.query<{ revision: number }>(
  `SELECT revision FROM pc49.gold_conversion WHERE id = $1`, [id])).rows[0].revision

const liveLegs = async (conversionId: string) => (await db.query<{ n: string }>(
  `SELECT count(*)::text AS n FROM pc49.gold_txn WHERE conversion_id = $1 AND voided_at IS NULL`,
  [conversionId])).rows[0].n

/** Nini without the ounce of Other, made up with 31.105 g of Grain. */
const niniCorrected = conversionPayload({
  ...NINI,
  in: [NINI.in[0], { goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 56.7 }, { goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 31.105 }],
})

describe('correcting a conversion', () => {
  it('replaces every leg in one go and keeps the number', async () => {
    const saved = await saveConversion('fix-nini', conversionPayload(NINI))
    const fixed = await correctConversion('fix-nini-it', saved.conversionId,
      await revisionOfConversion(saved.conversionId), niniCorrected)
    expect(fixed.docNo).toBe(saved.docNo)
    expect(fixed.conversionId).not.toBe(saved.conversionId)

    const old = await db.query<{ voided: boolean; why: string }>(
      `SELECT voided_at IS NOT NULL AS voided, void_reason AS why FROM pc49.gold_conversion WHERE id = $1`,
      [saved.conversionId])
    expect(old.rows[0]).toEqual({ voided: true, why: 'bot 1 oz Other' })
    expect(await liveLegs(saved.conversionId)).toBe('0')

    const replacement = await db.query<{ corrects: string; legs: string; posted: string }>(
      `SELECT c.corrects_conversion_id::text AS corrects,
              (SELECT count(*)::text FROM pc49.gold_txn t WHERE t.conversion_id = c.id) AS legs,
              (SELECT count(*)::text FROM pc49.gold_txn t
                WHERE t.conversion_id = c.id AND t.journal_entry_id IS NOT NULL) AS posted
         FROM pc49.gold_conversion c WHERE c.id = $1`, [fixed.conversionId])
    expect(replacement.rows[0]).toEqual({ corrects: saved.conversionId, legs: '4', posted: '4' })
  })

  it('tells the second person to look again rather than overwrite', async () => {
    const saved = await saveConversion('race-conv', conversionPayload(NINI))
    const seen = await revisionOfConversion(saved.conversionId)
    await correctConversion('race-conv-1', saved.conversionId, seen, niniCorrected)
    await expect(correctConversion('race-conv-2', saved.conversionId, seen, niniCorrected))
      .rejects.toThrow(/CONFLICT/)
  })

  it('corrects a loaded conversion under the smallest number its legs carry', async () => {
    const c = await rawConversion('TRANSFER', '2026-06-03#1')
    await rawLeg({ type: 'TRANSFER_OUT', gold: '9999', uom: 'LUONG', qty: -1, conversionId: c, doc: 'PC49-2606-777' })
    await rawLeg({ type: 'TRANSFER_IN', gold: 'GRAIN', uom: 'GRAM', qty: 37.5, conversionId: c, doc: 'PC49-2606-775' })
    const fixed = await correctConversion('fix-loaded', c, await revisionOfConversion(c), conversionPayload({
      kind: 'TRANSFER',
      out: [{ goldTypeCode: '9999', uom: 'LUONG', qty: 1 }],
      in: [{ goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 37.5 }],
    }), 'tach phien nap')
    expect(fixed.docNo).toBe('PC49-2606-775')
    expect(await liveLegs(c)).toBe('0')
  })

  it('leaves a refining lot conversion to the refining screen', async () => {
    const c = await rawConversion('REFINING_SEND')
    await rawLeg({ type: 'TRANSFER_OUT', gold: 'SG', uom: 'GRAM', qty: -10, conversionId: c })
    await expect(correctConversion('fix-refining', c, await revisionOfConversion(c),
      conversionPayload(GRAIN_TO_RP))).rejects.toThrow(/CONVERSION_REFINING/)
    await expect(voidConversion(c)).rejects.toThrow(/CONVERSION_REFINING/)
  })

  it('returns the first correction when asked twice', async () => {
    const saved = await saveConversion('fix-twice-conv', conversionPayload(NINI, { note: 'hai lan sua' }))
    const seen = await revisionOfConversion(saved.conversionId)
    const first = await correctConversion('fix-twice-conv-it', saved.conversionId, seen, niniCorrected)
    const again = await correctConversion('fix-twice-conv-it', saved.conversionId, seen, niniCorrected)
    expect(again).toEqual({ conversionId: first.conversionId, docNo: first.docNo, repeated: true })
  })
})

describe('cancelling a conversion', () => {
  it('cancels every leg at once and gives the stock back', async () => {
    const saved = await saveConversion('cancel-conv', conversionPayload(GRAIN_TO_RP, { note: 'huy' }))
    expect(await voidConversion(saved.conversionId)).toBe(2)
    const state = await db.query<{ live: string; voided: boolean; grams: string }>(
      `SELECT (SELECT count(*)::text FROM pc49.gold_txn
                WHERE conversion_id = $1 AND voided_at IS NULL) AS live,
              (SELECT voided_at IS NOT NULL FROM pc49.gold_conversion WHERE id = $1) AS voided,
              (SELECT coalesce(sum(m.qty_gram), 0)::float8::text
                 FROM pc49.inventory_movement m JOIN pc49.gold_txn t ON t.id = m.source_id
                WHERE t.conversion_id = $1) AS grams`, [saved.conversionId])
    expect(state.rows[0]).toEqual({ live: '0', voided: true, grams: '0' })
    await expect(voidConversion(saved.conversionId)).rejects.toThrow(/CONVERSION_VOIDED/)
  })
})
