import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** Every component stylesheet in the app. */
function moduleStylesheets(dir = 'src/components'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...moduleStylesheets(path))
    else if (entry.name.endsWith('.module.css')) out.push(path)
  }
  return out
}

const sheets = moduleStylesheets().map((path) => ({
  path,
  // Comments explain the rules; they are not rules.
  css: readFileSync(join(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
}))

describe('every stylesheet answers to the theme', () => {
  it('finds the stylesheets to check', () => {
    expect(sheets.length).toBeGreaterThan(3)
  })

  it('reads the theme from the attribute, never from a media query', () => {
    // `prefers-color-scheme` cannot be overridden by a click. A screen styled
    // that way stays dark when the reader picks the light theme — which is
    // exactly what the entry grid used to do.
    for (const { path, css } of sheets) {
      expect(css, path).not.toContain('prefers-color-scheme')
    }
  })

  it('writes no colour as a literal', () => {
    // A hex here is a second source of truth for a colour decided in
    // tokens.ts, and the two drift on the first change made in only one place.
    for (const { path, css } of sheets) {
      expect((css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []), path).toEqual([])
    }
  })

  it('never paints on the browser system colours', () => {
    // `Canvas` is the browser's own page colour and stays white in the dark
    // theme, so a sticky header painted with it floats white over a dark grid.
    for (const { path, css } of sheets) {
      expect(css, path).not.toMatch(/background:\s*(Canvas|Window|ButtonFace)\b/)
    }
  })
})
