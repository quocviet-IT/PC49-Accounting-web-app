'use client'

import type { ReactNode } from 'react'
import { Typography } from 'antd'
import { useLocale } from '@/lib/i18n/provider'
import type { MessageKey } from '@/lib/i18n'

/**
 * Title, one sentence saying what the screen is for, and whatever controls
 * belong beside it.
 *
 * A Client Component because Ant Design's compound components lose their static
 * sub-components across the server boundary — `Typography.Title` read from a
 * Server Component is undefined at render time.
 */
export function PageHeader({
  titleKey, descriptionKey, actions,
}: {
  titleKey: MessageKey
  descriptionKey?: MessageKey
  actions?: ReactNode
}) {
  const { t } = useLocale()
  return (
    <header className="pc-page-header">
      <div className="pc-page-header__content">
        <Typography.Title level={1} className="pc-page-header__title">
          {t(titleKey)}
        </Typography.Title>
        {descriptionKey && (
          <Typography.Paragraph className="pc-page-header__description">
            {t(descriptionKey)}
          </Typography.Paragraph>
        )}
      </div>
      {actions && <div className="pc-page-header__actions">{actions}</div>}
    </header>
  )
}
