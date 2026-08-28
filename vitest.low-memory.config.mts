import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config.mts'

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
 */
export default mergeConfig(base, defineConfig({
  test: {
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
}))
