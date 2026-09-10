export type LotStatus = 'DRAFT' | 'SENT' | 'ASSAYED' | 'RECEIVED' | 'CLOSED'

export const LOT_STAGES: LotStatus[] = ['DRAFT', 'SENT', 'ASSAYED', 'RECEIVED', 'CLOSED']

export type Lot = {
  id: string
  lotCode: string
  status: LotStatus
  refineryName: string | null
  note: string | null
  sentDate: string | null
  assayDate: string | null
  receivedDate: string | null
  spotGoldSent: number | null
  spotPtSent: number | null
  spotGoldAssay: number | null
  spotPtAssay: number | null
  feePctGold: number | null
  feePctPt: number | null
}

/** One bag, as the green (send) and blue (assay) tables read it. */
export type Bag = {
  id: string
  lotId: string
  seq: number
  ownerCode: string
  metal: 'GOLD' | 'PLATINUM'
  goldTypeCode: string | null
  sourceDesc: string | null
  // green — what was sent, priced at the send-day spot
  grossWeightGram: number | null
  goldPct: number | null
  pureWeightGram: number | null
  spotPerOzSent: number | null
  lossPct: number | null
  estimatedValue: number | null
  // blue — what the refinery weighed and assayed, priced at the assay-day spot
  spotPerOzAssay: number | null
  assayWeightGram: number | null
  assayPct: number | null
  assayPureWeightGram: number | null
  assayValue: number | null
  // what the assay changed
  purityVariance: number | null
  weightVariance: number | null
  valueVariance: number | null
}

export type LotRow = Lot & {
  bagCount: number
  totalGrossGram: number
  totalAssayGram: number
  estimatedValue: number
  assayValue: number
}

/** A scrap purchase that could go into a lot — the row beside the checkbox. */
export type Purchase = {
  id: string
  txnDate: string
  docNo: string | null
  partnerCode: string | null
  goldTypeCode: string
  scrapDetail: string | null
  goldPct: number | null
  gradeBand: string | null
  qtyGram: number
  amount: number
}

/** The picked purchases, totalled the way the batch tab does. */
export type BandTotal = {
  gradeBand: string | null
  goldTypeCode: string
  purchaseCount: number
  grossWeightGram: number
  pureWeightGram: number | null
  avgGoldPct: number | null
  totalCost: number
}

export type OwnerShare = {
  ownerCode: string
  assayWeightGram: number
  sharePct: number
  receivedGram: number
}

export type Receipt = {
  id: string
  ownerCode: string
  receiveDate: string
  settleKind: 'METAL' | 'CASH'
  goldTypeCode: string
  qtyGram: number | null
  amountUsd: number | null
}

export type GoldOption = { code: string; nameVi: string; nameEn: string }
