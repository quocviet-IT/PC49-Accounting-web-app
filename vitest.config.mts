import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],

    /*
     * Sixty seconds was enough when there were twenty migrations. Every SQL
     * test file replays all of them into a fresh PGlite before its first test,
     * and that setup was measured at forty-six seconds a file on a quiet
     * laptop — close enough to the default that two files failed on a busy one
     * while passing on their own, which is the worst kind of red.
     *
     * A hook that is genuinely stuck still fails; it just takes longer to say
     * so, which is the right trade for a number that grows with the schema.
     */
    hookTimeout: 180_000,

    /*
     * Parallelism is left at the default, which is right for CI.
     *
     * Every SQL test file starts its own PGlite — a whole PostgreSQL compiled to
     * WebAssembly, held for the length of the file — and thirty of those at once
     * needs more memory than a laptop with a browser open tends to have spare.
     * When that happens the workers are killed and vitest reports "Worker exited
     * unexpectedly" alongside a summary that still looks mostly green; the run
     * does exit non-zero, so CI catches it, but the summary is misleading enough
     * to be worth knowing about.
     *
     * On a machine that is short of memory: `npm run test:low-memory`, which
     * runs the files one at a time and completes where the parallel run cannot.
     */
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
