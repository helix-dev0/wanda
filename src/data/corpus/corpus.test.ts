// S0 — the validation harness, Layer A (sim fidelity) + the archetype-stable Layer C
// orderings, locked on TODAY's scorer as a regression net (docs/scoring-model-v2-spec.md
// §7, §8). The DIGGING-routing (Layer B) and TTK-dependent orderings co-land with the
// scorer rebuild (S4) — they can't typecheck until the new archetype/metrics exist.
//
// #9: every assertion is a sim-derived truth or a cited mechanical ordering. No tier labels.

import { describe, it, expect, beforeEach } from 'vitest'
import { simulateWand } from '../../sim/simulateWand'
import { computeMetrics, type WandMetrics } from '../../sim/metrics'
import { analyzeWand } from '../../analysis'
import { clearSimCache } from '../../analysis/simCache'
import type { WandShot } from '../../engine/eval/types'
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

/** DAMAGE/SPAM/AOE score of a build on the CURRENT scorer (perks: none). */
const scoreOf = (id: string, archetype: 'DAMAGE' | 'SPAM' | 'AOE'): number =>
  analyzeWand(buildWandFromSpellIds(byId(id)), []).scores[archetype].score

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

describe('corpus — Layer C: cited mechanical orderings (regression locks on the current scorer)', () => {
  it('trigger→heavy payload > bare carrier (DAMAGE) — payload delivery', () => {
    expect(scoreOf('trigger-heavy-payload', 'DAMAGE')).toBeGreaterThan(scoreOf('bare-light-bullet', 'DAMAGE'))
  })

  it('modifier→multicast broadcast > bare multicast (DAMAGE) — the multiplier engine', () => {
    expect(scoreOf('damage-broadcast-multicast', 'DAMAGE')).toBeGreaterThan(scoreOf('tight-burst', 'DAMAGE'))
  })

  it('tight burst > wide scatter (DAMAGE single-target) — spread costs the on-target fraction', () => {
    // wide-scatter even reads a HIGHER raw sustained DPS, yet loses single-target DAMAGE to spread.
    expect(scoreOf('tight-burst', 'DAMAGE')).toBeGreaterThan(scoreOf('wide-scatter', 'DAMAGE'))
  })

  it('mana-sustainable spammer > identical mana-starved one (SPAM) — mana is a hard gate', () => {
    expect(scoreOf('sustainable-spammer', 'SPAM')).toBeGreaterThan(scoreOf('starved-spammer', 'SPAM'))
  })
})
