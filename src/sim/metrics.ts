// M3-T3b — derive interpretable metrics from a cast result.
//
// Everything here is computed from clickWand's output (WandShot[] + reloadTime)
// joined with the wand's snapshot stats and the projectile base-stats table.
// Damage is honestly APPROXIMATE: raw HP, neutral resistances, single-hit
// (triggers/pierce/bounce not multiplied), crit excluded (the engine's
// GunActionState carries no real crit multiplier — default is 0.0). See plan.

import type { WandShot } from '../engine/eval/types'
import type { WandStats } from '../schema/snapshot'
import { framesToSeconds } from '../ui/format'
import { getProjectileStats, DAMAGE_UNIT_HP } from './data/projectileStats'

export interface WandMetrics {
  /** Shots fired before the deck reloads (lower bound when `truncated`). */
  shotsUntilReload: number
  /** Frames for one full fire-until-reload cycle (firing + reload). */
  cycleFrames: number
  cycleSeconds: number
  /** Firing portion only (excludes reload), seconds. */
  fireSeconds: number

  /** Top-level projectiles from the first cast (one click). */
  projectilesPerCast: number
  projectilesPerCycle: number
  projectilesPerSecond: number

  /** Expected HP from one click (raw, single-hit, no crit). */
  damagePerCast: number
  /** Expected HP across one full cycle. */
  damagePerCycle: number
  /** HP/sec including reload (and, if mana-limited, eventually stalls). */
  sustainedDps: number
  /** HP/sec while actively firing, excluding reload. */
  burstDps: number

  manaPerCycle: number
  manaSustainable: boolean
  /** Seconds of continuous fire before mana stalls; null = sustainable forever. */
  secondsUntilStall: number | null

  /** Wand base spread + the cast's accumulated spread (degrees; may be negative). */
  effectiveSpread: number
  /** Largest explosion radius produced in the cycle (px); 0 if none. */
  maxExplosionRadius: number
  /** Largest explosion DAMAGE produced in the cycle (HP); 0 if none. Separates a
   *  lethal blast from a harmless digging explosion (same radius, no damage). */
  maxExplosionDamage: number

  /** Engine hit its 10-iteration cap — cycle figures are a truncated lower bound. */
  truncated: boolean
  /** A fired projectile was absent from the stats table (modded) — damage understated. */
  damageApproximate: boolean
}

// Per-shot frame delay. clickWand seeds each shot's fire_rate_wait WITH castDelay
// (clickWand.ts:233), then actions mutate it; so castState.fire_rate_wait is the
// COMPLETE per-shot delay — do NOT add castDelay again. The engine doesn't floor
// it, so a heavily-negative wand is clamped to 0 here.
function perShotFrames(shot: WandShot, stats: WandStats): number {
  return Math.max(0, shot.castState?.fire_rate_wait ?? stats.castDelay)
}

/** Max trigger/timer nesting we descend. Real chains are shallow; this only guards a
 *  pathological deep tree (the engine builds fresh WandShots, so there is no cycle). */
const TRIGGER_DEPTH_CAP = 16

/** Expected damage multiplier from accumulated crit chance — the multiplicative
 *  stacking the meta is built on. Noita's formula (noita.wiki.gg/wiki/Critical_hit):
 *  TotalDamage = Base × (1 + min(c,1)·(5·max(1,c) − 1)), c = critChance fraction. So
 *  0% → ×1 (no change, goldens safe), 25% → ×2, 100% → ×5, 200% → ×10. Crit chance is
 *  populated by real actions (crit spells / triggers add it); the ×5 is the game
 *  constant, not stored in the action state. Applies to direct projectile damage. */
function critMultiplier(critChancePercent: number): number {
  const c = Math.max(0, critChancePercent) / 100
  return 1 + Math.min(c, 1) * (5 * Math.max(1, c) - 1)
}

// Expected HP of one shot INCLUDING its trigger payloads: every top-level projectile
// gets the shot's accumulated damage_*_add (1.0 = 25 HP), plus its explosion when it
// explodes; and a TRIGGER projectile recursively adds the damage its payload delivers
// on impact (the payload is its own WandShot with its own castState). This is "damage
// per cast assuming the trigger connects" — optimistic, like the single-hit model
// elsewhere. Without the recursion the entire trigger meta reads as ~0 damage.
function shotDamage(shot: WandShot, onMissing: () => void, depth = 0): number {
  const projAdd = shot.castState?.damage_projectile_add ?? 0
  const explAdd = shot.castState?.damage_explosion_add ?? 0
  // Crit is a shot-level stat (accumulated from this shot's draws), so it multiplies
  // every projectile in the shot; a trigger payload's own crit applies in its recursion.
  const critMul = critMultiplier(shot.castState?.damage_critical_chance ?? 0)
  let hp = 0
  for (const p of shot.projectiles) {
    const st = getProjectileStats(p.entity)
    if (st) {
      hp += Math.max(0, st.damage + projAdd) * DAMAGE_UNIT_HP * critMul
      if (st.explosionDamage > 0 || explAdd > 0) {
        hp += Math.max(0, st.explosionDamage + explAdd) * DAMAGE_UNIT_HP
      }
    } else {
      onMissing() // modded base — damage understated, but still descend its payload
    }
    if (p.trigger && depth < TRIGGER_DEPTH_CAP) {
      hp += shotDamage(p.trigger, onMissing, depth + 1)
    }
  }
  return hp
}

export function computeMetrics(
  shots: WandShot[],
  reloadTime: number | undefined,
  stats: WandStats,
  hitIterationLimit: boolean,
): WandMetrics {
  // --- timing ---
  const fireFrames = shots.reduce((sum, s) => sum + perShotFrames(s, stats), 0)
  const cycleFrames = fireFrames + (reloadTime ?? 0)
  const cycleSeconds = framesToSeconds(cycleFrames)
  const fireSeconds = framesToSeconds(fireFrames)

  // --- throughput ---
  const projectilesPerCast = shots[0]?.projectiles.length ?? 0
  const projectilesPerCycle = shots.reduce((n, s) => n + s.projectiles.length, 0)
  const projectilesPerSecond = cycleSeconds > 0 ? projectilesPerCycle / cycleSeconds : 0

  // --- damage / DPS ---
  let damageApproximate = false
  const onMissing = () => {
    damageApproximate = true
  }
  const damagePerCast = shots[0] ? shotDamage(shots[0], onMissing) : 0
  const damagePerCycle = shots.reduce((hp, s) => hp + shotDamage(s, onMissing), 0)
  const sustainedDps = cycleSeconds > 0 ? damagePerCycle / cycleSeconds : 0
  const burstDps = fireSeconds > 0 ? damagePerCycle / fireSeconds : 0

  // --- mana sustainability ---
  const manaPerCycle = shots.reduce((m, s) => m + (s.manaDrain ?? 0), 0)
  const regenPerCycle = stats.manaChargeSpeed * cycleSeconds
  const manaSustainable = manaPerCycle <= regenPerCycle
  let secondsUntilStall: number | null = null
  if (!manaSustainable && cycleSeconds > 0) {
    const netDrainPerSecond = (manaPerCycle - regenPerCycle) / cycleSeconds
    // Starts from the CURRENT pool (stats.mana) — answers "from now", so a
    // partially-depleted wand reports a shorter stall than its steady state.
    secondsUntilStall = stats.mana / netDrainPerSecond
  }

  // --- spread / AoE ---
  const effectiveSpread = stats.spread + (shots[0]?.castState?.spread_degrees ?? 0)
  // Largest blast the wand makes — RADIUS and DAMAGE — descending trigger payloads
  // (a trigger→bomb's explosion lives in the payload, invisible at top level). Radius
  // = a projectile's intrinsic radius + the shot's modifier delta; damage likewise.
  // Tracking damage separately lets AoE scoring reward a lethal blast over a harmless
  // digging explosion (same radius, 0 damage).
  let maxExplosionRadius = 0
  let maxExplosionDamage = 0
  const scanExplosions = (shot: WandShot, depth: number): void => {
    const radiusAdd = shot.castState?.explosion_radius ?? 0
    const explAdd = shot.castState?.damage_explosion_add ?? 0
    for (const p of shot.projectiles) {
      const st = getProjectileStats(p.entity)
      const r = (st?.explosionRadius ?? 0) + radiusAdd
      if (r > maxExplosionRadius) maxExplosionRadius = r
      const baseExpl = st?.explosionDamage ?? 0
      const dHp = (baseExpl > 0 || explAdd > 0 ? Math.max(0, baseExpl + explAdd) : 0) * DAMAGE_UNIT_HP
      if (dHp > maxExplosionDamage) maxExplosionDamage = dHp
      if (p.trigger && depth < TRIGGER_DEPTH_CAP) scanExplosions(p.trigger, depth + 1)
    }
  }
  for (const s of shots) scanExplosions(s, 0)

  return {
    shotsUntilReload: shots.length,
    cycleFrames,
    cycleSeconds,
    fireSeconds,
    projectilesPerCast,
    projectilesPerCycle,
    projectilesPerSecond,
    damagePerCast,
    damagePerCycle,
    sustainedDps,
    burstDps,
    manaPerCycle,
    manaSustainable,
    secondsUntilStall,
    effectiveSpread,
    maxExplosionRadius,
    maxExplosionDamage,
    truncated: hitIterationLimit,
    damageApproximate,
  }
}
