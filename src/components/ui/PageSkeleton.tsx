'use client'

import { useLocale } from '@/lib/i18n/provider'
import styles from './PageSkeleton.module.css'

const STATS = 4
const ROWS = 8

/**
 * What a screen looks like while its figures are on their way.
 *
 * Shaped like the pages it stands in for — a title, a strip of figures, a table
 * on its card — at the same width and spacing, so nothing jumps when the real
 * page replaces it. `app/(app)/loading.tsx` shows it the moment a menu item is
 * clicked; before it existed, a click did nothing visible for two seconds.
 */
export function PageSkeleton() {
  const { t } = useLocale()
  return (
    <div className={styles.page} role="status" aria-busy="true" aria-live="polite" data-pc-skeleton="">
      <span className={styles.srOnly}>{t('common.loading')}</span>
      <div className={styles.header} aria-hidden="true">
        <span className={`${styles.block} ${styles.title}`} />
        <span className={`${styles.block} ${styles.description}`} />
      </div>
      <div className={styles.stats} aria-hidden="true">
        {Array.from({ length: STATS }, (_, i) => (
          <span key={i} className={styles.stat}>
            <span className={`${styles.block} ${styles.statLabel}`} />
            <span className={`${styles.block} ${styles.statValue}`} />
          </span>
        ))}
      </div>
      <div className={styles.table} aria-hidden="true">
        <span className={styles.tableHead} />
        {Array.from({ length: ROWS }, (_, i) => (
          <span key={i} className={styles.row}>
            <span className={`${styles.block} ${styles.cellWide}`} />
            <span className={`${styles.block} ${styles.cell}`} />
            <span className={`${styles.block} ${styles.cellNum}`} />
          </span>
        ))}
      </div>
    </div>
  )
}
