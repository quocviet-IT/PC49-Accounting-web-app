'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Signed, weight, ledger, Frame } from '@/components/ledger/Ledger'
import { ReceiveRow } from './ReceiveRow'
import { AddLine, AdvanceLot, NewLot, type GoldOption } from './LotLifecycle'
import { PurchasePicker, type AvailablePurchase, type PickedBand } from './PurchasePicker'
import { LotLines, type LotLineValue } from './LotLines'
import styles from './Refining.module.css'

export type LotRow = {
  lotId: string
  lotCode: string
  status: string
  sentDate: string | null
  assayDate: string | null
  receivedDate: string | null
  totalGrossGram: number
  totalAssayGram: number
  spotVariancePerGram: number | null
  spotVarianceValue: number | null
}

export type ShareRow = {
  lotId: string
  ownerCode: string
  assayWeightGram: number
  sharePct: number
  receivedGram: number
}

/** What an owner put in, less what has come back. */
function owedBy(s: ShareRow): number {
  return Math.max(0, Math.round((s.assayWeightGram - s.receivedGram) * 10000) / 10000)
}

/**
 * Gold can only be received once the refinery has weighed the lot, and a closed
 * lot is closed. The database refuses the rest; this only avoids offering a
 * control that would be refused.
 */
function canReceive(status: string): boolean {
  return status === 'ASSAYED' || status === 'RECEIVED'
}

export function RefiningView({
  available,
  pickedByLot,
  bandsByLot,
  linesByLot,
  lots, shares, goldTypes,
}: {
  lots: LotRow[]
  shares: ShareRow[]
  goldTypes: GoldOption[]
  available: AvailablePurchase[]
  pickedByLot: Record<string, AvailablePurchase[]>
  bandsByLot: Record<string, PickedBand[]>
  linesByLot: Record<string, LotLineValue[]>
}) {
  const { t } = useLocale()

  // An empty screen still has to offer the way in. This used to return early
  // with nothing but "no data", which meant a system with no lots yet could
  // never open its first one.
  if (lots.length === 0) {
    return (
      <Page titleKey="refining.title">
        <div className={styles.actions}><NewLot /></div>
        <Empty />
      </Page>
    )
  }

  return (
    <Page titleKey="refining.title">
      <div className={styles.actions}><NewLot /></div>
      <Section>
        <Frame>
<table className={ledger.table}>
            <thead>
              <tr>
                <th>{t('refining.lot')}</th>
                <th>{t('refining.status')}</th>
                <th>{t('refining.sent')}</th>
                <th>{t('refining.assayed')}</th>
                <th>{t('refining.received')}</th>
                <th className={ledger.num}>{t('refining.weight')}</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.lotId}>
                  <td>{l.lotCode}</td>
                  <td><span className={ledger.badge}>{l.status}</span></td>
                  <td className={ledger.muted}>{l.sentDate ?? '—'}</td>
                  <td className={ledger.muted}>{l.assayDate ?? '—'}</td>
                  <td className={ledger.muted}>{l.receivedDate ?? '—'}</td>
                  {/* The assayed weight once the refinery has reported it, and
                      until then what was sent. A lot in flight has no assay
                      weight, and printing that as 0.00 said the lot was empty
                      while the panel below it said 739 grams. */}
                  <td className={ledger.num}>
                    {weight.format(l.totalAssayGram || l.totalGrossGram)}
                    {l.totalAssayGram === 0 && l.totalGrossGram > 0 && (
                      <span className={ledger.muted}> {t('refining.sentWeight')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
      </Section>

      {lots.map((l) => {
        const own = shares.filter((s) => s.lotId === l.lotId)
        const picked = pickedByLot[l.lotId] ?? []
        // A draft with nothing in it yet is exactly the lot somebody needs the
        // picker for, so it no longer disappears for having no lines.
        if (own.length === 0 && l.status !== 'DRAFT') return null
        return (
          <Section key={`${l.lotId}-owners`}>
            <h2 className={ledger.sectionTitle}>{l.lotCode} · {t('refining.owner')}</h2>
            <div className={styles.actions}>
              <AdvanceLot lotId={l.lotId} status={l.status} />
              {l.status === 'DRAFT' && <AddLine lotId={l.lotId} goldTypes={goldTypes} />}
            </div>
            {/* The checkbox column of sheet 1.Scrap Gold: a lot is assembled
                out of the purchases going into it, not retyped. Only while it
                is a draft — once the gold has left the vault, what was in the
                bag is a matter of record. */}
            {/* Once the refinery has weighed it, what the lot is actually
                worth is the thing to read — so the lines come out then. */}
            {l.status !== 'DRAFT' && <LotLines lines={linesByLot[l.lotId] ?? []} />}
            {l.status === 'DRAFT' && (
              <PurchasePicker
                  lotId={l.lotId}
                  available={available}
                  picked={picked}
                  pickedTotals={bandsByLot[l.lotId] ?? []}
              />
            )}
            <Frame>
<table className={ledger.table}>
                <thead>
                  <tr>
                    <th>{t('refining.owner')}</th>
                    <th className={ledger.num}>{t('refining.weight')}</th>
                    <th className={ledger.num}>{t('refining.share')}</th>
                    {/* A weight, not the date the lot list shows under the same
                        word. One key was carrying both. */}
                    <th className={ledger.num}>{t('refining.receivedGram')}</th>
                    <th className={ledger.num}>{t('refining.owed')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {own.map((s) => (
                    <tr key={s.ownerCode} className={s.ownerCode === 'PC49' ? undefined : ledger.aside}>
                      <td>{s.ownerCode}</td>
                      <td className={ledger.num}>{weight.format(s.assayWeightGram)}</td>
                      <td className={ledger.num}>{s.sharePct.toFixed(1)}%</td>
                      <td className={ledger.num}>{weight.format(s.receivedGram)}</td>
                      {/* What is still out. A lot cannot close while any owner
                          is owed metal, so this is the figure the screen is
                          read for. */}
                      <td className={`${ledger.num} ${owedBy(s) > 0 ? styles.owed : ledger.muted}`}>
                        {owedBy(s) > 0 ? weight.format(owedBy(s)) : '—'}
                      </td>
                      <td>
                        {canReceive(l.status) && (
                          <ReceiveRow
                            lotId={l.lotId}
                            ownerCode={s.ownerCode}
                            owed={owedBy(s)}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Frame>
            {l.spotVarianceValue !== null && (
              <p className={ledger.note}>
                {t('refining.variance')}:{' '}
                <Signed value={l.spotVarianceValue} />
                {' '}({weight.format(l.spotVariancePerGram ?? 0)} /g). {t('refining.varianceNote')}
              </p>
            )}
          </Section>
        )
      })}
    </Page>
  )
}
