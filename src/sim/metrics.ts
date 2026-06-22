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

// Expected HP of one shot: every top-level projectile gets the shot's accumulated
// damage_*_add (same 1.0 = 25 HP unit as the projectile base). Explosions are a
// separate source, counted only when the projectile actually explodes.
function shotDamage(
  shot: WandShot,
  onMissing: () => void,
): number {
  const projAdd = shot.castState?.damage_projectile_add ?? 0
  const explAdd = shot.castState?.damage_explosion_add ?? 0
  let hp = 0
  for (const p of shot.projectiles) {
    const st = getProjectileStats(p.entity)
    if (!st) {
      onMissing()
      continue
    }
    hp += Math.max(0, st.damage + projAdd) * DAMAGE_UNIT_HP
    // Count explosion damage for intrinsically-explosive projectiles AND when a
    // modifier adds explosion damage to a non-exploding base (e.g. EXPLOSIVE_
    // PROJECTILE's +damage_explosion_add). Kept symmetric with maxExplosionRadius,
    // which likewise adds the modifier delta.
    if (st.explosionDamage > 0 || explAdd > 0) {
      hp += Math.max(0, st.explosionDamage + explAdd) * DAMAGE_UNIT_HP
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
  // Largest blast the wand makes: a fired projectile's INTRINSIC explosion radius
  // (from the stats table) plus any modifier-added radius on that shot
  // (castState.explosion_radius). castState alone would miss intrinsic explosions
  // like nuke's 250 / grenade's 7. Includes non-damaging (digging) explosions.
  let maxExplosionRadius = 0
  for (const s of shots) {
    const radiusAdd = s.castState?.explosion_radius ?? 0
    for (const p of s.projectiles) {
      const r = (getProjectileStats(p.entity)?.explosionRadius ?? 0) + radiusAdd
      if (r > maxExplosionRadius) maxExplosionRadius = r
    }
  }

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
    truncated: hitIterationLimit,
    damageApproximate,
  }
}
