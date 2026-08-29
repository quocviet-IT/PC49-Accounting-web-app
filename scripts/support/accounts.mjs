/**
 * The four test accounts, with their passwords taken from the environment.
 *
 * They used to be written here. That was fine while this repository was
 * private and became a problem the moment it was not: these are working
 * accounts on the client's own Supabase project, one of them an administrator,
 * and a public repository would have handed them to anyone who found the
 * deployed site.
 *
 * Passwords now live in `.env.local`, which git ignores. `.env.example` lists
 * the variables. Nothing here is a secret: the addresses are fixed and the
 * roles are the ones the application defines.
 */

export const TEST_ACCOUNTS = [
  { email: 'kt@pc49.test', role: 'KT', fullName: 'Ke toan VN', env: 'PC49_TEST_PASSWORD_KT' },
  { email: 'gsus@pc49.test', role: 'GS_US', fullName: 'US Supervisor', env: 'PC49_TEST_PASSWORD_GSUS' },
  { email: 'oc@pc49.test', role: 'OC', fullName: 'Owner', env: 'PC49_TEST_PASSWORD_OC' },
  { email: 'admin@pc49.test', role: 'ADMIN', fullName: 'Administrator', env: 'PC49_TEST_PASSWORD_ADMIN' },
]

/**
 * The password for one role.
 *
 * Fails loudly and by name rather than returning undefined. A check that signs
 * in with `undefined` reports "could not sign in", which sends whoever runs it
 * looking at the application instead of at their own environment file.
 */
export function passwordFor(role) {
  const account = TEST_ACCOUNTS.find((a) => a.role === role)
  if (!account) throw new Error(`No test account for role ${role}`)
  const password = process.env[account.env]
  if (!password) {
    throw new Error(
      `Missing ${account.env}. The test account passwords live in .env.local now, `
      + 'not in the scripts — see .env.example.',
    )
  }
  return password
}

/** Both halves for a role, which is what every check actually wants. */
export function accountFor(role) {
  const account = TEST_ACCOUNTS.find((a) => a.role === role)
  if (!account) throw new Error(`No test account for role ${role}`)
  return { email: account.email, password: passwordFor(role) }
}
