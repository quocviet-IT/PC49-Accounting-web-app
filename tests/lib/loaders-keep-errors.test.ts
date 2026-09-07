/*
 * A page loader may not throw away the error from a read.
 *
 * PC49-02 was fixed twice and was still not finished, because the first sweep
 * looked for `data ?? []` and missed the shorter way of losing an error:
 *
 *   const { data } = await supabase.from(...)      // error dropped on the floor
 *
 * That form was in every report — profit and loss, trial balance, general
 * ledger, stock, deposits — so a query that failed drew a report of zeros. It
 * was in the journal, where an empty month is the statement that nothing was
 * recorded. It was in the layout, where it let somebody required to change
 * their password walk straight past the requirement.
 *
 * Rendering tests cover what a screen does once it has been told. This covers
 * the telling, for every loader at once, which is the half that kept being
 * forgotten.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const APP = join(process.cwd(), 'src', 'app')

/**
 * Reads whose error is genuinely nothing to report, with the reason.
 *
 * Kept as exact file-and-call pairs rather than whole-file exemptions, so an
 * exempt file does not quietly cover a second read added underneath.
 */
const ALLOWED: { file: string; call: string; because: string }[] = [
  {
    file: 'src/app/(app)/layout.tsx',
    call: 'supabase.auth.getUser()',
    because:
      'An auth call, not a data read. It is asked only to tell two kinds of '
      + 'nobody apart — never signed in, or signed in with a closed account — '
      + 'and both answers send the visitor away.',
  },
  {
    file: 'src/app/(app)/feedback/page.tsx',
    call: 'supabase.storage',
    because:
      'Signing screenshot links. A failure costs the link beside a report, not '
      + 'the report; the field is already documented as null when the picture '
      + 'was never sent or has gone. Worth distinguishing one day, not worth '
      + 'blocking the queue over.',
  },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/^(page|layout)\.tsx$/.test(entry)) out.push(path)
  }
  return out
}

/** Every `const { data … } = await …` whose destructuring has no `error`. */
function discardedErrors(source: string): string[] {
  const found: string[] = []
  for (const m of source.matchAll(/const\s*\{\s*data[^}]*\}\s*=\s*(?:await\s*)?([^\n]*)/g)) {
    const [whole, tail] = [m[0], m[1]]
    const binding = whole.slice(0, whole.indexOf('='))
    if (/\berror\b/.test(binding)) continue
    found.push(tail.trim())
  }
  return found
}

describe('no loader drops the error from a read', () => {
  const files = walk(APP)

  it('has loaders to check', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const file of files) {
    const rel = relative(process.cwd(), file).replace(/\\/g, '/')
    it(`${rel} keeps every error it is given`, () => {
      const dropped = discardedErrors(readFileSync(file, 'utf8'))
      const unexplained = dropped.filter((call) =>
        !ALLOWED.some((a) => a.file === rel && call.includes(a.call)))
      expect(unexplained).toEqual([])
    })
  }
})

describe('the reader that makes the check above meaningful', () => {
  it('catches the short form that started all this', () => {
    expect(discardedErrors("const { data } = await supabase.from('x').select()"))
      .toEqual(["supabase.from('x').select()"])
  })

  it('catches it when the binding is renamed', () => {
    expect(discardedErrors("const { data: rows } = await supabase.rpc('pl_report')"))
      .toEqual(["supabase.rpc('pl_report')"])
  })

  it('accepts a read that keeps its error', () => {
    expect(discardedErrors("const { data, error } = await supabase.from('x').select()"))
      .toEqual([])
  })

  it('accepts a renamed error too', () => {
    expect(discardedErrors(
      "const { data: rows, error: rowError } = await supabase.rpc('x')")).toEqual([])
  })

  it('says nothing about code that does not destructure data', () => {
    expect(discardedErrors('const result = await supabase.from("x").select()')).toEqual([])
  })
})

describe('every exemption is a decision somebody made', () => {
  it('each one names a file, a call and a reason', () => {
    for (const a of ALLOWED) {
      expect(a.file).toMatch(/^src\/app\//)
      expect(a.call.length).toBeGreaterThan(0)
      // Long enough to be a reason rather than a shrug.
      expect(a.because.length).toBeGreaterThan(60)
    }
  })

  it('and still applies to a read that is really there', () => {
    // An exemption left behind after the code it covered was fixed would
    // silently license the next read added to that file.
    for (const a of ALLOWED) {
      const source = readFileSync(join(process.cwd(), a.file), 'utf8')
      expect(source).toContain(a.call)
    }
  })
})
