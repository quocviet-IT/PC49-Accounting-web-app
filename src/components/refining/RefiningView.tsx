'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Empty, Signed, weight, ledger, Frame } from '@/components/ledger/Ledger'

export type LotRow = {
  lotId: string
  lotCode: string
  status: string
  sentDate: string | null
  assayDate: string | null
  receivedDate: string | null
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

export function RefiningView({ lots, shares }: { lots: LotRow[]; shares: ShareRow[] }) {
  const { t } = useLocale()
  if (lots.length === 0) return <Page titleKey="refining.title"><Empty /></Page>

  return (
    <Page titleKey="refining.title">
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
                  <td className={ledger.num}>{weight.format(l.totalAssayGram)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
      </Section>

      {lots.map((l) => {
        const own = shares.filter((s) => s.lotId === l.lotId)
        if (own.length === 0) return null
        return (
          <Section key={`${l.lotId}-owners`}>
            <h2 className={ledger.sectionTitle}>{l.lotCode} · {t('refining.owner')}</h2>
            <Frame>
<table className={ledger.table}>
                <thead>
                  <tr>
                    <th>{t('refining.owner')}</th>
                    <th className={ledger.num}>{t('refining.weight')}</th>
                    <th className={ledger.num}>{t('refining.share')}</th>
                    <th className={ledger.num}>{t('refining.received')}</th>
                  </tr>
                </thead>
                <tbody>
                  {own.map((s) => (
                    <tr key={s.ownerCode} className={s.ownerCode === 'PC49' ? undefined : ledger.aside}>
                      <td>{s.ownerCode}</td>
                      <td className={ledger.num}>{weight.format(s.assayWeightGram)}</td>
                      <td className={ledger.num}>{s.sharePct.toFixed(1)}%</td>
                      <td className={ledger.num}>{weight.format(s.receivedGram)}</td>
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
