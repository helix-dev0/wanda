import * as v from 'valibot'

/**
 * Snapshot schema — the mod → app data contract (spec §4.1).
 *
 * The mod emits this on change. The app validates every snapshot at the
 * ingestion boundary (M2-T1) before it reaches the store. This module is the
 * single source of truth for the snapshot shape + its inferred TS types.
 *
 * Source-grounding notes (verified against real source, not recalled):
 *  - Wand stat keys are EZWand's public camelCase property names
 *    (TheHorscht/EZWand `EZWand.lua` `wand_props`, README §"Properties"):
 *    shuffle, spellsPerCast, castDelay, rechargeTime, manaMax, mana,
 *    manaChargeSpeed, capacity, spread, speedMultiplier. The mod reads these
 *    via `wand:GetProperties()`.
 *  - `spread` CAN be negative (EZWand README: "Number like -13.2") — not bounded ≥ 0.
 *  - `capacity` is EZWand's UI-visible capacity (always-cast spells are
 *    subtracted; raw `gun_config.deck_capacity` is larger). Documented, not
 *    re-derived here.
 *  - `castDelay` / `rechargeTime` are in FRAMES (60 = 1.0s).
 *  - `spells[]` uses `null` for empty deck slots; EZWand `GetSpells()` returns a
 *    dense array, so the mod reconstructs the nulls from inventory_x vs capacity.
 *
 * This refines the spec's *illustrative* §4.1 JSON per docs/plan.md M0-T2:
 * `player.perks[]` and `spell_inventory[]` are structured objects (carrying
 * stack/uses counts), not bare string arrays. Real captured fixtures are the
 * final source of truth and reconcile this schema at M0-T5.
 */

/** An acquired perk and how many times it has been stacked this run.
 *  `stacks` = the `PERK_PICKED_<id>_PICKUP_COUNT` Globals value (perk.lua). */
export const PerkRefSchema = v.object({
  id: v.string(), // bare perk id, e.g. "PROTECTION_FIRE" (perk_list.lua)
  stacks: v.number(),
})
export type PerkRef = v.InferOutput<typeof PerkRefSchema>

/** Wand stats — EZWand public property names (camelCase). All required. */
export const WandStatsSchema = v.object({
  shuffle: v.boolean(),
  spellsPerCast: v.number(),
  castDelay: v.number(), // frames
  rechargeTime: v.number(), // frames
  manaMax: v.number(),
  mana: v.number(),
  manaChargeSpeed: v.number(),
  capacity: v.number(), // UI-visible capacity (always-casts subtracted)
  spread: v.number(), // degrees; may be negative
  speedMultiplier: v.number(),
})
export type WandStats = v.InferOutput<typeof WandStatsSchema>

/** A single wand: its slot, stats, always-cast spells, and ordered deck. */
export const WandSchema = v.object({
  slot: v.number(), // inventory position; 0 = active/held
  stats: WandStatsSchema,
  always_cast: v.array(v.string()), // action_ids that fire with every shot
  spells: v.array(v.nullable(v.string())), // ordered deck; null = empty slot
})
export type Wand = v.InferOutput<typeof WandSchema>

/** A loose spell card in the player's bag. `uses_remaining` null = unlimited. */
export const SpellInventoryEntrySchema = v.object({
  action_id: v.string(),
  uses_remaining: v.nullable(v.number()),
})
export type SpellInventoryEntry = v.InferOutput<typeof SpellInventoryEntrySchema>

/** Items the player can act on right now (additive world-scan slice, M1-T6).
 *  Optional — the thin core mod omits it until that slice ships. */
export const WorldSeenSchema = v.object({
  shop_spells: v.array(v.string()), // spell action_ids on sale
  pedestal_wands: v.array(WandSchema), // wands offered on pedestals
  perk_offerings: v.array(v.string()), // perk ids on offer in the Holy Mountain
})
export type WorldSeen = v.InferOutput<typeof WorldSeenSchema>

/** Top-level snapshot. `run_id` change ⇒ the app resets the run ledger. */
export const SnapshotSchema = v.object({
  schema: v.literal(1), // contract version; bump on a breaking change
  run_id: v.string(),
  timestamp: v.number(), // game frame counter (GameGetFrameNum)
  player: v.object({
    perks: v.array(PerkRefSchema),
  }),
  wands: v.array(WandSchema),
  spell_inventory: v.array(SpellInventoryEntrySchema),
  world_seen: v.optional(WorldSeenSchema),
})
export type Snapshot = v.InferOutput<typeof SnapshotSchema>

/** Parse + validate untrusted data into a typed Snapshot. Throws ValiError on
 *  invalid input. Use `v.safeParse(SnapshotSchema, data)` at the ingestion
 *  boundary to surface field-level errors without throwing. */
export function parseSnapshot(data: unknown): Snapshot {
  return v.parse(SnapshotSchema, data)
}
