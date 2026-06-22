import { describe, it, expect } from 'vitest'
import { parseSnapshot, type Wand, type WandStats } from '../schema/snapshot'
import type { WandShot } from '../engine/eval/types'
import type { GunActionState } from '../engine/extra/types'
import { simulateWand } from './simulateWand'
import { computeMetrics, type WandMetrics } from './metrics'

/** Minimal castState carrying only the modifier deltas metrics reads. */
const castState = (over: Partial<GunActionState>): GunActionState =>
  ({ damage_projectile_add: 0, damage_explosion_add: 0, explosion_radius: 0, ...over }) as GunActionState

const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const heldWand = (suffix: string): Wand => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (!key) throw new Error(`fixture not found: ${suffix}`)
  return parseSnapshot(fixtures[key]).wands[0]
}

const metricsFor = (suffix: string): WandMetrics => {
  const wand = heldWand(suffix)
  const sim = simulateWand(wand)
  return computeMetrics(sim.shots, sim.reloadTime, wand.stats, sim.hitIterationLimit)
}

// Characterization goldens — the actual simulated values for the captured wands.
// (Damage is in HP: rubber_ball 0.12×25 = 3; grenade 1.3×25 + 1.9×25 = 80;
// bubbleshot 0.2×25 = 5.) A change here is a real behavior change, not noise.
describe('computeMetrics — fixture goldens', () => {
  it('snapshot_01 — RUBBER_BALL ×2 (spammy, sustainable, tiny dig-explosion)', () => {
    const m = metricsFor('snapshot_01.json')
    expect(m.shotsUntilReload).toBe(2)
    expect(m.cycleFrames).toBe(50) // 2×(13−2) fire + 28 reload
    expect(m.cycleSeconds).toBeCloseTo(0.8333)
    expect(m.projectilesPerCast).toBe(1)
    expect(m.projectilesPerCycle).toBe(2)
    expect(m.projectilesPerSecond).toBeCloseTo(2.4)
    expect(m.damagePerCast).toBe(3)
    expect(m.damagePerCycle).toBe(6)
    expect(m.sustainedDps).toBeCloseTo(7.2)
    expect(m.burstDps).toBeCloseTo(16.3636)
    expect(m.manaPerCycle).toBe(10)
    expect(m.manaSustainable).toBe(true)
    expect(m.secondsUntilStall).toBeNull()
    expect(m.effectiveSpread).toBeCloseTo(-1)
    expect(m.maxExplosionRadius).toBe(1)
    expect(m.truncated).toBe(false)
    expect(m.damageApproximate).toBe(false)
  })

  it('snapshot_02 — GRENADE (one big AoE shot, mana-limited)', () => {
    const m = metricsFor('snapshot_02.json')
    expect(m.shotsUntilReload).toBe(1)
    expect(m.cycleFrames).toBe(69) // (11+30) fire + 28 reload
    expect(m.projectilesPerCycle).toBe(1)
    expect(m.damagePerCast).toBe(80) // 1.3×25 direct + 1.9×25 explosion
    expect(m.sustainedDps).toBeCloseTo(69.5652)
    expect(m.burstDps).toBeCloseTo(117.0732)
    expect(m.manaPerCycle).toBe(50)
    expect(m.manaSustainable).toBe(false)
    expect(m.secondsUntilStall).toBeCloseTo(6.1293)
    expect(m.effectiveSpread).toBe(0)
    expect(m.maxExplosionRadius).toBe(7)
  })

  it('snapshot_03 — BUBBLESHOT ×3 (fast spam, negative spread)', () => {
    const m = metricsFor('snapshot_03.json')
    expect(m.shotsUntilReload).toBe(3)
    expect(m.cycleFrames).toBe(58) // 3×(11−5) fire + 40 reload
    expect(m.projectilesPerCycle).toBe(3)
    expect(m.projectilesPerSecond).toBeCloseTo(3.1034)
    expect(m.damagePerCast).toBe(5)
    expect(m.damagePerCycle).toBe(15)
    expect(m.burstDps).toBeCloseTo(50)
    expect(m.manaSustainable).toBe(true)
    expect(m.effectiveSpread).toBeCloseTo(-3)
    expect(m.maxExplosionRadius).toBe(4)
  })

  it('no metric is NaN for any fixture', () => {
    for (const suffix of ['snapshot_01.json', 'snapshot_02.json', 'snapshot_03.json']) {
      const m = metricsFor(suffix)
      for (const [key, val] of Object.entries(m)) {
        if (typeof val === 'number') {
          expect(Number.isNaN(val), `${suffix}.${key} is NaN`).toBe(false)
        }
      }
    }
  })
})

describe('computeMetrics — edge cases', () => {
  const stats: WandStats = {
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
  }

  it('empty cast → all zero, no NaN, sustainable', () => {
    const m = computeMetrics([], undefined, stats, false)
    expect(m.shotsUntilReload).toBe(0)
    expect(m.cycleFrames).toBe(0)
    expect(m.projectilesPerSecond).toBe(0)
    expect(m.damagePerCycle).toBe(0)
    expect(m.sustainedDps).toBe(0)
    expect(m.burstDps).toBe(0)
    expect(m.manaSustainable).toBe(true)
    expect(m.secondsUntilStall).toBeNull()
    for (const val of Object.values(m)) {
      if (typeof val === 'number') expect(Number.isNaN(val)).toBe(false)
    }
  })

  it('unknown (modded) projectile entity → damageApproximate, 0 damage, no throw', () => {
    const shot: WandShot = {
      projectiles: [{ entity: 'data/entities/projectiles/deck/zzz_modded.xml' }],
      calledActions: [],
      actionTree: [],
    }
    const m = computeMetrics([shot], 20, stats, false)
    expect(m.damageApproximate).toBe(true)
    expect(m.damagePerCast).toBe(0)
    expect(m.projectilesPerCast).toBe(1)
    // castState is undefined here → per-shot delay falls back to stats.castDelay
    expect(m.cycleFrames).toBe(30) // 10 fire + 20 reload
  })

  it('truncated flag passes through from the iteration limit', () => {
    expect(computeMetrics([], undefined, stats, true).truncated).toBe(true)
  })

  it('modifier-added explosion damage on a non-exploding base IS counted', () => {
    // rubber_ball has intrinsic explosionDamage 0; an EXPLOSIVE_PROJECTILE-style
    // modifier adds +0.2 (=5 HP). Direct 0.12×25=3 + explosion 0.2×25=5 → 8 HP.
    const shot: WandShot = {
      projectiles: [{ entity: 'data/entities/projectiles/deck/rubber_ball.xml' }],
      calledActions: [],
      actionTree: [],
      castState: castState({ damage_explosion_add: 0.2 }),
    }
    const m = computeMetrics([shot], 20, stats, false)
    expect(m.damagePerCast).toBeCloseTo(8)
    expect(m.damageApproximate).toBe(false)
  })
})
