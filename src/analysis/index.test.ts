import { describe, it, expect, beforeEach } from 'vitest'
import { parseSnapshot, type Wand, type PerkRef } from '../schema/snapshot'
import { clearSimCache } from './simCache'
import { wandKey } from './wandKey'
import { analyzeWand, analyzeWands, ARCHETYPES } from './index'

const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const heldWand = (suffix: string): Wand => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (!key) throw new Error(`fixture not found: ${suffix}`)
  return parseSnapshot(fixtures[key]).wands[0]
}

const makeWand = (over: Partial<Wand> = {}): Wand => ({
  slot: 0,
  always_cast: [],
  spells: [],
  stats: {
    shuffle: false,
    spellsPerCast: 1,
    castDelay: 10,
    rechargeTime: 20,
    manaMax: 500,
    mana: 500,
    manaChargeSpeed: 100,
    capacity: 6,
    spread: 0,
    speedMultiplier: 1,
  },
  ...over,
})

const perk = (id: string): PerkRef => ({ id, stacks: 1 })

describe('analyzeWand', () => {
  beforeEach(() => clearSimCache())

  it('joins key + metrics + all archetype scores + self-danger into one verdict', () => {
    const wand = heldWand('snapshot_02.json')
    const a = analyzeWand(wand, [])
    expect(a.key).toBe(wandKey(wand))
    expect(a.metrics.sustainedDps).toBeGreaterThan(0)
    expect(Object.keys(a.scores).sort()).toEqual([...ARCHETYPES].sort())
    expect(a.approximate).toBe(false)
    expect(a.selfDanger).toBeDefined()
  })

  it('a fire build is unsafe without perks and safe with Fire Immunity (end-to-end)', () => {
    const wand = makeWand({ spells: ['FLAMETHROWER'] })
    expect(analyzeWand(wand, []).selfDanger.unsafe).toBe(true)
    expect(analyzeWand(wand, [perk('PROTECTION_FIRE')]).selfDanger.unsafe).toBe(false)
  })

  it('analyzeWands maps over every held wand', () => {
    const out = analyzeWands([heldWand('snapshot_01.json'), heldWand('snapshot_03.json')], [])
    expect(out).toHaveLength(2)
    expect(out.every((a) => a.key.length > 0)).toBe(true)
  })
})
