// M4 — curated spell → feature tags.
//
// Why curated and not type-derived: the spell DB `type` enum does NOT separate
// digging/mobility/defensive from plain attacks. type=UTILITY(6) is a grab-bag
// (BLACK_HOLE and TELEPORT_CAST sit next to LIGHT_BULLET and BUBBLESHOT), DIGGER
// is type=PROJECTILE(0), LEVITATION_FIELD is type=STATIC_PROJECTILE(1). So the
// Utility/Mobility/Defensive archetypes need a hand-authored map. Only
// MULTICAST is cleanly type-derivable (DRAW_MANY=3). Every id below is verified
// present in the bundled spell DB; an entity-level fallback (drill damage) also
// catches diggers that aren't in the list (e.g. modded). Known gap: modded
// shields/mobility absent from the DB and without a known projectile won't tag.

import type { Wand } from '../../schema/snapshot'
import { getSpell } from '../../data/spellDb'
import { ACTION_TYPE } from '../../schema/spell-db'
import { getProjectileStats } from '../../sim/data/projectileStats'

export type SpellFeature =
  | 'DIG'
  | 'MOBILITY'
  | 'DEFENSIVE'
  | 'HOMING'
  | 'MULTICAST'
  | 'TRIGGER'
  | 'NUKE'

/** Hand-authored id → tags (verified against the bundled spell DB). */
export const SPELL_FEATURES: Record<string, readonly SpellFeature[]> = {
  // Digging — drills + black holes (terrain destroyers that don't self-harm).
  DIGGER: ['DIG'],
  POWERDIGGER: ['DIG'],
  LUMINOUS_DRILL: ['DIG'],
  LASER_LUMINOUS_DRILL: ['DIG'],
  CHAINSAW: ['DIG'],
  TNTBOX: ['DIG'],
  MATTER_EATER: ['DIG'],
  BLACK_HOLE: ['DIG'],
  BLACK_HOLE_BIG: ['DIG'],
  BLACK_HOLE_GIGA: ['DIG'],
  // Movement — teleports, swapper, levitation.
  TELEPORT_CAST: ['MOBILITY'],
  SUPER_TELEPORT_CAST: ['MOBILITY'],
  LONG_DISTANCE_CAST: ['MOBILITY'],
  TELEPORT_PROJECTILE: ['MOBILITY'],
  TELEPORT_PROJECTILE_STATIC: ['MOBILITY'],
  TELEPORT_PROJECTILE_SHORT: ['MOBILITY'],
  TELEPORT_PROJECTILE_CLOSER: ['MOBILITY'],
  SWAPPER_PROJECTILE: ['MOBILITY'],
  TELEPORTATION_FIELD: ['MOBILITY'],
  LEVITATION_FIELD: ['MOBILITY'],
  // Defensive — shields + protective fields.
  MAGIC_SHIELD: ['DEFENSIVE'],
  BIG_MAGIC_SHIELD: ['DEFENSIVE'],
  SHIELD_FIELD: ['DEFENSIVE'],
  BERSERK_FIELD: ['DEFENSIVE'],
  PROJECTILE_TRANSMUTATION_FIELD: ['DEFENSIVE'],
  // Tracking.
  HOMING: ['HOMING'],
  HOMING_SHORT: ['HOMING'],
  // Trigger modifiers (payload delivery; template seeds for M5).
  ADD_TRIGGER: ['TRIGGER'],
  ADD_TIMER: ['TRIGGER'],
  ADD_DEATH_TRIGGER: ['TRIGGER'],
  // Nukes (kept for M5 template detection; not used by M4 scoring).
  NUKE: ['NUKE'],
  NUKE_GIGA: ['NUKE'],
  GIGA_NUKE: ['NUKE'],
}

/** Entity-level fallback: a projectile that drills terrain is a digger even if
 *  its spell id isn't in the curated map (e.g. a modded drill). Drill damage is
 *  present in the generated projectile table (digger 0.3, powerdigger 0.1). */
export function entityFeatures(entity: string): SpellFeature[] {
  const st = getProjectileStats(entity)
  if (st && (st.damageByType?.drill ?? 0) > 0) return ['DIG']
  return []
}

/** The .xml projectile entities a spell is known to spawn (heterogeneous
 *  [path, count?] arrays in the DB — keep only the path strings). */
function relatedEntities(id: string): string[] {
  const rel = getSpell(id)?.related_projectiles ?? []
  return rel.filter((x): x is string => typeof x === 'string' && x.endsWith('.xml'))
}

/** All feature tags for one spell id: curated ∪ type-derived (multicast) ∪
 *  entity-fallback (drill). Unknown/modded ids resolve to [] (never throws). */
export function spellFeatures(id: string): SpellFeature[] {
  const set = new Set<SpellFeature>(SPELL_FEATURES[id] ?? [])
  if (getSpell(id)?.type === ACTION_TYPE.DRAW_MANY) set.add('MULTICAST')
  for (const e of relatedEntities(id)) for (const f of entityFeatures(e)) set.add(f)
  return [...set]
}

export type FeatureCounts = Record<SpellFeature, number>

const ZERO_COUNTS: FeatureCounts = {
  DIG: 0,
  MOBILITY: 0,
  DEFENSIVE: 0,
  HOMING: 0,
  MULTICAST: 0,
  TRIGGER: 0,
  NUKE: 0,
}

/** Count feature tags across a wand's deck (non-empty slots + always-cast). */
export function deckFeatureCounts(wand: Wand): FeatureCounts {
  const counts: FeatureCounts = { ...ZERO_COUNTS }
  const ids = [...wand.spells.filter((s): s is string => s !== null), ...wand.always_cast]
  for (const id of ids) for (const f of spellFeatures(id)) counts[f] += 1
  return counts
}
