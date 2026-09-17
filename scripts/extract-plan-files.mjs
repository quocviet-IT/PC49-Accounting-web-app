// Writes the files a plan spells out whole.
//
// A fenced block whose opening line carries `path=<file>` is that file's entire
// content. Named paths only, so running it twice, or for one task, writes
// exactly what was asked for.
//
//   node scripts/extract-plan-files.mjs <plan.md> <path>...
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [plan, ...wanted] = process.argv.slice(2)
if (!plan || wanted.length === 0) {
  console.error('usage: node scripts/extract-plan-files.mjs <plan.md> <path>...')
  process.exit(1)
}

const text = (await readFile(plan, 'utf8')).replace(/\r\n/g, '\n')
const blocks = new Map()
const fence = /^(`{3,})\w* path=(\S+)\n([\s\S]*?)\n\1$/gm
for (const m of text.matchAll(fence)) blocks.set(m[2], m[3] + '\n')

let missing = 0
for (const file of wanted) {
  const body = blocks.get(file)
  if (body === undefined) {
    console.error(`not in the plan: ${file}`)
    missing += 1
    continue
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  console.log(`wrote ${file}`)
}
process.exit(missing === 0 ? 0 : 1)
