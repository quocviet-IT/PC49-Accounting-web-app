/**
 * Two conversions from the client's own books, as the screen sends them.
 *
 *   GRAIN_TO_RP   "Transfer 637.5gr vang Grain ra 17L VRP" (07-06)
 *   NINI          "Dua 4L VRP ... doi Nini 2oz CS, 1oz Other, 56.7gr vang Grain" (08-05):
 *                 150 g out, 150.015 g in, 0.01 percent apart
 */
export type ConvLine = { goldTypeCode: string; uom: 'GRAM' | 'OZ' | 'LUONG'; qty: number }

export type ConvBase = {
  kind: 'TRANSFER' | 'RA_RP'
  partnerCode?: string | null
  out: ConvLine[]
  in: ConvLine[]
}

export const GRAIN_TO_RP: ConvBase = {
  kind: 'TRANSFER',
  out: [{ goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 637.5 }],
  in: [{ goldTypeCode: 'RP', uom: 'LUONG', qty: 17 }],
}

export const NINI: ConvBase = {
  kind: 'TRANSFER',
  partnerCode: 'Nini',
  out: [{ goldTypeCode: 'RP', uom: 'LUONG', qty: 4 }],
  in: [
    { goldTypeCode: 'CS', uom: 'OZ', qty: 2 },
    { goldTypeCode: 'OTH', uom: 'OZ', qty: 1 },
    { goldTypeCode: 'GRAIN', uom: 'GRAM', qty: 56.7 },
  ],
}

export function conversionPayload(base: ConvBase, over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    convDate: '2026-06-03',
    partnerCode: null,
    note: 'quy doi',
    varianceReason: null,
    ...base,
    ...over,
  })
}
