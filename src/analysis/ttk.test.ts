import { describe, it, expect } from 'vitest'
import type { WandMetrics } from '../sim/metrics'
import {
  ttkAgainst,
  aoeClearSeconds,
  spamKillRate,
  scoreFromTtk,
  scoreFromScalar,
  NO_FOCUS,
  type TtkBands,
  type ScalarBands,
} from './ttk'

/** A full WandMetrics with neutral defaults; override only what a case exercises. */
const metrics = (over: Partial<WandMetrics> = {}): WandMetrics => {
  const base: WandMetrics = {
    shotsUntilReload: 1, cycleFrames: 30, cycleSeconds: 0.5, fireSeconds: 0.3, firstCastSeconds: 0.2,
    projectilesPerCast: 1, projectilesPerCycle: 1, projectilesPerSecond: 2,
    damagePerCast: 0, damagePerCycle: 0, sustainedDps: 0, effectiveSustainedDps: 0, burstDps: 0,
    pierceReachPx: 0, pierceHitHP: 0,
    manaPerCycle: 0, manaSustainable: true, secondsUntilStall: null,
    effectiveSpread: 0, reachUsability: 1, maxExplosionRadius: 0, maxExplosionDamage: 0,
    appliesDot: { fire: false, poison: false, toxic: false }, hasTrigger: false,
    truncated: false, damageApproximate: false,
  }
  const m = { ...base, ...over }
  if (over.effectiveSustainedDps === undefined) m.effectiveSustainedDps = m.sustainedDps
  return m
}

describe('ttkAgainst', () => {
  it('one-shot → the overkill floor (firstCastSeconds), not the full cycle', () => {
    const m = metrics({ damagePerCast: 200, sustainedDps: 400, firstCastSeconds: 0.15 })
    expect(ttkAgainst(m, 150, NO_FOCUS)).toBe(0.15)
  })

  it('multi-cast → HP / sustainable rate (75/cast vs 150 HP at 150 DPS ⇒ ~1s)', () => {
    const m = metrics({ damagePerCast: 75, sustainedDps: 150, cycleSeconds: 0.5, firstCastSeconds: 0.25 })
    expect(ttkAgainst(m, 150, NO_FOCUS)).toBeCloseTo(1.0)
  })

  it('a wand that deals no damage at all cannot kill (Infinity)', () => {
    // sustainedDps 0 (a pure digger) — genuinely can't kill.
    expect(ttkAgainst(metrics({ damagePerCast: 0, sustainedDps: 0 }), 150, NO_FOCUS)).toBe(Infinity)
  })

  it('a wand whose FIRST cast is a 0-damage utility shot still scores on its later damage', () => {
    // [Luminous Drill, …, Bullet]: damagePerCast (shot 0 = the digging beam) is 0, but the
    // cycle deals real damage (sustainedDps > 0). Must NOT read as Infinity — that was the
    // "real combat wand scores DAMAGE 0 / Kill ∞" bug the maintainer's live wand exposed.
    const m = metrics({ damagePerCast: 0, damagePerCycle: 100, sustainedDps: 200 })
    const ttk = ttkAgainst(m, 150, NO_FOCUS)
    expect(Number.isFinite(ttk)).toBe(true)
    expect(ttk).toBeCloseTo(150 / 200, 2) // 150 HP at the sustainable 200 HP/s rate
  })

  it('focus factors scale the kill: spread/close-range raise TTK', () => {
    const m = metrics({ damagePerCast: 40, sustainedDps: 150 })
    const sharp = ttkAgainst(m, 1000, NO_FOCUS)
    const fuzzy = ttkAgainst(m, 1000, { onTarget: 0.5, reach: 0.5 })
    expect(fuzzy).toBeGreaterThan(sharp)
  })

  it('mana matters: a stalling nova has a much higher boss TTK than a sustainable equal', () => {
    const sustainable = metrics({ damagePerCast: 60, sustainedDps: 300, manaSustainable: true })
    const stalling = metrics({
      damagePerCast: 60, sustainedDps: 300, effectiveSustainedDps: 30,
      manaSustainable: false, secondsUntilStall: 0.5,
    })
    expect(ttkAgainst(stalling, 1000, NO_FOCUS)).toBeGreaterThan(ttkAgainst(sustainable, 1000, NO_FOCUS))
  })

  it('DoT softens a high-HP target: applying fire lowers the boss TTK', () => {
    const base = metrics({ damagePerCast: 60, sustainedDps: 120 })
    const withDot = metrics({
      damagePerCast: 60, sustainedDps: 120, appliesDot: { fire: true, poison: false, toxic: false },
    })
    expect(ttkAgainst(withDot, 1000, NO_FOCUS)).toBeLessThan(ttkAgainst(base, 1000, NO_FOCUS))
  })

  it('DoT alone cannot finish (it floors at ~2% HP): no projectile damage ⇒ Infinity', () => {
    const dotOnly = metrics({ damagePerCast: 0, appliesDot: { fire: true, poison: true, toxic: false } })
    expect(ttkAgainst(dotOnly, 1000, NO_FOCUS)).toBe(Infinity)
  })

  it('DoT runs in PARALLEL and stays numerically stable when DoT rate ≥ projectile rate', () => {
    // fullRate 15 HP/s vs boss 1000 + 1 DoT (2%/s = 20 HP/s): parallel ⇒ ~1000/(15+20) ≈ 28.6s.
    // (The old fixed-point iteration oscillated to a parity-dependent ~65s in this regime.)
    const withDot = metrics({ damagePerCast: 50, sustainedDps: 15, appliesDot: { fire: true, poison: false, toxic: false }, firstCastSeconds: 0.2 })
    const noDot = metrics({ damagePerCast: 50, sustainedDps: 15, firstCastSeconds: 0.2 })
    expect(ttkAgainst(withDot, 1000, NO_FOCUS)).toBeCloseTo(28.6, 0)
    expect(ttkAgainst(noDot, 1000, NO_FOCUS)).toBeCloseTo(1000 / 15, 0) // ~66.7s, no DoT help
  })
})

describe('aoeClearSeconds', () => {
  it('a big lethal blast clears the whole swarm in one cast (= the first cast)', () => {
    const nuke = metrics({ maxExplosionDamage: 250, maxExplosionRadius: 250, cycleSeconds: 2, firstCastSeconds: 0.5 })
    expect(aoeClearSeconds(nuke, 8)).toBeCloseTo(0.5) // radius/24 ≈ 10 ⇒ coverage 8 ⇒ 1 cast
  })

  it('a lethal penetrating bolt clears mobs along its path (partial coverage ⇒ several casts)', () => {
    const chain = metrics({ pierceHitHP: 25, pierceReachPx: 29.33, damagePerCast: 25, cycleSeconds: 0.3, firstCastSeconds: 0.1 })
    // coverage ≈ max(1 direct, 29.33/24 = 1.22) ⇒ ceil(8/1.22)=7 casts ⇒ 0.1 + 6×0.3
    expect(aoeClearSeconds(chain, 8)).toBeCloseTo(1.9)
  })

  it('a penetrating projectile that deals no damage clears nothing (Black Hole ⇒ Infinity)', () => {
    const bh = metrics({ pierceHitHP: 0, pierceReachPx: 80, damagePerCast: 0 })
    expect(aoeClearSeconds(bh, 8)).toBe(Infinity)
  })

  it('a single-projectile wand is NOT an AOE wand (no area/line/spread ⇒ Infinity)', () => {
    const single = metrics({ damagePerCast: 100, projectilesPerCast: 1, cycleSeconds: 0.3 })
    expect(aoeClearSeconds(single, 8)).toBe(Infinity)
  })

  it('a multicast of lethal projectiles clears via spread (finite, several casts)', () => {
    const multi = metrics({ damagePerCast: 90, projectilesPerCast: 3, cycleSeconds: 0.3, firstCastSeconds: 0.1 })
    // 3 projectiles × 30HP each ≥ 22.5 ⇒ 3 mobs/cast ⇒ ceil(8/3)=3 casts ⇒ 0.1 + 2×0.3
    expect(aoeClearSeconds(multi, 8)).toBeCloseTo(0.7)
  })
})

describe('spamKillRate', () => {
  it('= mana-honest DPS / weak-mob HP, reaching at range', () => {
    expect(spamKillRate(metrics({ effectiveSustainedDps: 225, reachUsability: 1 }))).toBeCloseTo(10) // 225/22.5
  })
  it('close range and mana throttle both lower the rate', () => {
    const full = spamKillRate(metrics({ effectiveSustainedDps: 225, reachUsability: 1 }))
    const close = spamKillRate(metrics({ effectiveSustainedDps: 225, reachUsability: 0.3 }))
    const starved = spamKillRate(metrics({ sustainedDps: 225, effectiveSustainedDps: 45 }))
    expect(close).toBeLessThan(full)
    expect(starved).toBeLessThan(full)
  })
})

describe('score mapping (aligned to tierForScore 80/60/40/20)', () => {
  const tb: TtkBands = { S: 1, A: 2, B: 4, C: 8 }
  const sb: ScalarBands = { C: 1, B: 3, A: 6, S: 12 }

  it('TTK bands hit the S/A/B/C anchors and 0 at the extremes', () => {
    expect(scoreFromTtk(0, tb)).toBe(100)
    expect(scoreFromTtk(1, tb)).toBe(80)
    expect(scoreFromTtk(2, tb)).toBe(60)
    expect(scoreFromTtk(4, tb)).toBe(40)
    expect(scoreFromTtk(8, tb)).toBe(20)
    expect(scoreFromTtk(Infinity, tb)).toBe(0)
  })

  it('scoreFromTtk is monotonic decreasing in TTK', () => {
    expect(scoreFromTtk(0.5, tb)).toBeGreaterThan(scoreFromTtk(1.5, tb))
    expect(scoreFromTtk(1.5, tb)).toBeGreaterThan(scoreFromTtk(5, tb))
  })

  it('scalar bands hit S at the top and rise monotonically', () => {
    expect(scoreFromScalar(0, sb)).toBe(0)
    expect(scoreFromScalar(12, sb)).toBe(80)
    expect(scoreFromScalar(3, sb)).toBeGreaterThan(scoreFromScalar(1, sb))
  })
})
