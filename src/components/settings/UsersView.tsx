'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/lib/i18n/provider'
import { Page, Section, Frame, LoadFailed } from '@/components/ledger/Ledger'
import ledger from '@/components/ledger/Ledger.module.css'
import {
  changeRole, createUser, renameUser, restoreUser, resetPassword, suspendUser,
} from '@/app/(app)/settings/users/actions'
import styles from './Users.module.css'

export type PersonRow = {
  id: string
  email: string
  fullName: string
  role: string
  suspendedAt: string | null
  mustChangePassword: boolean
  createdAt: string
}

const ROLES = ['KT', 'GS_US', 'OC', 'ADMIN'] as const

/**
 * A password that exists for as long as this panel is open.
 *
 * It is not stored anywhere — not in the database, not in a log — so closing
 * this is the last time anybody sees it. Saying so is the point: without it
 * somebody dismisses the panel expecting to find the password later.
 */
function OneTimePassword({ password, onDone }: { password: string; onDone: () => void }) {
  const { t } = useLocale()
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.secret}>
      <div>
        <strong>{t('users.tempPassword')}</strong>
        <code className={styles.secretValue}>{password}</code>
      </div>
      <p className={styles.secretNote}>{t('users.tempOnce')}</p>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.quiet}
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true))
          }}
        >
          {copied ? t('users.copied') : t('users.copy')}
        </button>
        <button type="button" className={styles.quiet} onClick={onDone}>
          {t('users.done')}
        </button>
      </div>
    </div>
  )
}

function AddPerson({ onCreated }: { onCreated: (password: string) => void }) {
  const { t } = useLocale()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<string>('KT')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!open) {
    return (
      <button type="button" className={styles.primary} onClick={() => setOpen(true)}>
        {t('users.add')}
      </button>
    )
  }

  return (
    <div className={styles.form}>
      <input className={styles.field} type="email" value={email} placeholder="tên@công-ty.com"
             aria-label={t('users.email')} onChange={(e) => setEmail(e.target.value)} />
      <input className={styles.field} value={fullName} aria-label={t('users.name')}
             placeholder={t('users.name')} onChange={(e) => setFullName(e.target.value)} />
      <select className={styles.field} value={role} aria-label={t('users.role')}
              onChange={(e) => setRole(e.target.value)}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <button type="button" className={styles.primary} disabled={pending} onClick={() => {
        setError(null)
        startTransition(async () => {
          const result = await createUser({ email, fullName, role })
          if (!result.ok) { setError(result.message); return }
          onCreated(result.password)
          setOpen(false); setEmail(''); setFullName(''); setRole('KT')
          router.refresh()
        })
      }}>
        {t('users.save')}
      </button>
      <button type="button" className={styles.quiet} disabled={pending}
              onClick={() => { setOpen(false); setError(null) }}>
        {t('users.cancel')}
      </button>
      {error && <span className={styles.failed}>{error}</span>}
    </div>
  )
}

/**
 * Everybody who may sign in, and what may be done about them.
 *
 * The refusals shown here are the database's own words. Nothing on this screen
 * decides whether a change is allowed — it asks, and repeats the answer.
 */
export function UsersView({ people, meId, loadFailed = false }: {
  people: PersonRow[]
  meId: string
  /**
   * The directory did not arrive.
   *
   * Offering "add a colleague" beside an empty list that only looks empty is
   * the same fault as offering to open a refining lot when the lot list failed
   * — the remedy somebody reaches for creates the duplicate.
   */
  loadFailed?: boolean
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null)
    startTransition(async () => {
      const result = await work()
      if (!result.ok) { setError(result.message ?? 'Không thực hiện được'); return }
      router.refresh()
    })
  }

  if (loadFailed) {
    return (
      <Page titleKey="users.title" noteKey="users.note">
        <Section><LoadFailed /></Section>
      </Page>
    )
  }

  return (
    <Page titleKey="users.title" noteKey="users.note"
          actions={<AddPerson onCreated={setSecret} />}>
      {secret && <OneTimePassword password={secret} onDone={() => setSecret(null)} />}
      {error && <p className={styles.failed}>{error}</p>}

      <Section>
        <Frame>
          <table className={ledger.table}>
            <thead>
              <tr>
                <th>{t('users.name')}</th>
                <th>{t('users.email')}</th>
                <th>{t('users.role')}</th>
                <th>{t('users.state')}</th>
                <th>{t('users.since')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className={p.suspendedAt ? ledger.aside : undefined}>
                  <td>
                    <input
                      className={styles.inlineField}
                      defaultValue={p.fullName}
                      aria-label={`${t('users.name')} ${p.email}`}
                      onBlur={(e) => {
                        if (e.target.value.trim() === p.fullName) return
                        run(() => renameUser({ userId: p.id, fullName: e.target.value }))
                      }}
                    />
                  </td>
                  <td>{p.email}</td>
                  <td>
                    <select
                      className={styles.inlineField}
                      value={p.role}
                      aria-label={`${t('users.role')} ${p.email}`}
                      disabled={pending}
                      onChange={(e) => run(() => changeRole({ userId: p.id, role: e.target.value }))}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td>
                    <span className={ledger.badge}>
                      {p.suspendedAt ? t('users.closed') : t('users.open')}
                    </span>
                    {p.mustChangePassword && (
                      <span className={styles.pending}>{t('users.mustChange')}</span>
                    )}
                    {p.id === meId && <span className={styles.pending}>{t('users.you')}</span>}
                  </td>
                  <td>{p.createdAt.slice(0, 10)}</td>
                  <td className={styles.actions}>
                    {p.suspendedAt ? (
                      <button type="button" className={styles.quiet} disabled={pending}
                              onClick={() => run(() => restoreUser({ userId: p.id }))}>
                        {t('users.reopen')}
                      </button>
                    ) : (
                      <button type="button" className={styles.quiet} disabled={pending}
                              onClick={() => {
                                const reason = window.prompt(t('users.closeWhy'))
                                if (reason === null) return
                                run(() => suspendUser({ userId: p.id, reason }))
                              }}>
                        {t('users.close')}
                      </button>
                    )}
                    <button type="button" className={styles.quiet} disabled={pending}
                            onClick={() => {
                              startTransition(async () => {
                                const result = await resetPassword({ userId: p.id })
                                if (!result.ok) { setError(result.message); return }
                                setSecret(result.password)
                                router.refresh()
                              })
                            }}>
                      {t('users.reset')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Frame>
      </Section>
    </Page>
  )
}
