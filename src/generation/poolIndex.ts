// M5 — index the generation pool ONCE per request. Templates and the polish-pool
// trim read these buckets instead of re-scanning the pool per template. Grouping
// uses the M4 feature tagger (spellFeatures, which folds the DRAW_MANY→MULTICAST
// type derivation) plus the spell DB `type` for the projectile/modifier split.

import { spellFeatures, SPELL_FEATURES } from '../analysis/features/spellFeatures'
import { getSpell } from '../data/spellDb'
import { ACTION_TYPE } from '../schema/spell-db'

/** Pool spells bucketed by role. Each list preserves pool iteration order. */
export interface PoolIndex {
  /** Every pool spell (deduped, in first-seen order). */
  all: string[]
  nukes: string[]
  triggers: string[]
  multicasts: string[]
  diggers: string[]
  mobility: string[]
  defensive: string[]
  homing: string[]
  /** type PROJECTILE | STATIC_PROJECTILE — things that can be a payload/spam shot. */
  projectiles: string[]
  /** type MODIFIER — damage/spread/etc. tweaks placed before a projectile. */
  modifiers: string[]
}

/** Mana drain for sorting "cheapest" spam shots; unknown/absent → 0 (free). */
export function spellMana(id: string): number {
  return getSpell(id)?.mana ?? 0
}

/** Bucket a pool of spell ids by role in one pass. Unknown/modded ids land only
 *  in `all` (their type/features resolve empty) — never throws. */
export function buildPoolIndex(pool: Iterable<string>): PoolIndex {
  const ix: PoolIndex = {
    all: [],
    nukes: [],
    triggers: [],
    multicasts: [],
    diggers: [],
    mobility: [],
    defensive: [],
    homing: [],
    projectiles: [],
    modifiers: [],
  }
  const seen = new Set<string>()
  for (const id of pool) {
    if (seen.has(id)) continue
    seen.add(id)
    ix.all.push(id)

    const feats = spellFeatures(id)
    if (feats.includes('NUKE')) ix.nukes.push(id)
    if (feats.includes('TRIGGER')) ix.triggers.push(id)
    if (feats.includes('MULTICAST')) ix.multicasts.push(id)
    if (feats.includes('DIG')) ix.diggers.push(id)
    if (feats.includes('MOBILITY')) ix.mobility.push(id)
    if (feats.includes('DEFENSIVE')) ix.defensive.push(id)
    if (feats.includes('HOMING')) ix.homing.push(id)

    const type = getSpell(id)?.type
    if (type === ACTION_TYPE.PROJECTILE || type === ACTION_TYPE.STATIC_PROJECTILE) {
      ix.projectiles.push(id)
    } else if (type === ACTION_TYPE.MODIFIER) {
      ix.modifiers.push(id)
    }
  }
  return ix
}

/** Pool projectiles ordered cheapest-mana first (the spam/payload preference). */
export function projectilesByMana(ix: PoolIndex): string[] {
  return [...ix.projectiles].sort((a, b) => spellMana(a) - spellMana(b))
}

/** A spell is UTILITY — digging or teleport/movement — when its CURATED tags include DIG
 *  or MOBILITY. We use the hand-authored `SPELL_FEATURES` map (NOT the drill-damage entity
 *  fallback), so a real damage projectile that incidentally drills (laser, lance) is NOT
 *  treated as utility — only the deliberate diggers/teleports (Digger, Luminous Drill,
 *  Chainsaw, Black Hole, the Teleports) are. These belong in the MOBILITY/utility tab,
 *  never in a DAMAGE/SPAM/AOE build — neither as a template payload NOR as a polish swap
 *  (the scorer counts their tiny base damage, crit/multicast-inflated, and an unfiltered
 *  optimizer keeps re-adding them — the "S-tier digger build" bug). */
export function isUtilitySpell(id: string): boolean {
  const f = SPELL_FEATURES[id]
  return f != null && f.some((t) => t === 'DIG' || t === 'MOBILITY')
}

/** Pool projectiles that actually deal damage (cheapest-mana first) — diggers and
 *  teleports filtered out. The payload source for every DAMAGE/SPAM/AOE template, so a
 *  generated damage wand never wastes a slot on a 0-damage Digger (the multiplier-build
 *  bug) and digging stays a utility-tab thing. */
export function damageProjectilesByMana(ix: PoolIndex): string[] {
  return projectilesByMana(ix).filter((id) => !isUtilitySpell(id))
}
