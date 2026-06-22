// Per-projectile base stats — the damage numbers the vendored cast engine does
// NOT carry. The table itself is build-time-generated from the game's projectile
// XMLs (see ./projectileStats.generated.ts + ./README.md); this module owns the
// type and the lookup the metrics layer uses.

import { projectileStatsTable } from './projectileStats.generated'

export interface ProjectileStats {
  /** Direct projectile damage in the game's internal unit (1.0 = 25 HP). */
  damage: number
  /** <config_explosion> damage (internal unit); 0 when the projectile has no explosion. */
  explosionDamage: number
  /** <config_explosion> explosion_radius (px); 0 when none. */
  explosionRadius: number
  /** Lifetime in frames; -1 = endless. */
  lifetime: number
  speedMin: number
  speedMax: number
  bouncesLeft: number
  /** Typed-damage split (e.g. { fire: 0.5 }), in the same 1.0 = 25 HP unit. Absent when untyped. */
  damageByType?: Record<string, number>
}

/** Internal-damage → HP conversion (Noita: a projectile `damage` of 1.0 deals 25 HP). */
export const DAMAGE_UNIT_HP = 25

/** Look up base stats for an engine projectile entity path, or undefined if unknown (e.g. modded). */
export function getProjectileStats(entity: string): ProjectileStats | undefined {
  return projectileStatsTable[entity]
}

export { projectileStatsTable }
