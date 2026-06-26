// The TTK model (scoring-model-v2-spec §5.1–5.3). PURE functions over WandMetrics +
// the cited reference enemies — the unit that replaces the old sat(metric, REF) blend.
// Lower TTK / higher kill-rate / higher dig scalar ⇒ higher score, mapped onto the
// existing tierForScore cutoffs (≥80 S … ≥20 C) so that band test is untouched.
//
// #9: no human tier labels. The band CUTOFFS below are PROVISIONAL — the method (kill
// enemy X every ≤ t seconds) is fixed; the meta-expert sets the exact numbers (S6/§5.6).

import type { WandMetrics } from '../sim/metrics'
import {
  REFERENCE_ENEMIES,
  REFERENCE_SWARM,
  MOB_SPACING_PX,
  DOT_RATE_PER_SEC,
  DOT_FLOOR_FRACTION,
} from './referenceEnemies'

export interface FocusFactors {
  /** Fraction of shots that land on a single target (spread penalty), in [0,1]. */
  onTarget: number
  /** Fraction of damage that reaches an engaged target (close-range penalty), in [0,1]. */
  reach: number
}

/** No focusing penalty — used by AOE (spread/range don't gate clearing a cluster, §5.3). */
export const NO_FOCUS: FocusFactors = { onTarget: 1, reach: 1 }

const dotTypeCount = (d: WandMetrics['appliesDot']): number =>
  (d.fire ? 1 : 0) + (d.poison ? 1 : 0) + (d.toxic ? 1 : 0)

/** Seconds to deliver `hp` of PROJECTILE damage at the focused rate, modelling mana as two
 *  phases: full-mana until the wand stalls (`secondsUntilStall`), then mana-throttled
 *  (`effectiveSustainedDps`). Infinity if it deals no damage or stalls before the kill.
 *
 *  `sustained` (the boss anchor — a LONG fight): drop the full-mana burst phase, so the wand
 *  delivers only the rate it can actually pay for (`effectiveSustainedDps`) from t=0. A wand that
 *  drains its pool in <1s then can't "burst down" a 1000-HP boss off stored mana — it's rated on
 *  what it SUSTAINS, not its momentary peak. A mana-sustainable wand has effective == raw, so this
 *  is IDENTICAL to the burst path for it (goldens-safe). Grounded: you can't out-burst a boss you
 *  can't out-last (maintainer-confirmed: a wand that instantly depletes "starts firing poorly"). */
function projectileKillSeconds(m: WandMetrics, f: FocusFactors, hp: number, sustained = false): number {
  if (hp <= 0) return 0
  const fullRate = (sustained ? m.effectiveSustainedDps : m.sustainedDps) * f.onTarget * f.reach
  if (fullRate <= 0) return Infinity
  const burstSeconds = sustained ? Infinity : (m.secondsUntilStall ?? Infinity) // null = sustainable forever
  const hpInBurst = fullRate * burstSeconds
  if (hpInBurst >= hp) return hp / fullRate // killed during the full-mana phase
  const throttRate = m.effectiveSustainedDps * f.onTarget * f.reach
  if (throttRate <= 0) return Infinity // stalls before the kill and can't recover
  return burstSeconds + (hp - hpInBurst) / throttRate
}

/** HP the projectiles deliver BY time `t` — the inverse of projectileKillSeconds, two-phase
 *  (full-mana until it stalls, then throttled). Monotonic non-decreasing in t. `sustained`
 *  collapses both phases to the mana-honest rate (see projectileKillSeconds). */
function projectileHpByTime(m: WandMetrics, f: FocusFactors, t: number, sustained = false): number {
  if (t <= 0) return 0
  const fullRate = (sustained ? m.effectiveSustainedDps : m.sustainedDps) * f.onTarget * f.reach
  const burstSeconds = sustained ? Infinity : (m.secondsUntilStall ?? Infinity)
  if (t <= burstSeconds) return fullRate * t
  const throttRate = m.effectiveSustainedDps * f.onTarget * f.reach
  return fullRate * burstSeconds + throttRate * (t - burstSeconds)
}

/**
 * Expected seconds to kill an enemy of `hp`, focused by spread/reach, with DoT a parallel
 * softener (2%/s of MAX HP, capped at the ~2%-HP floor so it can't finish) and a one-cast
 * overkill floor (a one-shot kills in `firstCastSeconds` — best possible for that enemy).
 * Monotonic non-increasing in damage. Infinity ⇒ cannot kill (e.g. a pure digger).
 *
 * `sustained` rates a LONG fight at the mana-honest rate (the boss anchor — see
 * projectileKillSeconds); the one-cast overkill floor still applies, so a TRUE one-shot nuke is
 * preserved even in sustained mode (it's a real kill, not a stored-mana burst it can't repeat).
 */
export function ttkAgainst(m: WandMetrics, hp: number, f: FocusFactors, sustained = false): number {
  // One-cast overkill floor: a single cast one-shots the enemy (best possible TTK for it).
  const focusedPerCast = m.damagePerCast * f.onTarget * f.reach
  if (focusedPerCast > 0 && focusedPerCast >= hp) return m.firstCastSeconds

  // Otherwise the kill comes from the SUSTAINED CYCLE rate, which counts the damage of EVERY
  // shot in the cycle — NOT just the first. This matters when the first cast is a 0-damage
  // utility shot (e.g. a Luminous Drill / digging beam fired before the damage spells): the
  // wand still deals real damage on its later casts, so it must NOT read as Infinity just
  // because damagePerCast (the first shot) is 0. projectileKillSeconds returns Infinity iff the
  // wand deals NO cycle damage at all (sustainedDps == 0) — the genuine "can't kill" case.
  const noDot = projectileKillSeconds(m, f, hp, sustained)
  const dotRate = dotTypeCount(m.appliesDot) * DOT_RATE_PER_SEC * hp // HP/s the stains tick
  if (dotRate <= 0 || !Number.isFinite(noDot)) return Math.max(noDot, m.firstCastSeconds)

  // Projectiles + DoT deliver in PARALLEL from t=0; DoT is capped at the stain floor.
  // delivered(t) = projectileHpByTime(t) + min(dotCap, dotRate·t) is monotonic, and DoT only
  // SPEEDS the kill, so the no-DoT time is an upper bound. Bisect for delivered(t)=hp — robust
  // and exact-to-tolerance (the old fixed-point iteration oscillated for dotRate ≥ projRate,
  // returning a parity-dependent, far-too-pessimistic value).
  const dotCap = (1 - DOT_FLOOR_FRACTION) * hp
  const delivered = (t: number) => projectileHpByTime(m, f, t, sustained) + Math.min(dotCap, dotRate * t)
  let lo = 0
  let hi = noDot
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (delivered(mid) >= hp) hi = mid
    else lo = mid
  }
  return Math.max(hi, m.firstCastSeconds)
}

/** Convenience: TTK vs a named reference enemy. */
export function ttkVs(m: WandMetrics, enemy: keyof typeof REFERENCE_ENEMIES, f: FocusFactors): number {
  return ttkAgainst(m, REFERENCE_ENEMIES[enemy].hp, f)
}

/**
 * Seconds to clear a swarm of `count` weak mobs. One cast clears `coverage` mobs =
 * explosion-radius mobs + penetrating-projectile mobs (each gated by per-hit lethality vs
 * the weak mob), with a single direct hit clearing ≤1 mob/cast. Spread/range don't gate
 * AOE (§5.3). ceil(count/coverage) casts × cadence, floored at the first cast.
 */
export function aoeClearSeconds(m: WandMetrics, count: number = REFERENCE_SWARM): number {
  const mobHP = REFERENCE_ENEMIES.weakMob.hp
  // An explosion clears a 2D AREA — mobs in a cluster within its radius ≈ (radius/spacing)²
  // (a 60px bomb engulfs a whole pack; a 7px grenade barely more than its direct target).
  const explosionMobs =
    m.maxExplosionDamage >= mobHP ? Math.min(REFERENCE_SWARM, (m.maxExplosionRadius / MOB_SPACING_PX) ** 2) : 0
  // Penetration is a LINE through bodies — linear in path length, not area.
  const pierceMobs =
    m.pierceHitHP >= mobHP ? Math.min(REFERENCE_SWARM, m.pierceReachPx / MOB_SPACING_PX) : 0
  // MULTIPLE projectiles spread across a cluster (a multicast / shotgun hits several mobs at
  // once). A SINGLE projectile is single-target — it contributes NO AOE (clearing a swarm
  // one-by-one is the SPAM/DAMAGE job, not crowd-clear), so AOE comes only from area
  // (explosion), a penetrating line, or genuine multi-projectile spread.
  const perProjectileHP = m.projectilesPerCast > 0 ? m.damagePerCast / m.projectilesPerCast : 0
  const spreadMobs =
    m.projectilesPerCast > 1 ? Math.min(REFERENCE_SWARM, m.projectilesPerCast * Math.min(1, perProjectileHP / mobHP)) : 0
  const coverage = explosionMobs + pierceMobs + spreadMobs
  if (coverage <= 0) return Infinity
  const casts = Math.ceil(count / coverage)
  // Clearing the swarm in front of you = the first cast now, then a cycle per extra cast.
  return m.firstCastSeconds + (casts - 1) * m.cycleSeconds
}

/** Sustainable weak-mobs killed per second — the SPAM scalar. This is a KILL-rate, not raw
 *  DPS: a non-piercing projectile kills ONE mob per hit and despawns, so damage beyond the
 *  mob's HP is WASTED on a swarm (two one-shotters out-clear one overkill shot at equal cast
 *  speed). Cap each projectile's useful damage at mob HP, then keep the mana-honest
 *  (`effectiveSustainedDps` self-throttles) + reach gating. Grounded in the rapid-fire guide. */
export function spamKillRate(m: WandMetrics): number {
  const mobHP = REFERENCE_ENEMIES.weakMob.hp
  const perProjectile = m.projectilesPerCycle > 0 ? m.damagePerCycle / m.projectilesPerCycle : 0
  const overkillFactor = perProjectile > mobHP ? mobHP / perProjectile : 1 // 1 when nothing overkills
  return (m.effectiveSustainedDps * overkillFactor * m.reachUsability) / mobHP
}

// --- score mapping: scalar → 0–100, aligned to tierForScore (≥80 S, 60 A, 40 B, 20 C) ----

/** Piecewise-linear over (x, score) anchors sorted by ascending x, clamped at the ends. */
function interp(x: number, anchors: readonly (readonly [number, number])[]): number {
  if (x <= anchors[0][0]) return anchors[0][1]
  const last = anchors[anchors.length - 1]
  if (x >= last[0]) return last[1]
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i]
    if (x <= x1) {
      const [x0, y0] = anchors[i - 1]
      const frac = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
      return y0 + frac * (y1 - y0)
    }
  }
  return last[1]
}

/** TTK thresholds (seconds) at the S/A/B/C boundaries — lower is better. */
export interface TtkBands {
  S: number
  A: number
  B: number
  C: number
}
/** Scalar thresholds at C/B/A/S — higher is better. */
export interface ScalarBands {
  C: number
  B: number
  A: number
  S: number
}

/** Map a TTK (seconds, lower better) onto 0–100. Infinity ⇒ 0. */
export function scoreFromTtk(ttk: number, b: TtkBands): number {
  if (!Number.isFinite(ttk)) return 0
  return interp(ttk, [
    [0, 100],
    [b.S, 80],
    [b.A, 60],
    [b.B, 40],
    [b.C, 20],
    [b.C * 2, 0],
  ])
}

/** Map a scalar (higher better) onto 0–100. */
export function scoreFromScalar(x: number, b: ScalarBands): number {
  return interp(x, [
    [0, 0],
    [b.C, 20],
    [b.B, 40],
    [b.A, 60],
    [b.S, 80],
    [b.S * 1.5, 100],
  ])
}

// PROVISIONAL band cutoffs (§5.6 — method fixed, numbers tuned by the meta-expert at S6).
// Grounded in "to avoid being overwhelmed you must kill enemy X every ≤ t seconds".
/** vs Isohiisi (150) — the mid bruiser; most strong wands beat the C band easily. */
export const DAMAGE_BANDS_MID: TtkBands = { S: 0.6, A: 1.5, B: 3.5, C: 8 }
/** vs Ylialkemisti (1000) — the boss sponge; where top-end damage discriminates. S at
 *  1.5s ≈ 670 sustained DPS, so a mid-game ~300-DPS wand lands A/B here (not S) — the
 *  boss anchor is what keeps 300 and 2000 DPS from both reading S. */
export const DAMAGE_BANDS_BOSS: TtkBands = { S: 1.5, A: 4, B: 10, C: 25 }
/** clear a swarm of weak mobs. */
export const AOE_BANDS: TtkBands = { S: 1, A: 3, B: 7, C: 15 }
/** sustainable weak-mobs/sec (rapid-fire guide: a strong early spammer kills many/sec). */
export const SPAM_RATE_BANDS: ScalarBands = { C: 1, B: 3, A: 6, S: 12 }
