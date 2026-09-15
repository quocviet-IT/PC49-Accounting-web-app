import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ANTD_STYLESHEET } from '@/lib/design/antdStylesheet'

const root = path.resolve(import.meta.dirname, '../..')

describe("Ant Design's stylesheet for zero-runtime mode", () => {
  it('matches the antd installed and the theme in use', () => {
    // Regenerated in memory and compared by name. The name carries the antd
    // version and a hash of the content, so a newer antd, a changed token or a
    // changed theme setting each make it differ. Left stale, the components
    // would paint the old colours and nothing would say so.
    const out = execFileSync(process.execPath, ['scripts/antd-css.mjs', '--check'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const { href } = JSON.parse(out.trim().split('\n').pop() ?? '{}') as { href?: string }
    expect(href, 'the antd stylesheet is out of date: run npm run antd:css').toBe(ANTD_STYLESHEET)
  }, 180_000)

  it('is on disk where the page links to it, with the content its name promises', () => {
    const file = path.join(root, 'public', ANTD_STYLESHEET)
    expect(existsSync(file)).toBe(true)
    const hash = createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex').slice(0, 12)
    expect(ANTD_STYLESHEET.endsWith(`-${hash}.css`)).toBe(true)
  })
})
