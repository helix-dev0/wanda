// Regression: a maxed-out FAST wand (cast delay driven <= 0, recharge zeroed by an
// enabler like Luminous Drill) must NOT score 0 DPS. The cast cycle can't complete in
// under one frame, so throughput is capped at the frame rate (~60 casts/s per the
// scoring-grounding spec "0/0 -> ~60 casts/s"), NOT divided to zero by a 0/negative
// cycle time. This is the real wand the maintainer flagged ("super fast, lots of
// damage, no mana drain") that the engine wrongly rated D-tier / 0 damage.

import { describe, it, expect } from 'vitest'
import { simulateWand } from './simulateWand'
import { computeMetrics } from './metrics'
import type { Wand } from '../schema/snapshot'

const fastLaserWand: Wand = {
  spells: ['MANA_REDUCE', 'MANA_REDUCE', 'CRITICAL_HIT', 'BURST_2', 'LASER', 'LUMINOUS_DRILL', null],
  active: true,
  slot: 0,
  always_cast: [],
  stats: {
    manaChargeSpeed: 485, mana: 110, castDelay: 4, capacity: 7, spellsPerCast: 1,
    spread: 4, rechargeTime: 10, speedMultiplier: 1.083, shuffle: false, manaMax: 110,
  },
}

describe('fire-rate cap — a super-fast wand must not divide DPS to zero', () => {
  it('rates the real fast laser wand as high DPS, not 0', () => {
    const sim = simulateWand(fastLaserWand)
    const m = computeMetrics(sim.shots, sim.reloadTime, fastLaserWand.stats, sim.approximate)

    // It genuinely does ~37 HP/cast (laser + drill + 15% crit) — that part already works.
    expect(m.damagePerCast).toBeGreaterThan(20)

    // The bug: at the frame-rate cap this is hundreds+ HP/s, but today it reads 0.
    expect(m.sustainedDps).toBeGreaterThan(500)
    expect(m.burstDps).toBeGreaterThan(500)
    expect(m.projectilesPerSecond).toBeGreaterThan(0)

    // ...but throughput is CAPPED at the real max fire rate (~60 casts/s × 2 projectiles),
    // not unbounded — a divide-by-near-zero must not explode either.
    expect(m.projectilesPerSecond).toBeLessThanOrEqual(140)
    expect(m.cycleSeconds).toBeGreaterThan(0)
  })
})
