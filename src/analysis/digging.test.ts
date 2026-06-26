import { describe, it, expect, beforeEach } from 'vitest'
import { simulateWand } from '../sim/simulateWand'
import { computeMetrics, type WandMetrics } from '../sim/metrics'
import { clearSimCache } from './simCache'
import { digCapability, digSustainability, digScore, isDigger, digScoreValue } from './digging'
import { CORPUS } from '../data/corpus/builds'
import { buildWandFromSpellIds } from '../data/corpus/buildWand'
import type { Wand } from '../schema/snapshot'

beforeEach(clearSimCache)

const wand = (spells: string[]): Wand => ({
  slot: 0, active: true, always_cast: [], spells,
  stats: {
    shuffle: false, spellsPerCast: 1, castDelay: 10, rechargeTime: 20,
    manaMax: 1000, mana: 1000, manaChargeSpeed: 100, capacity: 10, spread: 0, speedMultiplier: 1,
  },
})

const corpusMetrics = (id: string): { wand: Wand; m: WandMetrics } => {
  const b = CORPUS.find((x) => x.id === id)!
  const w = buildWandFromSpellIds(b)
  const sim = simulateWand(w)
  return { wand: w, m: computeMetrics(sim.shots, sim.reloadTime, w.stats, sim.hitIterationLimit) }
}

describe('digCapability — curated, wiki-grounded tiers (#9)', () => {
  it('reads the highest dig tier in the deck', () => {
    expect(digCapability(wand(['LUMINOUS_DRILL']))).toBe(14)
    expect(digCapability(wand(['DIGGER']))).toBe(8)
    expect(digCapability(wand(['BLACK_HOLE']))).toBe(13)
  })
  it('takes the max over multiple dig spells', () => {
    expect(digCapability(wand(['DIGGER', 'LUMINOUS_DRILL']))).toBe(14)
  })
  it('is 0 for a deck with no dig spell', () => {
    expect(digCapability(wand(['LIGHT_BULLET', 'HEAVY_BULLET']))).toBe(0)
    expect(isDigger(wand(['LIGHT_BULLET']))).toBe(false)
    expect(isDigger(wand(['DIGGER']))).toBe(true)
  })
})

describe('digSustainability', () => {
  it('1.0 when the wand sustains its mana, penalized when it stalls', () => {
    expect(digSustainability({ manaSustainable: true } as WandMetrics)).toBe(1)
    expect(digSustainability({ manaSustainable: false } as WandMetrics)).toBeLessThan(1)
  })
})

describe('digScore — capability × sustainability (the §7.5 ground-truth case)', () => {
  it('a sustainable top-tier digger outranks an unsustainable higher-capability one', () => {
    // The corpus pair: Luminous Drill (tier 14, sustains) vs Black Hole (tier 13, 180 mana, stalls).
    const lum = corpusMetrics('luminous-drill-digger')
    const bh = corpusMetrics('black-hole-digger')
    expect(lum.m.manaSustainable).toBe(true)
    expect(bh.m.manaSustainable).toBe(false)
    const lumScore = digScore(lum.wand, lum.m)
    const bhScore = digScore(bh.wand, bh.m)
    expect(lumScore.scalar).toBeGreaterThan(bhScore.scalar)
    expect(digScoreValue(lum.wand, lum.m)).toBeGreaterThan(digScoreValue(bh.wand, bh.m))
  })

  it('a non-digger scores 0 on DIGGING', () => {
    const dmg = corpusMetrics('boss-killer-heavy')
    expect(digScore(dmg.wand, dmg.m).scalar).toBe(0)
    expect(digScoreValue(dmg.wand, dmg.m)).toBe(0)
  })
})
