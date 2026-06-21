import * as v from 'valibot'

/**
 * Spell-DB schema — the spell database the mod dumps once from the running
 * game's own `data/scripts/gun/gun_actions.lua` (global `actions`), so spell
 * stats match the player's exact game version + any spell-adding mods. A
 * vanilla snapshot is bundled only as fallback. (spec §4.2)
 *
 * Source-grounding (verified against real gun_actions.lua + gun_enums.lua,
 * vexx32/noita-data; cross-checked vs salinecitrine's generator — NOT recalled):
 *  - DEVIATION FROM THE SPEC'S ILLUSTRATIVE §4.2: a real action entry has NO
 *    declarative `projectile` / `deck_modifier` block, and `type` is a NUMERIC
 *    constant (0–7), not a string. A spell's actual effects (damage, spread,
 *    multicast draws, projectile spawns) are produced IMPERATIVELY by its
 *    `action = function() ... end` body mutating cast state — which is why the
 *    simulator is reused (M3) rather than read off this data. This schema
 *    therefore models only the serialisable METADATA the mod can dump; the
 *    `action` function is not representable as JSON and is intentionally absent.
 *  - `type` ∈ ACTION_TYPE (gun_enums.lua, kept in sync with C++ GunActionType).
 *  - "Unlimited uses" = `max_uses` ABSENT (never -1; the only -1s in source are
 *    commented out). A present `max_uses` is a positive use count.
 *  - `name`/`description` are localisation keys ("$action_…"); the app/mod may
 *    later resolve them via GameTextGet. The schema accepts either form.
 *  - `spawn_level`/`spawn_probability` are CSV strings (and may be "").
 *
 * Real captured fixtures are the final source of truth and reconcile this
 * schema at M0-T5; modded/edge spells are tolerated via looseObject (unknown
 * keys are PRESERVED on output, not dropped) plus mostly-optional fields.
 */

/** ACTION_TYPE_* constants (gun_enums.lua) — the numeric `type` values. */
export const ACTION_TYPE = {
  PROJECTILE: 0,
  STATIC_PROJECTILE: 1,
  MODIFIER: 2,
  DRAW_MANY: 3,
  MATERIAL: 4,
  OTHER: 5,
  UTILITY: 6,
  PASSIVE: 7,
} as const

/** Reverse map for display (app-side convenience; the mod dumps the number). */
export const ACTION_TYPE_NAME = {
  0: 'PROJECTILE',
  1: 'STATIC_PROJECTILE',
  2: 'MODIFIER',
  3: 'DRAW_MANY',
  4: 'MATERIAL',
  5: 'OTHER',
  6: 'UTILITY',
  7: 'PASSIVE',
} as const

const ACTION_TYPE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7] as const
export const SpellTypeSchema = v.picklist(ACTION_TYPE_VALUES)
export type SpellType = v.InferOutput<typeof SpellTypeSchema>

/** One dumped spell. Only `id`, `type`, `name` are required (universal in
 *  vanilla); everything else is optional so modded/edge entries still parse. */
export const SpellDbEntrySchema = v.looseObject({
  id: v.string(),
  type: SpellTypeSchema,
  name: v.string(), // loc key, e.g. "$action_black_hole"
  description: v.optional(v.string()),
  sprite: v.optional(v.string()),
  mana: v.optional(v.number()), // mana drain
  max_uses: v.optional(v.number()), // absent ⇒ unlimited
  spawn_level: v.optional(v.string()), // CSV, may be ""
  spawn_probability: v.optional(v.string()), // CSV
  price: v.optional(v.number()),
  // Noita stores these as [xml_path, optional_count, ...] — heterogeneous
  // string|number elements (e.g. EXPLODING_DUCKS = ["…/duck.xml", 3]). Found via
  // real fixtures at M0-T5; do not narrow back to string[].
  related_projectiles: v.optional(v.array(v.union([v.string(), v.number()]))),
  related_extra_entities: v.optional(v.array(v.union([v.string(), v.number()]))),
  custom_xml_file: v.optional(v.string()),
  spawn_requires_flag: v.optional(v.string()),
  // rare boolean flags
  never_unlimited: v.optional(v.boolean()),
  recursive: v.optional(v.boolean()),
  ai_never_uses: v.optional(v.boolean()),
  custom_uses_logic: v.optional(v.boolean()),
  is_dangerous_blast: v.optional(v.boolean()),
  spawn_manual_unlock: v.optional(v.boolean()),
})
export type SpellDbEntry = v.InferOutput<typeof SpellDbEntrySchema>

/** The dumped spell DB is a bare list of entries (mirrors the Lua `actions`). */
export const SpellDbSchema = v.array(SpellDbEntrySchema)
export type SpellDb = v.InferOutput<typeof SpellDbSchema>

/** Parse + validate an untrusted spell-DB dump. Throws ValiError on invalid. */
export function parseSpellDb(data: unknown): SpellDb {
  return v.parse(SpellDbSchema, data)
}
