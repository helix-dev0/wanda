import { describe, it, expect } from 'vitest'
import { parseSnapshot, type Wand } from '../schema/snapshot'
import { simulateWand } from './simulateWand'

// Fixtures the same way the rest of the suite loads them (fixtures.test.ts pattern).
const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const heldWand = (key: string): Wand => parseSnapshot(fixtures[key]).wands[0]

// Minimal valid wand for synthetic guard cases (all stat fields required).
const makeWand = (over: Partial<Wand> = {}): Wand => ({
  slot: 0,
  always_cast: [],
  spells: [],
  stats: {
    shuffle: false,
    spellsPerCast: 1,
    castDelay: 10,
    rechargeTime: 20,
    manaMax: 100,
    mana: 100,
    manaChargeSpeed: 50,
    capacity: 4,
    spread: 0,
    speedMultiplier: 1,
  },
  ...over,
})

describe('simulateWand — smoke across fixtures', () => {
  it.each(Object.keys(fixtures))('%s simulates without throwing', (key) => {
    const wand = heldWand(key)
    const r = simulateWand(wand)
    expect(Array.isArray(r.shots)).toBe(true)
    // All three fixtures are stock spells (RUBBER_BALL / GRENADE / BUBBLESHOT).
    expect(r.missingSpells).toEqual([])
    expect(r.approximate).toBe(false)
    expect(r.shots.length).toBeGreaterThan(0)
  })
})

describe('simulateWand — guards', () => {
  it('empty deck → no shots, no NaN, not approximate', () => {
    const r = simulateWand(makeWand({ spells: [null, null] }))
    expect(r.shots).toEqual([])
    expect(r.reloadTime).toBeUndefined()
    expect(r.hitIterationLimit).toBe(false)
    expect(r.approximate).toBe(false)
    expect(r.missingSpells).toEqual([])
  })

  it('unknown (modded) id → collected in missingSpells, approximate, no throw', () => {
    const r = simulateWand(makeWand({ spells: ['ZZZ_MODDED_SPELL'] }))
    expect(r.missingSpells).toEqual(['ZZZ_MODDED_SPELL'])
    expect(r.approximate).toBe(true)
    // unknown id is the only card → resolves to an empty deck → clean empty return
    expect(r.shots).toEqual([])
  })

  it('a known id alongside a modded id still simulates, flagged approximate', () => {
    const r = simulateWand(makeWand({ spells: ['RUBBER_BALL', 'ZZZ_MODDED_SPELL'] }))
    expect(r.missingSpells).toEqual(['ZZZ_MODDED_SPELL'])
    expect(r.approximate).toBe(true)
    expect(r.shots.length).toBeGreaterThan(0)
  })

  it('always_cast present → approximate (prepend approximation, no real engine path)', () => {
    const r = simulateWand(makeWand({ always_cast: ['DAMAGE'], spells: ['RUBBER_BALL'] }))
    expect(r.approximate).toBe(true)
    expect(r.missingSpells).toEqual([])
    expect(r.shots.length).toBeGreaterThan(0)
  })
})
