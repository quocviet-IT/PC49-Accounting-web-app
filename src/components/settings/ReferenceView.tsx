'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, ledger, Frame, LoadFailed } from '@/components/ledger/Ledger'
import { saveSystemParam } from '@/app/(app)/settings/actions'
import styles from './Settings.module.css'

export type Param = {
  key: string
  value: number
  unit: string | null
  description: string
  /** Null on a parameter added since, which then falls back to the English. */
  descriptionVi: string | null
}
export type GoldTypeRow = {
  code: string; nameVi: string; nameEn: string; uom: string
  inventoryAccount: string; cogsAccount: string; isActive: boolean
}
export type CashAccountRow = {
  code: string; displayName: string; accountType: string
  bankName: string | null; statusNote: string | null; isActive: boolean
}
export type SalesPersonRow = { code: string; fullName: string | null; isActive: boolean }
export type PartnerRow = {
  code: string; fullName: string | null; phone: string | null; isActive: boolean
}

export function ReferenceView({
  params, goldTypes, cashAccounts, salesPeople, partners, accountCount, failed = {},
}: {
  params: Param[]
  goldTypes: GoldTypeRow[]
  cashAccounts: CashAccountRow[]
  salesPeople: SalesPersonRow[]
  partners: PartnerRow[]
  accountCount: number
  /**
   * Which catalogue did not arrive. A catalogue is the list of what exists;
   * showing an empty one says nothing exists, and on this screen that is the
   * difference between "there are no sales people" and "we could not ask".
   */
  failed?: {
    params?: boolean; goldTypes?: boolean; cashAccounts?: boolean
    salesPeople?: boolean; partners?: boolean
  }
}) {
  const { locale, t } = useLocale()
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function commit(p: Param) {
    const raw = draft[p.key]
    if (raw === undefined) return
    const value = Number(raw.trim())
    if (!Number.isFinite(value)) { setError(`${p.key}: ${t('ref.notANumber')}`); return }
    if (value === p.value) { setDraft((d) => { const n = { ...d }; delete n[p.key]; return n }); return }

    setBusy(p.key); setError(null)
    const result = await saveSystemParam({ key: p.key, value })
    setBusy(null)
    if (!result.ok) { setError(`${p.key}: ${result.message}`); return }
    setDraft((d) => { const n = { ...d }; delete n[p.key]; return n })
    router.refresh()
  }

  const name = (g: GoldTypeRow) => (locale === 'vi' ? g.nameVi : g.nameEn)
  const meaning = (p: Param) =>
    (locale === 'vi' ? p.descriptionVi : null) ?? p.description

  return (
    <Page titleKey="ref.title" noteKey="ref.note">
      <Section titleKey="ref.params">
        {failed.params ? <LoadFailed /> : (
          <>
        {/* These are the numbers every calculation in the system leans on. They
            are editable because the source treats them as settings, and shown
            with their description because 31.1 and 31.105 are one keystroke
            apart and mean different things. */}
        <Frame>
<table className={ledger.table}>
            <colgroup>
              <col style={{ width: '28%' }} /><col style={{ width: '16%' }} />
              <col style={{ width: '12%' }} /><col style={{ width: '44%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('ref.key')}</th>
                <th className={ledger.num}>{t('ref.value')}</th>
                <th>{t('ref.unit')}</th>
                <th>{t('ref.meaning')}</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.key}>
                  <td>{p.key}</td>
                  <td className={ledger.num}>
                    <input
                      className={styles.cell}
                      inputMode="decimal"
                      aria-label={p.key}
                      value={draft[p.key] ?? String(p.value)}
                      onChange={(e) => setDraft((d) => ({ ...d, [p.key]: e.target.value }))}
                      onBlur={() => commit(p)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      disabled={busy === p.key}
                    />
                  </td>
                  <td className={ledger.muted}>{p.unit ?? '—'}</td>
                  <td className={ledger.muted}>{meaning(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
        {error && <p className={styles.failed}>{error}</p>}
          </>
        )}
      </Section>

      {/* The rest is shown, not edited. A gold type carries the accounts every
          posting rule reaches for, and a cash account is referenced by the chart
          of accounts; changing either from a screen would break postings that
          already exist. Whoever needs to change one does it as a migration, in
          the open, with the rest of the schema. */}
      <Section titleKey="ref.goldTypes">
        {failed.goldTypes ? <LoadFailed /> : (
          <>
        <Frame>
<table className={ledger.table}>
            <colgroup>
              <col style={{ width: '10%' }} /><col style={{ width: '26%' }} />
              <col style={{ width: '12%' }} /><col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} /><col style={{ width: '16%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('ref.code')}</th>
                <th>{t('ref.name')}</th>
                <th>{t('ref.uom')}</th>
                <th>{t('ref.inventoryAccount')}</th>
                <th>{t('ref.cogsAccount')}</th>
                <th>{t('ref.state')}</th>
              </tr>
            </thead>
            <tbody>
              {goldTypes.map((g) => (
                <tr key={g.code} className={g.isActive ? undefined : ledger.aside}>
                  <td>{g.code}</td>
                  <td>{name(g)}</td>
                  <td className={ledger.muted}>{g.uom}</td>
                  <td className={ledger.muted}>{g.inventoryAccount}</td>
                  <td className={ledger.muted}>{g.cogsAccount}</td>
                  <td>
                    <span className={ledger.badge}>
                      {t(g.isActive ? 'ref.active' : 'ref.inactive')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
          </>
        )}
      </Section>

      <Section titleKey="ref.cashAccounts">
        {failed.cashAccounts ? <LoadFailed /> : (
          <>
        <Frame>
<table className={ledger.table}>
            <colgroup>
              <col style={{ width: '14%' }} /><col style={{ width: '26%' }} />
              <col style={{ width: '14%' }} /><col style={{ width: '18%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('ref.code')}</th>
                <th>{t('ref.name')}</th>
                <th>{t('ref.type')}</th>
                <th>{t('ref.bank')}</th>
                <th>{t('ref.statusNote')}</th>
              </tr>
            </thead>
            <tbody>
              {cashAccounts.map((c) => (
                <tr key={c.code} className={c.isActive ? undefined : ledger.aside}>
                  <td>{c.code}</td>
                  <td>{c.displayName}</td>
                  <td className={ledger.muted}>{c.accountType}</td>
                  <td className={ledger.muted}>{c.bankName ?? '—'}</td>
                  <td className={ledger.muted}>{c.statusNote ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
          </>
        )}
      </Section>

      <Section titleKey="ref.salesPeople">
        {failed.salesPeople ? <LoadFailed /> : (
          <>
        <Frame>
<table className={ledger.table}>
            <colgroup>
              <col style={{ width: '20%' }} /><col style={{ width: '54%' }} />
              <col style={{ width: '26%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('ref.code')}</th>
                <th>{t('ref.name')}</th>
                <th>{t('ref.state')}</th>
              </tr>
            </thead>
            <tbody>
              {salesPeople.map((s) => (
                <tr key={s.code} className={s.isActive ? undefined : ledger.aside}>
                  <td>{s.code}</td>
                  <td>{s.fullName ?? '—'}</td>
                  <td>
                    <span className={ledger.badge}>
                      {t(s.isActive ? 'ref.active' : 'ref.inactive')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
          </>
        )}
      </Section>

      <Section titleKey="ref.partners">
        {failed.partners ? <LoadFailed /> : (
          <>
        <Frame>
          <table className={ledger.table}>
            <colgroup>
              <col style={{ width: '22%' }} /><col style={{ width: '38%' }} />
              <col style={{ width: '25%' }} /><col style={{ width: '15%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('ref.code')}</th>
                <th>{t('ref.name')}</th>
                <th>{t('ref.phone')}</th>
                <th>{t('ref.state')}</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.code} className={p.isActive ? undefined : ledger.aside}>
                  <td>{p.code}</td>
                  <td>{p.fullName ?? '—'}</td>
                  <td>{p.phone ?? '—'}</td>
                  <td>
                    <span className={ledger.badge}>
                      {t(p.isActive ? 'ref.active' : 'ref.inactive')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
        {/* The list fills itself from the entry screen, so it starts empty on
            a fresh database rather than being wrong. */}
        <p className={ledger.note}>{t('ref.partnersNote')}</p>
          </>
        )}
      </Section>

      <p className={ledger.note}>{t('ref.chartNote')}: {accountCount}</p>
    </Page>
  )
}
