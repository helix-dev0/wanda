// M4 — curated perk → effects (immunities the self-danger model neutralizes with).
//
// Perk effects are NOT declarative in the game dump — they live in imperative
// Lua (perk.lua). The perk-DB schema anticipated this: it defines PerkEffects
// ({ immunities, modifiers }) + the PERK_IMMUNITY enum as an app-computed field
// and DEFERS the id→semantics map to "M3/M4" (src/schema/perk-db.ts). This is
// that map. Every perk id is a real perk_list.lua id (the PROTECTION_* family is
// verified present in the bundled perk DB).
//
// VALIDATION CAVEAT: `runStore.perks` is empty in every current fixture (perk
// read is deferred to M1), so this map and its self-danger interaction are
// unit-tested with SYNTHETIC PerkRef inputs ONLY — never validated end-to-end
// against a real perk-bearing capture yet.

import type { PerkRef } from '../../schema/snapshot'
import type { PerkEffects, PerkImmunity } from '../../schema/perk-db'

/** Hand-authored id → PerkEffects, populating the schema's existing shape. */
export const PERK_EFFECTS: Record<string, PerkEffects> = {
  PROTECTION_FIRE: { immunities: ['FIRE'], modifiers: {} },
  PROTECTION_EXPLOSION: { immunities: ['EXPLOSION'], modifiers: {} },
  // In-game `damage_radioactive` localizes to "toxic"; this perk covers both.
  PROTECTION_RADIOACTIVITY: { immunities: ['TOXIC', 'RADIOACTIVE'], modifiers: {} },
  PROTECTION_MELEE: { immunities: ['MELEE'], modifiers: {} },
  PROTECTION_ELECTRICITY: { immunities: ['ELECTRICITY'], modifiers: {} },
}

export function perkEffects(id: string): PerkEffects | undefined {
  return PERK_EFFECTS[id]
}

/** Union of damage-type immunities granted by a set of held perks. */
export function activeImmunities(perks: readonly PerkRef[]): Set<PerkImmunity> {
  const out = new Set<PerkImmunity>()
  for (const p of perks) {
    for (const imm of PERK_EFFECTS[p.id]?.immunities ?? []) out.add(imm)
  }
  return out
}

/** Reverse lookup for "fixable by perk X": perk ids that grant a given immunity. */
export function perksGrantingImmunity(imm: PerkImmunity): string[] {
  return Object.entries(PERK_EFFECTS)
    .filter(([, e]) => e.immunities.includes(imm))
    .map(([id]) => id)
}

/** Perks that remove the player's OWN projectiles before they return (repel/eat)
 *  — they neutralize self-projectile hazards (an explosion/fire payload that
 *  would otherwise detonate in your face). The spec's "pick Projectile Repulsion
 *  to make this build safe" case. Verified present: the REPULSION/EATER family. */
export const SELF_PROJECTILE_NEUTRALIZERS: ReadonlySet<string> = new Set([
  'PROJECTILE_REPULSION',
  'PROJECTILE_REPULSION_SECTOR',
  'PROJECTILE_EATER_SECTOR',
])

export function hasSelfProjectileNeutralizer(perks: readonly PerkRef[]): boolean {
  return perks.some((p) => SELF_PROJECTILE_NEUTRALIZERS.has(p.id))
}
