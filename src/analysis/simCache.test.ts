import { describe, it, expect, beforeEach } from 'vitest'
import { parseSnapshot, type Wand } from '../schema/snapshot'
import { simulateWand } from '../sim/simulateWand'
import { computeMetrics } from '../sim/metrics'
import { evalWand, clearSimCache } from './simCache'

const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const heldWand = (suffix: string): Wand => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (!key) throw new Error(`fixture not found: ${suffix}`)
  return parseSnapshot(fixtures[key]).wands[0]
}

describe('evalWand', () => {
  beforeEach(() => clearSimCache())

  it('matches a direct simulateWand + computeMetrics for every fixture', () => {
    for (const suffix of ['snapshot_01.json', 'snapshot_02.json', 'snapshot_03.json']) {
      const wand = heldWand(suffix)
      const sim = simulateWand(wand)
      const expected = computeMetrics(sim.shots, sim.reloadTime, wand.stats, sim.hitIterationLimit)
      expect(evalWand(wand).metrics).toEqual(expected)
    }
  })

  it('memoizes: a second call for the same chassis returns the SAME object (cache hit)', () => {
    const wand = heldWand('snapshot_01.json')
    const first = evalWand(wand)
    const second = evalWand(wand)
    expect(second).toBe(first) // referential identity ⇒ no re-simulation
  })

  it('cache hit is keyed structurally, not by reference (a fresh equal wand hits)', () => {
    const a = heldWand('snapshot_01.json')
    const b = heldWand('snapshot_01.json') // distinct object, identical chassis
    expect(b).not.toBe(a)
    expect(evalWand(b)).toBe(evalWand(a))
  })

  it('clearSimCache forces a fresh evaluation', () => {
    const wand = heldWand('snapshot_01.json')
    const first = evalWand(wand)
    clearSimCache()
    expect(evalWand(wand)).not.toBe(first)
  })

  it('distinct chassis get distinct entries', () => {
    expect(evalWand(heldWand('snapshot_02.json'))).not.toBe(evalWand(heldWand('snapshot_03.json')))
  })
})
