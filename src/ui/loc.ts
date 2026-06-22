// UI-only localization resolver — turns the spell/perk DBs' game loc keys
// ($action_… / $perk_…) into the REAL in-game name + description, using the
// vanilla translation table vendored with the engine. Imported ONLY by the
// tooltip UI, so the ~4k-entry table never reaches the engine/worker bundle.

import { translations } from '../engine/__generated__/translations'
import { getSpell, spellDisplayName, spellTypeName } from '../data/spellDb'
import { getPerk, perkDisplayName } from '../data/perkDb'

const TABLE = translations as Record<string, string>

/** Resolve a "$loc_key" (or bare key) to its translated text, or undefined. */
export function tr(locKey: string | undefined): string | undefined {
  if (!locKey) return undefined
  const key = locKey.startsWith('$') ? locKey.slice(1) : locKey
  return TABLE[key]
}

export interface TooltipData {
  /** Real in-game name, falling back to the prettified id. */
  name: string
  /** Spell action-type name (e.g. "PROJECTILE"); perks have none. */
  typeName?: string | null
  /** Stat rows (mana / uses / …). */
  meta: { label: string; value: string }[]
  /** Real in-game description, when the loc table has it. */
  description?: string
}

/** Game name + description + stats for a spell's hover tooltip. */
export function spellTooltipData(id: string): TooltipData {
  const e = getSpell(id)
  const meta: { label: string; value: string }[] = []
  if (e?.mana != null) meta.push({ label: 'Mana', value: String(e.mana) })
  if (e?.max_uses != null) meta.push({ label: 'Uses', value: String(e.max_uses) })
  return {
    name: tr(e?.name) ?? spellDisplayName(id),
    typeName: spellTypeName(id) ?? null,
    meta,
    description: tr(e?.description),
  }
}

/** Game name + description for a perk's hover tooltip. */
export function perkTooltipData(id: string): TooltipData {
  const e = getPerk(id)
  return {
    name: tr(e?.ui_name) ?? perkDisplayName(id),
    meta: [],
    description: tr(e?.ui_description),
  }
}
