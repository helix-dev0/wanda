import { describe, it, expect } from 'vitest'
import { parseSnapshot, type Wand, type WandStats } from '../schema/snapshot'
import type { WandShot } from '../engine/eval/types'
import type { GunActionState } from '../engine/extra/types'
import { simulateWand } from './simulateWand'
import { computeMetrics, type WandMetrics } from './metrics'
import { getProjectileStats } from './data/projectileStats'

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

/** Build + simulate a wand from a bare spell list on a neutral roomy chassis. */
const metricsForDeck = (spells: string[], stats: Partial<WandStats> = {}): WandMetrics => {
  const wand: Wand = {
    slot: 0, active: true, always_cast: [], spells,
    stats: { manaChargeSpeed: 50, mana: 1000, manaMax: 1000, castDelay: 10, capacity: Math.max(1, spells.length), spellsPerCast: 1, spread: 0, rechargeTime: 20, speedMultiplier: 1, shuffle: false, ...stats },
  }
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
    expect(m.cycleFrames).toBe(39) // 11 (d1) + max(11 d2, 28 recharge) — cast delay overlaps recharge
    expect(m.cycleSeconds).toBeCloseTo(0.65)
    expect(m.projectilesPerCast).toBe(1)
    expect(m.projectilesPerCycle).toBe(2)
    expect(m.projectilesPerSecond).toBeCloseTo(3.0769)
    expect(m.damagePerCast).toBe(3)
    expect(m.damagePerCycle).toBe(6)
    expect(m.sustainedDps).toBeCloseTo(9.2308)
    expect(m.burstDps).toBeCloseTo(11.7273) // achievable: ~1.95 cycles fit a 1s window (cycle 0.65s)
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
    expect(m.cycleFrames).toBe(41) // max(41 castDelay, 28 recharge) — single shot, recharge fully overlaps
    expect(m.projectilesPerCycle).toBe(1)
    expect(m.damagePerCast).toBe(92.5) // 1.3×25 direct + 0.5×25 fire-on-hit (B1) + 1.9×25 explosion
    expect(m.sustainedDps).toBeCloseTo(135.3659) // == burstDps (recharge ≤ castDelay, fully overlapped); +fire vs the pre-B1 117
    expect(m.burstDps).toBeCloseTo(135.3659)
    expect(m.manaPerCycle).toBe(50)
    expect(m.manaSustainable).toBe(false)
    expect(m.secondsUntilStall).toBeCloseTo(2.1876)
    expect(m.effectiveSpread).toBe(0)
    expect(m.maxExplosionRadius).toBe(7)
  })

  it('snapshot_03 — BUBBLESHOT ×3 (fast spam, negative spread)', () => {
    const m = metricsFor('snapshot_03.json')
    expect(m.shotsUntilReload).toBe(3)
    expect(m.cycleFrames).toBe(52) // 2×6 (d1,d2) + max(6 d3, 40 recharge)
    expect(m.projectilesPerCycle).toBe(3)
    expect(m.projectilesPerSecond).toBeCloseTo(3.4615)
    expect(m.damagePerCast).toBe(5)
    expect(m.damagePerCycle).toBe(15)
    expect(m.burstDps).toBeCloseTo(21.6667) // achievable: ~1.44 cycles in a 1s window (cycle 0.87s)
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

describe('burstDps — ACHIEVABLE peak (recharge + mana bounded), not a fictional sub-cast rate', () => {
  it('a single nova with a long recharge bursts ONE cast in the window, not damage×60', () => {
    // cast delay ~0 + 2s recharge: the old damage÷1-frame read ~60× a cast's damage. The
    // achievable peak is the ONE cast you get off in a 1s window (then you idle out the recharge).
    const m = metricsForDeck(['BULLET'], { castDelay: 0, rechargeTime: 120, capacity: 1 })
    expect(m.shotsUntilReload).toBe(1)
    expect(m.burstDps).toBeCloseTo(m.damagePerCycle) // one nova per 1s window, NOT damage×60
  })

  it('an unsustainable nova is MANA-bounded — cannot burst beyond what mana pays for (Principle 5)', () => {
    // Same deck, only manaMax differs: the mana-starved one fires fewer casts in the window, so
    // its burst is strictly lower. This is what stops a "sustains 42 of 373" nova reading huge.
    const opts = { manaChargeSpeed: 10, rechargeTime: 4, castDelay: 1, capacity: 2 }
    const starved = metricsForDeck(['CHAIN_BOLT', 'CHAIN_BOLT'], { ...opts, manaMax: 80 })
    const loaded = metricsForDeck(['CHAIN_BOLT', 'CHAIN_BOLT'], { ...opts, manaMax: 100000 })
    expect(starved.burstDps).toBeLessThan(loaded.burstDps)
  })

  it('a multi-shot wand KEEPS burst > sustained (a real firing window is front-loadable)', () => {
    // Several shots fire before a long recharge; that window beats the cycle-average rate, so
    // burst > sustained must be preserved (no over-correction).
    const m = metricsForDeck(['BULLET', 'BULLET', 'BULLET'], { castDelay: 6, rechargeTime: 90, capacity: 3 })
    expect(m.shotsUntilReload).toBe(3)
    expect(m.burstDps).toBeGreaterThan(m.sustainedDps)
  })
})

describe('shotDamage — typed damage_by_type counts as HP (B1)', () => {
  it('CHAINSAW (slice 0.51) reads ~12.75 HP/cast — was 0 (typed damage ignored)', () => {
    expect(metricsForDeck(['CHAINSAW']).damagePerCast).toBeCloseTo(12.75, 1)
  })
  it('a typed-only carrier contributes to sustained DPS (was scored as 0-damage)', () => {
    expect(metricsForDeck(['CHAINSAW']).sustainedDps).toBeGreaterThan(0)
  })
})

describe('shotDamage / AoE — crit scales explosion + blast (B2)', () => {
  it('crit scales the explosion in damagePerCast AND the AoE blast, by the same factor', () => {
    const plain = metricsForDeck(['GRENADE'])
    const crit = metricsForDeck(['CRITICAL_HIT', 'GRENADE'])
    // B2a: the explosion (not just the projectile) scales with crit → the whole cast ×factor.
    const factor = crit.damagePerCast / plain.damagePerCast
    expect(factor).toBeGreaterThan(1) // CRITICAL_HIT raised it
    // B2b: the AoE metric scales by the SAME crit factor (was unscaled before).
    expect(crit.maxExplosionDamage).toBeGreaterThan(plain.maxExplosionDamage)
    expect(crit.maxExplosionDamage).toBeCloseTo(plain.maxExplosionDamage * factor, 1)
  })
})

describe('computeMetrics — range + mana-honest fields (B3/B4)', () => {
  it('reachUsability: every ranged fixture is fully usable (1.0) — reach ≥ 250px', () => {
    expect(metricsFor('snapshot_01.json').reachUsability).toBeCloseTo(1) // rubber_ball ~9375px
    expect(metricsFor('snapshot_02.json').reachUsability).toBeCloseTo(1) // grenade ~2333px
    expect(metricsFor('snapshot_03.json').reachUsability).toBeCloseTo(1) // bubbleshot ~500px
  })
  it('a lobbed explosive (BOMB, config speedMax=0) is NOT reach-floored — its blast reaches', () => {
    const m = metricsForDeck(['BOMB'])
    expect(m.maxExplosionDamage).toBeGreaterThan(0) // it does explode
    expect(m.reachUsability).toBeGreaterThan(0.9) // explosion weight gets full reach, not melee 0.1
  })

  // Range is classified by weapon KIND, not ballistic distance: distance is unusable in Noita
  // (a slow ranged bolt under-reaches a digging beam; a combat beam barely moves). See
  // isCloseRangeProjectile + docs/scoring-rebuild-spec.md.
  it('CHAIN_BOLT (a slow ranged bolt, 29px flight) is FULLY ranged — fired, not contact', () => {
    // The bug: ballistic reach (29px) ranked Chain Bolt BELOW the digging drill (47px) and
    // crushed it to ~0.12. It is a fired chaining spell, so its damage reaches at range.
    expect(metricsForDeck(['CHAIN_BOLT']).reachUsability).toBeCloseTo(1)
  })
  it('LUMINOUS_DRILL (digging beam) contributes ~0 COMBAT damage — keystone via zero offense', () => {
    // Digging isn't combat damage, so a drill-only "damage" wand has ~0 sustained DPS and is
    // demoted by zero offensive output (not by the reach floor). Crit/multicast can't inflate 0.
    const m = metricsForDeck(['LUMINOUS_DRILL'])
    expect(m.sustainedDps).toBeCloseTo(0)
    expect(m.damagePerCast).toBeCloseTo(0)
  })
  it('CHAINSAW (melee swing, slice at 7px) stays close-range — keystone preserved', () => {
    // Slice IS combat damage (it counts), but the reach factor floors its 7px melee range.
    expect(metricsForDeck(['CHAINSAW']).reachUsability).toBeCloseTo(0.1)
  })
  it('a drill ENABLER no longer drags a ranged payload — its digging damage is excluded', () => {
    // Chain Bolt is the damage (ranged); the drill is a speed enabler whose digging damage is
    // excluded from combat, so the deck reads FULLY ranged (was dragged to ~0.6 by the drill).
    expect(metricsForDeck(['CHAIN_BOLT', 'LUMINOUS_DRILL']).reachUsability).toBeCloseTo(1)
  })
  it('keystone canary: the untyped digging-beam entity path still exists', () => {
    // LUMINOUS_DRILL is floored as close-range only via entity.includes('luminous_drill') (its
    // damage is untyped, not `drill`-typed). If a game/mod version renames this path the guard
    // silently fails and the digger reverts to ranged — the exact bug the reach factor prevents.
    // Fail LOUDLY here on a rename instead.
    expect(getProjectileStats('data/entities/projectiles/deck/luminous_drill.xml')).toBeDefined()
  })
  it('effectiveSustainedDps == sustainedDps when mana-sustainable (identity, goldens-safe)', () => {
    const a = metricsFor('snapshot_01.json')
    expect(a.effectiveSustainedDps).toBeCloseTo(a.sustainedDps)
    const c = metricsFor('snapshot_03.json')
    expect(c.effectiveSustainedDps).toBeCloseTo(c.sustainedDps)
  })
  it('effectiveSustainedDps throttles an out-draining wand (grenade 117→43, ×regen/drain)', () => {
    const m = metricsFor('snapshot_02.json')
    expect(m.manaSustainable).toBe(false)
    expect(m.effectiveSustainedDps).toBeCloseTo(49.95, 1) // 135.37 raw × manaRatio 0.369
    expect(m.effectiveSustainedDps).toBeLessThan(m.sustainedDps)
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
    expect(m.cycleFrames).toBe(20) // max(10 castDelay, 20 reload) — single shot, recharge overlaps
  })

  it('truncated flag passes through from the iteration limit', () => {
    expect(computeMetrics([], undefined, stats, true).truncated).toBe(true)
  })

  // --- Tier-0 grounding: payload-aware damage + explosion DAMAGE ---
  const P = 'data/entities/projectiles/'
  const RUBBER = `${P}deck/rubber_ball.xml` // 0.12 dmg = 3 HP, explosion 0, radius 1 (digging)
  const GRENADE = `${P}deck/grenade.xml` // 1.3 + 1.9 explosion = 80 HP, explosion 1.9 = 47.5 HP, radius 7
  const shotWith = (over: Partial<WandShot>): WandShot => ({
    projectiles: [],
    calledActions: [],
    actionTree: [],
    ...over,
  })

  it('counts TRIGGER PAYLOAD damage (walks projectile.trigger recursively)', () => {
    // A cheap carrier (rubber_ball, 3 HP) that triggers a heavy payload (grenade, 80 HP).
    // The whole high-damage Noita meta is payloads; per cast = carrier + payload delivered.
    const shot = shotWith({
      projectiles: [{ entity: RUBBER, trigger: shotWith({ projectiles: [{ entity: GRENADE }] }) }],
    })
    const m = computeMetrics([shot], 20, stats, false)
    expect(m.damagePerCast).toBeCloseTo(95.5) // 3 carrier + 92.5 grenade payload (B1: +fire on the payload)
  })

  it('recurses nested trigger chains and is bounded (no blow-up)', () => {
    // carrier -> trigger -> trigger (grenade): 3 + 3 + 92.5 (B1: grenade payload now counts fire)
    const inner = shotWith({ projectiles: [{ entity: GRENADE }] })
    const mid = shotWith({ projectiles: [{ entity: RUBBER, trigger: inner }] })
    const shot = shotWith({ projectiles: [{ entity: RUBBER, trigger: mid }] })
    const m = computeMetrics([shot], 20, stats, false)
    expect(m.damagePerCast).toBeCloseTo(98.5)
  })

  it('maxExplosionDamage: 0 for a digging blast, >0 for a damaging blast', () => {
    const dig = computeMetrics([shotWith({ projectiles: [{ entity: RUBBER }] })], 20, stats, false)
    expect(dig.maxExplosionRadius).toBe(1)
    expect(dig.maxExplosionDamage).toBe(0) // rubber_ball digs but deals no blast damage
    const blast = computeMetrics([shotWith({ projectiles: [{ entity: GRENADE }] })], 20, stats, false)
    expect(blast.maxExplosionDamage).toBeCloseTo(47.5) // 1.9 × 25
    expect(blast.maxExplosionRadius).toBe(7)
  })

  it('sees a damaging explosion inside a trigger payload', () => {
    const shot = shotWith({
      projectiles: [{ entity: RUBBER, trigger: shotWith({ projectiles: [{ entity: GRENADE }] }) }],
    })
    expect(computeMetrics([shot], 20, stats, false).maxExplosionDamage).toBeCloseTo(47.5)
  })

  // Crit (the multiplicative-stacking meta). Noita: TotalDamage = Base × (1 +
  // min(c,1)·(5·max(1,c) − 1)) with c = critChance fraction. RUBBER = 3 HP base.
  it('applies the crit multiplier from castState.damage_critical_chance', () => {
    const at = (chance: number) =>
      computeMetrics(
        [shotWith({ projectiles: [{ entity: RUBBER }], castState: castState({ damage_critical_chance: chance }) })],
        20,
        stats,
        false,
      ).damagePerCast
    expect(at(0)).toBeCloseTo(3) // no crit → unchanged (goldens safe)
    expect(at(25)).toBeCloseTo(6) // 1 + 4·0.25 = 2× → 6
    expect(at(100)).toBeCloseTo(15) // 5× → 15
    expect(at(200)).toBeCloseTo(30) // >100%: 5·2 = 10× → 30
  })

  it('crit applies per-shot, so a payload with its own crit is multiplied independently', () => {
    // carrier RUBBER (3, no crit) + payload RUBBER at 100% crit (3 → 15) = 18.
    const shot = shotWith({
      projectiles: [
        { entity: RUBBER, trigger: shotWith({ projectiles: [{ entity: RUBBER }], castState: castState({ damage_critical_chance: 100 }) }) },
      ],
    })
    expect(computeMetrics([shot], 20, stats, false).damagePerCast).toBeCloseTo(18)
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

  // --- status / DoT capability (appliesDot) — a grounded, goldens-safe capability flag ---
  const POISON = `${P}deck/poison_blast.xml` // sprays poison on impact (path match; no damage field)
  const ACID = `${P}acidshot.xml` // sprays acid (path match)
  const dotOf = (shot: WandShot) => computeMetrics([shot], 20, stats, false).appliesDot

  it('appliesDot defaults all-false (plain projectile / empty cast)', () => {
    expect(dotOf(shotWith({ projectiles: [{ entity: RUBBER }] }))).toEqual({ fire: false, poison: false, toxic: false })
    expect(computeMetrics([], undefined, stats, false).appliesDot).toEqual({ fire: false, poison: false, toxic: false })
  })

  it('appliesDot.fire from a projectile carrying typed fire damage (grenade)', () => {
    expect(dotOf(shotWith({ projectiles: [{ entity: GRENADE }] })).fire).toBe(true)
  })

  it('appliesDot.fire from a shot material (NUKE → material "fire")', () => {
    const shot = shotWith({ projectiles: [{ entity: RUBBER }], castState: castState({ material: 'fire' }) })
    expect(dotOf(shot).fire).toBe(true)
  })

  it('appliesDot from trail_material: fire / poison / acid→toxic', () => {
    expect(dotOf(shotWith({ projectiles: [{ entity: RUBBER }], castState: castState({ trail_material: 'fire,' }) })).fire).toBe(true)
    expect(dotOf(shotWith({ projectiles: [{ entity: RUBBER }], castState: castState({ trail_material: 'poison,' }) })).poison).toBe(true)
    expect(dotOf(shotWith({ projectiles: [{ entity: RUBBER }], castState: castState({ trail_material: 'acid,' }) })).toxic).toBe(true)
  })

  it('appliesDot.poison / .toxic from a material-spraying projectile (entity path)', () => {
    expect(dotOf(shotWith({ projectiles: [{ entity: POISON }] })).poison).toBe(true)
    expect(dotOf(shotWith({ projectiles: [{ entity: ACID }] })).toxic).toBe(true)
  })

  it('appliesDot recurses into a trigger payload', () => {
    const shot = shotWith({ projectiles: [{ entity: RUBBER, trigger: shotWith({ projectiles: [{ entity: GRENADE }] }) }] })
    expect(dotOf(shot).fire).toBe(true)
  })

  it('appliesDot on fixtures is goldens-safe: only the GRENADE applies fire', () => {
    expect(metricsFor('snapshot_02.json').appliesDot).toEqual({ fire: true, poison: false, toxic: false })
    expect(metricsFor('snapshot_01.json').appliesDot).toEqual({ fire: false, poison: false, toxic: false })
    expect(metricsFor('snapshot_03.json').appliesDot).toEqual({ fire: false, poison: false, toxic: false })
  })
})

// S2 — additive raw ingredients the TTK scorer (S3/S4) consumes. These are
// reference-agnostic (no enemy HP, no mob spacing): the analysis layer turns them
// into mob coverage / overkill floors. Adding them must not move any golden above.
describe('computeMetrics — TTK ingredients (S2, additive)', () => {
  it('firstCastSeconds is the first shot’s cast time (overkill-floor granularity)', () => {
    // snapshot_01: d1 = 11 frames (cycleFrames 39 = 11 + max(11 d2, 28 recharge)).
    expect(metricsFor('snapshot_01.json').firstCastSeconds).toBeCloseTo(11 / 60)
    // single-shot grenade: the whole cast IS the first cast.
    expect(metricsFor('snapshot_02.json').firstCastSeconds).toBeGreaterThan(0)
  })

  it('penetration capability: a penetrating projectile exposes reach + per-hit HP', () => {
    const chain = metricsForDeck(['CHAIN_BOLT'])
    expect(chain.pierceReachPx).toBeCloseTo((40 * 44) / 60) // speedMax×lifetime/60 = 29.33px
    expect(chain.pierceHitHP).toBeCloseTo(25) // 1.0 internal × 25 HP, no modifiers
  })

  it('a non-penetrating projectile reports zero penetration', () => {
    const light = metricsForDeck(['LIGHT_BULLET'])
    expect(light.pierceReachPx).toBe(0)
    expect(light.pierceHitHP).toBe(0)
  })

  it('a penetrating projectile that deals no combat damage clears nothing (Black Hole)', () => {
    const bh = metricsForDeck(['BLACK_HOLE'])
    expect(bh.pierceReachPx).toBeCloseTo((40 * 120) / 60) // 80px — it does penetrate
    expect(bh.pierceHitHP).toBe(0) // …but 0 combat damage, so it kills no mob
  })

  it('a flat +damage modifier cannot inflate a pure digging beam into a damage shot', () => {
    // [Damage Plus, Luminous Drill]: the drill is 0 combat (the digging exclusion), and the
    // shot's projectile-add must NOT turn it into a damage shot (the 'S-tier digger' bug).
    expect(metricsForDeck(['DAMAGE', 'LUMINOUS_DRILL']).damagePerCast).toBe(0)
    // sanity: the same modifier DOES buff a real projectile.
    expect(metricsForDeck(['DAMAGE', 'LIGHT_BULLET']).damagePerCast).toBeGreaterThan(
      metricsForDeck(['LIGHT_BULLET']).damagePerCast,
    )
  })

  it('detects a trigger payload in the cast tree (drives the reliability note)', () => {
    expect(metricsForDeck(['ADD_TRIGGER', 'LIGHT_BULLET', 'HEAVY_BULLET']).hasTrigger).toBe(true)
    expect(metricsForDeck(['LIGHT_BULLET']).hasTrigger).toBe(false)
  })
})
