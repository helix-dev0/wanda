// The 3-layer validation harness (docs/scoring-model-v2-spec.md §7) — the ground-truth loop
// v1 never had. Layer A = sim fidelity; Layer B = archetype routing; Layer C = cited
// mechanical orderings; plus the §7.5 maintainer ground-truth cases. Layer A + the
// archetype-stable orderings landed at S0; the DIGGING/TTK-dependent assertions activate
// here at S4 (they couldn't typecheck until the new archetype/metrics existed).
//
// #9: every assertion is a sim-derived truth or a cited mechanical ordering. No tier labels.

import { describe, it, expect, beforeEach } from 'vitest'
import { simulateWand } from '../../sim/simulateWand'
import { computeMetrics, type WandMetrics } from '../../sim/metrics'
import { analyzeWand, ARCHETYPES, type Archetype } from '../../analysis'
import { clearSimCache } from '../../analysis/simCache'
import type { WandShot } from '../../engine/eval/types'
import type { Wand, WandStats } from '../../schema/snapshot'
import { CORPUS, type CorpusBuild } from './builds'
import { buildWandFromSpellIds } from './buildWand'

beforeEach(clearSimCache)

const byId = (id: string): CorpusBuild => {
  const b = CORPUS.find((x) => x.id === id)
  if (!b) throw new Error(`corpus build not found: ${id}`)
  return b
}

const metricsOf = (b: CorpusBuild): WandMetrics => {
  const wand = buildWandFromSpellIds(b)
  const sim = simulateWand(wand)
  return computeMetrics(sim.shots, sim.reloadTime, wand.stats, sim.hitIterationLimit)
}

/** A top-level projectile carries a trigger payload (every corpus trigger build
 *  puts its trigger on a depth-1 carrier, so depth-1 detection is sufficient). */
const treeHasTrigger = (shots: readonly WandShot[]): boolean =>
  shots.some((shot) => shot.projectiles.some((p) => p.trigger != null))

const scoresOf = (id: string) => analyzeWand(buildWandFromSpellIds(byId(id)), []).scores
/** One archetype's score for a corpus build (perks: none). */
const scoreOf = (id: string, archetype: Archetype): number => scoresOf(id)[archetype].score
/** The archetype a build scores highest on. */
const topArchetype = (id: string): Archetype => {
  const s = scoresOf(id)
  return ARCHETYPES.reduce((best, k) => (s[k].score > s[best].score ? k : best), ARCHETYPES[0])
}

/** An inline wand on the corpus roomy chassis — for §7.5 cases that need a control twin. */
const inlineWand = (spells: string[], statsOver: Partial<WandStats> = {}): Wand => ({
  slot: 0, active: true, always_cast: [], spells,
  stats: {
    shuffle: false, spellsPerCast: 1, castDelay: 10, rechargeTime: 20,
    manaMax: 1000, mana: 1000, manaChargeSpeed: 100, capacity: 10, spread: 0, speedMultiplier: 1, ...statsOver,
  },
})
const damageOf = (w: Wand): number => analyzeWand(w, []).scores.DAMAGE.score

describe('corpus — Layer A: the sim faithfully reproduces each build', () => {
  it('has a spec-sized corpus (15–20 builds) with unique ids', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(15)
    expect(CORPUS.length).toBeLessThanOrEqual(20)
    expect(new Set(CORPUS.map((b) => b.id)).size).toBe(CORPUS.length)
  })

  it('every build resolves entirely against the engine (no modded/missing spells)', () => {
    for (const b of CORPUS) {
      const sim = simulateWand(buildWandFromSpellIds(b))
      expect(sim.missingSpells, `${b.id} missing: ${sim.missingSpells.join(',')}`).toEqual([])
      expect(sim.approximate, `${b.id} should simulate exactly`).toBe(false)
    }
  })

  it('reproduces each build’s documented mechanics (projectile count / trigger / mana)', () => {
    for (const b of CORPUS) {
      if (!b.documented) continue
      const wand = buildWandFromSpellIds(b)
      const sim = simulateWand(wand)
      const m = computeMetrics(sim.shots, sim.reloadTime, wand.stats, sim.hitIterationLimit)
      const d = b.documented
      if (d.projectilesPerCast != null) {
        expect(m.projectilesPerCast, `${b.id} projectilesPerCast`).toBe(d.projectilesPerCast)
      }
      if (d.hasTrigger != null) {
        expect(treeHasTrigger(sim.shots), `${b.id} hasTrigger`).toBe(d.hasTrigger)
      }
      if (d.manaSustainable != null) {
        expect(m.manaSustainable, `${b.id} manaSustainable`).toBe(d.manaSustainable)
      }
    }
  })

  it('every build delivers some combat damage OR is a documented digger/enabler', () => {
    // A pure-digger/enabler reading ~0 combat DPS is correct (it routes to DIGGING),
    // but a DAMAGE/AOE/SPAM build with 0 DPS would be a fidelity bug.
    const utility = new Set(['luminous-drill-digger', 'black-hole-digger', 'drill-only-no-combat', 'chainsaw-only'])
    for (const b of CORPUS) {
      if (utility.has(b.id)) continue
      const m = metricsOf(b)
      expect(m.sustainedDps, `${b.id} should deal combat damage`).toBeGreaterThan(0)
    }
  })
})

// Builds with an UNAMBIGUOUS meta purpose route to that archetype (argmax). The combat
// overlaps (damage-broadcast / bomb-trigger-fan / boss-killer legitimately top several of
// DAMAGE/AOE/SPAM — §5.3 "overlap is intentional") and the Layer-C foils (wide-scatter,
// chainsaw-plus-payload) are validated by the orderings below, not by a unique argmax.
const ROUTING_EXEMPLARS: Record<string, Archetype> = {
  'bare-light-bullet': 'SPAM',
  'trigger-heavy-payload': 'DAMAGE',
  'nested-trigger-chain': 'DAMAGE',
  'crit-stack': 'DAMAGE',
  'sustainable-spammer': 'SPAM',
  'starved-spammer': 'SPAM',
  'nuke-aoe': 'AOE',
  'chain-bolt-penetrating': 'AOE',
  'luminous-drill-digger': 'DIGGING',
  'black-hole-digger': 'DIGGING',
  'drill-only-no-combat': 'DIGGING',
  'chainsaw-only': 'DIGGING',
}

describe('corpus — Layer B: each build routes to its documented archetype', () => {
  for (const [id, arch] of Object.entries(ROUTING_EXEMPLARS)) {
    it(`${id} → ${arch}`, () => {
      expect(byId(id).documentedArchetype).toBe(arch) // the corpus oracle and the test agree
      expect(topArchetype(id)).toBe(arch)
    })
  }
})

describe('corpus — Layer C: cited mechanical orderings (the v2 TTK scorer)', () => {
  it('trigger→heavy payload > bare carrier (DAMAGE) — payload delivery', () => {
    expect(scoreOf('trigger-heavy-payload', 'DAMAGE')).toBeGreaterThan(scoreOf('bare-light-bullet', 'DAMAGE'))
  })

  it('modifier→multicast broadcast > bare multicast (DAMAGE) — the multiplier engine', () => {
    expect(scoreOf('damage-broadcast-multicast', 'DAMAGE')).toBeGreaterThan(scoreOf('tight-burst', 'DAMAGE'))
  })

  it('tight burst > wide scatter (DAMAGE single-target) — spread costs the on-target fraction', () => {
    expect(scoreOf('tight-burst', 'DAMAGE')).toBeGreaterThan(scoreOf('wide-scatter', 'DAMAGE'))
  })

  it('crit-stacked > un-crit at the same projectile (DAMAGE) — multiplicative crit', () => {
    const uncrit = damageOf(inlineWand(['HEAVY_BULLET']))
    expect(scoreOf('crit-stack', 'DAMAGE')).toBeGreaterThan(uncrit)
  })

  it('enabler + ranged payload > enabler-only (DAMAGE) — the reach/chainsaw case', () => {
    expect(scoreOf('chainsaw-plus-ranged-payload', 'DAMAGE')).toBeGreaterThan(scoreOf('chainsaw-only', 'DAMAGE'))
  })

  it('mana-sustainable spammer > identical mana-starved one (SPAM) — mana is a hard gate', () => {
    expect(scoreOf('sustainable-spammer', 'SPAM')).toBeGreaterThan(scoreOf('starved-spammer', 'SPAM'))
  })

  it('sustainable high-tier digger > unsustainable higher-capability one (DIGGING)', () => {
    expect(scoreOf('luminous-drill-digger', 'DIGGING')).toBeGreaterThan(scoreOf('black-hole-digger', 'DIGGING'))
  })
})

describe('corpus — §7.5 maintainer ground-truth mechanic cases', () => {
  it('Chain Bolt reads an honest TTK — modest DAMAGE, routes AOE via penetration', () => {
    expect(topArchetype('chain-bolt-penetrating')).toBe('AOE')
    expect(scoreOf('chain-bolt-penetrating', 'DAMAGE')).toBeLessThan(40) // low-but-correct, not inflated
  })

  it('drill-only and chainsaw-only are demoted on combat (DAMAGE near zero, DIGGING higher)', () => {
    for (const id of ['drill-only-no-combat', 'chainsaw-only']) {
      const s = scoresOf(id)
      expect(s.DAMAGE.score).toBeLessThan(20)
      expect(s.DIGGING.score).toBeGreaterThan(s.DAMAGE.score)
    }
  })

  it('a sustainable damage wand ≥ its unsustainable nova twin (mana is a hard gate)', () => {
    const sustainable = damageOf(inlineWand(['HEAVY_BULLET', 'HEAVY_BULLET'], { manaMax: 1000, mana: 1000, manaChargeSpeed: 400 }))
    const nova = damageOf(inlineWand(['HEAVY_BULLET', 'HEAVY_BULLET'], { manaMax: 50, mana: 50, manaChargeSpeed: 5 }))
    expect(sustainable).toBeGreaterThan(nova)
  })

  it('a sustainable top-tier digger tops the corpus DIGGING ranking', () => {
    const best = Math.max(...CORPUS.map((b) => scoresOf(b.id).DIGGING.score))
    expect(scoresOf('luminous-drill-digger').DIGGING.score).toBe(best)
  })
})
