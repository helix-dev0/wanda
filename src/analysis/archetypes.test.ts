import { describe, it, expect, beforeEach } from 'vitest'
import { parseSnapshot, type Wand } from '../schema/snapshot'
import { evalWand, clearSimCache } from './simCache'
import { scoreWand, tierForScore } from './archetypes'

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

const scoreOf = (wand: Wand) => scoreWand(wand, evalWand(wand))

describe('tierForScore — absolute band boundaries', () => {
  it('maps scores to S/A/B/C/D at 80/60/40/20', () => {
    expect(tierForScore(80)).toBe('S')
    expect(tierForScore(79)).toBe('A')
    expect(tierForScore(60)).toBe('A')
    expect(tierForScore(40)).toBe('B')
    expect(tierForScore(20)).toBe('C')
    expect(tierForScore(19)).toBe('D')
    expect(tierForScore(0)).toBe('D')
  })
})

describe('scoreWand — fixture orderings (signature-dominant)', () => {
  beforeEach(() => clearSimCache())

  it('DAMAGE ranks the grenade (hardest hit) above the spam wands', () => {
    const g = scoreOf(heldWand('snapshot_02.json')).DAMAGE.score // GRENADE
    const b = scoreOf(heldWand('snapshot_03.json')).DAMAGE.score // BUBBLESHOT
    const r = scoreOf(heldWand('snapshot_01.json')).DAMAGE.score // RUBBER_BALL
    expect(g).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(r)
  })

  it('SPAM ranks the sustainable fast wand top; the mana-limited grenade is gated', () => {
    const bubble = scoreOf(heldWand('snapshot_03.json')).SPAM
    const grenade = scoreOf(heldWand('snapshot_02.json')).SPAM
    expect(bubble.score).toBeGreaterThan(grenade.score)
    // the near-gate is the reason, surfaced for the UI
    expect(grenade.reasons.join(' ')).toMatch(/mana/i)
    expect(bubble.topMetrics.find((t) => t.label === 'Mana')?.value).toBe('sustainable')
  })

  it('held fixtures have no mobility/defensive content', () => {
    for (const s of ['snapshot_01.json', 'snapshot_02.json', 'snapshot_03.json']) {
      const sc = scoreOf(heldWand(s))
      expect(sc.MOBILITY.score).toBe(0)
      expect(sc.DEFENSIVE.score).toBe(0)
    }
  })
})

describe('scoreWand — AoE responds to real blast size', () => {
  beforeEach(() => clearSimCache())

  it('a 60px bomb scores far higher AoE than a 7px grenade', () => {
    const bomb = makeWand({ spells: ['BOMB'] })
    expect(evalWand(bomb).metrics.maxExplosionRadius).toBeGreaterThan(30) // sanity: it simulates big
    const bombAoe = scoreOf(bomb).AOE
    const grenadeAoe = scoreOf(heldWand('snapshot_02.json')).AOE
    expect(bombAoe.score).toBeGreaterThan(grenadeAoe.score)
    expect(['S', 'A', 'B']).toContain(bombAoe.tier) // reaches a meaningful tier
  })
})

describe('scoreWand — feature archetypes (deck content)', () => {
  beforeEach(() => clearSimCache())

  it('digging + movement → top-tier Mobility', () => {
    const sc = scoreOf(makeWand({ spells: ['DIGGER', 'TELEPORT_CAST'] }))
    expect(sc.MOBILITY.score).toBe(100)
    expect(sc.MOBILITY.tier).toBe('S')
  })

  it('digging alone → A-tier Mobility', () => {
    const sc = scoreOf(makeWand({ spells: ['DIGGER'] }))
    expect(sc.MOBILITY.score).toBe(60)
    expect(sc.MOBILITY.tier).toBe('A')
  })

  it('a shield → A-tier Defensive; shield + homing → S', () => {
    expect(scoreOf(makeWand({ spells: ['MAGIC_SHIELD'] })).DEFENSIVE.tier).toBe('A')
    const both = scoreOf(makeWand({ spells: ['MAGIC_SHIELD', 'HOMING'] })).DEFENSIVE
    expect(both.score).toBe(100)
    expect(both.tier).toBe('S')
  })
})
