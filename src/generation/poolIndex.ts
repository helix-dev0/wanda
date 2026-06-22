// M5 — index the generation pool ONCE per request. Templates and the polish-pool
// trim read these buckets instead of re-scanning the pool per template. Grouping
// uses the M4 feature tagger (spellFeatures, which folds the DRAW_MANY→MULTICAST
// type derivation) plus the spell DB `type` for the projectile/modifier split.

import { spellFeatures } from '../analysis/features/spellFeatures'
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
