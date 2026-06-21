import * as v from 'valibot'

/**
 * Perk-DB schema — the perk database the mod dumps once from the running game's
 * own `data/scripts/perks/perk_list.lua` (global `perk_list`). (spec §4.3)
 *
 * Source-grounding (verified against real perk_list.lua + perk.lua,
 * NathanSnail/noitadata, two byte-identical mirrors agree — NOT recalled):
 *  - Real top-level keys are `id`, `ui_name`, `ui_description`, `ui_icon`,
 *    `perk_icon`, `stackable` (a BOOLEAN: STACKABLE_YES/NO), `stackable_maximum`,
 *    `stackable_is_rare`, `stackable_how_often_reappears`, `max_in_perk_pool`,
 *    `usable_by_enemies`, `game_effect`/`game_effect2`, `not_in_default_perk_pool`,
 *    plus rarer keys. (The spec's illustrative §4.3 names like `max_in_pool` /
 *    `not_default` do NOT exist — corrected here to the real keys.)
 *  - The fire-immunity perk id is `PROTECTION_FIRE` (there is no FIRE_IMMUNITY),
 *    and it has no `func` — its effect rides on `game_effect = "PROTECTION_FIRE"`.
 *  - Perk EFFECTS ARE NOT DECLARATIVE DATA. They live in imperative `func`
 *    bodies / named GameEffects / script hooks, none representable as JSON. So
 *    the DUMP has no effects; the app computes a derived `effects` block by
 *    mapping id → semantics (M3/M4). It is modelled here as an OPTIONAL,
 *    app-populated field so a raw dump still parses while the immunity enum is
 *    enforced whenever effects is present.
 *  - Acquired-perk state is recovered at runtime, not from this DB: run flag
 *    `PERK_PICKED_<id>` + Globals `PERK_PICKED_<id>_PICKUP_COUNT` (perk.lua).
 *
 * Lenient object (unknown keys ignored) tolerates the many rare raw-dump fields
 * and modded perks; real fixtures reconcile this schema at M0-T5.
 */

/**
 * Damage/hazard types a perk can grant immunity to. PROVISIONAL set — the spec
 * defers exact immunity fields to M3/M4 ("confirmed against the real
 * perk_list.lua / damage types, flagged not assumed"). Reconcile against the
 * PROTECTION_* perks + DamageModelComponent damage types then.
 */
export const PERK_IMMUNITY = [
  'FIRE',
  'TOXIC',
  'EXPLOSION',
  'ELECTRICITY',
  'MELEE',
  'RADIOACTIVE',
  'FREEZE',
] as const
export const PerkImmunitySchema = v.picklist(PERK_IMMUNITY)
export type PerkImmunity = v.InferOutput<typeof PerkImmunitySchema>

/** App-computed (NOT dumped) effect summary the scorer/self-danger model uses. */
export const PerkEffectsSchema = v.object({
  immunities: v.array(PerkImmunitySchema),
  modifiers: v.record(v.string(), v.number()),
})
export type PerkEffects = v.InferOutput<typeof PerkEffectsSchema>

/** One dumped perk. Only `id`, `ui_name`, `ui_description` are required
 *  (universal across all 157 vanilla perks); the rest are optional. */
export const PerkDbEntrySchema = v.object({
  id: v.string(), // bare uppercase id, e.g. "PROTECTION_FIRE"
  ui_name: v.string(), // loc key "$perk_…"
  ui_description: v.string(), // loc key "$perkdesc_…"
  ui_icon: v.optional(v.string()),
  perk_icon: v.optional(v.string()),
  stackable: v.optional(v.boolean()),
  stackable_maximum: v.optional(v.number()),
  stackable_is_rare: v.optional(v.boolean()),
  stackable_how_often_reappears: v.optional(v.number()),
  max_in_perk_pool: v.optional(v.number()),
  usable_by_enemies: v.optional(v.boolean()),
  game_effect: v.optional(v.string()),
  game_effect2: v.optional(v.string()),
  not_in_default_perk_pool: v.optional(v.boolean()),
  // app-computed (not in the game dump); enforces the immunity enum when present
  effects: v.optional(PerkEffectsSchema),
})
export type PerkDbEntry = v.InferOutput<typeof PerkDbEntrySchema>

/** The dumped perk DB is a bare list of entries (mirrors the Lua `perk_list`). */
export const PerkDbSchema = v.array(PerkDbEntrySchema)
export type PerkDb = v.InferOutput<typeof PerkDbSchema>

/** Parse + validate an untrusted perk-DB dump. Throws ValiError on invalid. */
export function parsePerkDb(data: unknown): PerkDb {
  return v.parse(PerkDbSchema, data)
}
