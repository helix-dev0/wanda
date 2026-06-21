import { describe, it, expect } from 'vitest'

// Smoke test: proves the Vitest runner + TS pipeline are wired up (M0-T1).
describe('smoke', () => {
  it('runs the test runner', () => {
    expect(1 + 1).toBe(2)
  })
})
