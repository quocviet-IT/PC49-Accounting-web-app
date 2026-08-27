export type Role = 'KT' | 'GS_US' | 'OC' | 'ADMIN'

export type Capability =
  | 'goldTxn.write'
  | 'bankImport.run'
  | 'refining.write'
  | 'refining.approve'
  | 'journal.post'
  | 'journal.void'
  | 'period.close'
  | 'report.read'
  | 'catalog.manage'
  | 'user.manage'

const MATRIX: Record<Role, Capability[]> = {
  KT: ['goldTxn.write', 'bankImport.run', 'refining.write', 'journal.post', 'journal.void', 'report.read'],
  GS_US: ['refining.write', 'refining.approve', 'period.close', 'report.read'],
  OC: ['report.read'],
  ADMIN: [
    'goldTxn.write', 'bankImport.run', 'refining.write', 'refining.approve',
    'journal.post', 'journal.void', 'period.close', 'report.read',
    'catalog.manage', 'user.manage',
  ],
}

export function can(role: Role | null, capability: Capability): boolean {
  if (!role) return false
  return MATRIX[role].includes(capability)
}
