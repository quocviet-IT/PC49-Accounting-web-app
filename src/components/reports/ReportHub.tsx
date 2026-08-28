'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/i18n/provider'
import { Page, ledger } from '@/components/ledger/Ledger'
import { REPORT_GROUPS, reportsInGroup } from '@/lib/domain/reports'
import styles from './Reports.module.css'

/**
 * The catalogue.
 *
 * Grouped by the question being asked rather than by the table underneath:
 * somebody closing a month, somebody checking one account and somebody reading
 * a profit are three different errands, and a single long page makes each of
 * them scroll past the other two.
 *
 * Every report here is derived from the books. Anything needing a figure typed
 * in would be a screen, not a report, and does not belong in this list.
 */
export function ReportHub() {
  const { t } = useLocale()

  return (
    <Page titleKey="rep.centre" noteKey="rep.centreNote">
      {REPORT_GROUPS.map((group) => (
        <section key={group.id} className={styles.group}>
          <h2 className={ledger.sectionTitle}>{t(group.labelKey)}</h2>
          <ul className={styles.cards}>
            {reportsInGroup(group.id).map((report) => (
              <li key={report.id}>
                <Link className={styles.card} href={`/reports?report=${report.id}`}>
                  <span className={styles.cardTitle}>{t(report.titleKey)}</span>
                  <span className={styles.cardAbout}>{t(report.descriptionKey)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Page>
  )
}
