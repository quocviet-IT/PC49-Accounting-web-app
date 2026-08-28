'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/i18n/provider'
import type { MessageKey } from '@/lib/i18n'
import { Page, Empty, ledger } from '@/components/ledger/Ledger'
import styles from './Settings.module.css'

export type HubCard = {
  key: string
  href: string
  titleKey: MessageKey
  noteKey: MessageKey
  count: number | null
  countLabelKey: MessageKey
  show: boolean
}

export function SettingsHub(
  { cards, uncosted }: { cards: HubCard[]; uncosted: number },
) {
  const { t } = useLocale()

  return (
    <Page titleKey="set.title" noteKey="set.note">
      {uncosted > 0 && (
        <p className={styles.alarm}>
          {t('set.uncosted')}: {uncosted} — <a className={styles.jump} href="/prices">
            {t('set.uncostedFix')}</a>
        </p>
      )}
      {cards.length === 0 ? <Empty /> : (
        <ul className={styles.hub}>
          {cards.map((c) => (
            <li key={c.key}>
              <Link className={styles.card} href={c.href}>
                <span className={styles.cardTitle}>{t(c.titleKey)}</span>
                <span className={ledger.muted}>{t(c.noteKey)}</span>
                {c.count !== null && (
                  <span className={styles.cardCount}>
                    {c.count} {t(c.countLabelKey)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}
