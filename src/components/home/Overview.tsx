'use client'

import { useLocale } from '@/lib/i18n/provider'
import { Page, Stats, Stat, money, weight } from '@/components/ledger/Ledger'

export function Overview({
  inventoryValue, cashTotal, openDeposits, atRefineryGram, spotMissing,
}: {
  inventoryValue: number | null
  cashTotal: number
  openDeposits: number
  atRefineryGram: number
  spotMissing: boolean
}) {
  const { t } = useLocale()
  return (
    <Page titleKey="home.title">
      <Stats>
        <Stat
          labelKey="home.goldValue"
          value={inventoryValue === null ? '—' : money.format(inventoryValue)}
          note={spotMissing ? t('home.noSpot') : undefined}
        />
        <Stat labelKey="home.cash" value={money.format(cashTotal)}
              tone={cashTotal < 0 ? 'out' : undefined} />
        <Stat labelKey="home.openDeposits" value={String(openDeposits)} />
        <Stat labelKey="home.atRefinery" value={`${weight.format(atRefineryGram)} g`} />
      </Stats>
    </Page>
  )
}
