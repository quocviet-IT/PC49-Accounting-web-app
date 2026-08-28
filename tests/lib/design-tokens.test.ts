import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { antdThemeTokens, cssVariableBlock, palettes } from '@/lib/design/tokens'

// Read with line endings normalised: git checks this file out with CRLF on
// Windows, and a test that fails on the platform half the team uses teaches
// people to ignore it.
const stylesheet = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  .split('\r\n').join('\n')

describe('the stylesheet and the tokens say the same thing', () => {
  // The one guard that stops the two halves of the theme drifting: Ant Design
  // reads the tokens, the stylesheet reads the variables, and a colour changed
  // in one place and not the other is a half-converted screen.
  it('carries the generated block verbatim', () => {
    expect(stylesheet).toContain(cssVariableBlock())
  })

  it('defines every variable in both themes', () => {
    const block = cssVariableBlock()
    const [light, dark] = block.split(':root[data-theme="dark"]')
    const names = (s: string) => (s.match(/--pc-[\w-]+/g) ?? []).sort()
    expect(names(dark)).toEqual(names(light))
  })

  it('has no colour written as a literal outside the generated block', () => {
    // Everything after the block should reach for a variable. A hex here is a
    // second source of truth for a colour decided in tokens.ts.
    const block = cssVariableBlock()
    const at = stylesheet.indexOf(block)
    expect(at).toBeGreaterThan(-1)
    const body = stylesheet.slice(at + block.length)
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
  })
})

describe('the palette holds its meaning in both themes', () => {
  it('never lets money in and money out share a colour', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(palettes[theme].money.positive).not.toBe(palettes[theme].money.negative)
    }
  })

  it('keeps the interface accent clear of every semantic colour', () => {
    // A primary button the same colour as a warning teaches the reader that the
    // colour means nothing.
    for (const theme of ['light', 'dark'] as const) {
      const { intent } = palettes[theme]
      const semantic = [intent.success, intent.warning, intent.danger]
      expect(semantic).not.toContain(intent.primary)
    }
  })

  it('changes surfaces between themes rather than reusing one', () => {
    expect(palettes.light.surface.page).not.toBe(palettes.dark.surface.page)
    expect(palettes.light.surface.card).not.toBe(palettes.dark.surface.card)
  })
})

describe('what Ant Design is told', () => {
  it('takes its colours from the same palette the stylesheet does', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { token } = antdThemeTokens(theme)
      expect(token.colorPrimary).toBe(palettes[theme].intent.primarySolid)
      expect(token.colorError).toBe(palettes[theme].intent.danger)
      expect(token.colorBgLayout).toBe(palettes[theme].surface.page)
    }
  })

  it('gives the dark sidebar the same ground in both themes', () => {
    // The navigation column is dark either way; only the page behind it moves.
    for (const theme of ['light', 'dark'] as const) {
      const { components } = antdThemeTokens(theme)
      expect(components.Layout.siderBg).toBe(palettes[theme].surface.sider)
    }
  })
})
