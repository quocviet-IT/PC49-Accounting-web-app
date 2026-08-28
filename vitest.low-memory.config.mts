import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * The same suite, one file at a time.
 *
 * Every SQL test file starts its own PGlite — a whole PostgreSQL compiled to
 * WebAssembly — and running thirty of those at once needs more memory than a
 * laptop with a browser open tends to have spare. When it runs out the workers
 * are killed and vitest prints "Worker exited unexpectedly" beside a summary
 * that still looks mostly green. The run does exit non-zero, so nothing passes
 * that should not, but the summary is misleading enough to be worth avoiding.
 *
 * Slower, and the right thing to reach for on a machine that is short of
 * memory. CI has the headroom and stays on the default.
 *
 * Written out rather than imported from vitest.config.mts: importing a .mts
 * file by name needs allowImportingTsExtensions, which would be a change to the
 * whole project's TypeScript settings for the sake of one config.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // vitest 4 replaced poolOptions with this: one file at a time, each in its
    // own process, so a finished file's PostgreSQL heap is returned before the
    // next one asks for its own.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
})
