import { defineConfig } from 'vitest/config'

// Pure-logic unit tests run in Node (no DOM). UI/component tests (M2+) will add
// a jsdom project; keep this config minimal until then. Globals are disabled —
// tests import { describe, it, expect } from 'vitest' explicitly.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
