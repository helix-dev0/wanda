import { parseSpellDb, ACTION_TYPE_NAME, type SpellDbEntry } from '../schema/spell-db'

/**
 * Read-only spell-DB lookup (spec §3.2 module 3; M2).
 *
 * Loads the recorded `spell_db.json` fixture (dumped from the game's own
 * `gun_actions.lua`), validates it once via `parseSpellDb`, and indexes the
 * entries by their bare uppercase `id` for O(1) lookup. Fixture-only — no live
 * game — matching the project rule that the app runs entirely against fixtures.
 *
 * Display names are derived from the id rather than the `name` field, which is a
 * localisation key ("$action_rubber_ball") the dump does not resolve. This keeps
 * `spellDisplayName` self-contained and side-effect-free.
 */

// Vite eager glob (mirrors src/data/fixtures.test.ts) — the repo does not enable
// resolveJsonModule, so a direct `import … from './fixtures/spell_db.json'`
// would not typecheck. The glob yields the parsed JSON as the module default.
const spellDbJson = (
  import.meta.glob('./fixtures/spell_db.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>
)['./fixtures/spell_db.json']

/** Every dumped spell, indexed by its bare uppercase id (e.g. "RUBBER_BALL"). */
export const spellDb: ReadonlyMap<string, SpellDbEntry> = new Map(
  parseSpellDb(spellDbJson).map((entry) => [entry.id, entry]),
)

/** The validated spell for `id`, or `undefined` if it is not in the DB. */
export function getSpell(id: string): SpellDbEntry | undefined {
  return spellDb.get(id)
}

/**
 * Human-readable name derived purely from the id (e.g. "RUBBER_BALL" → "Rubber
 * Ball"). Self-contained: it does not consult the DB or any loc table, so it is
 * safe for any id — an unknown id simply returns its prettified form, never
 * throwing.
 */
export function spellDisplayName(id: string): string {
  return prettifyId(id)
}

/**
 * The action-type name for `id` (e.g. "PROJECTILE"), mapped from the entry's
 * numeric `type` via ACTION_TYPE_NAME, or `undefined` if the id is unknown.
 */
export function spellTypeName(id: string): string | undefined {
  const entry = spellDb.get(id)
  if (entry === undefined) return undefined
  return ACTION_TYPE_NAME[entry.type]
}

/** "RUBBER_BALL" → "Rubber Ball". Empty segments (stray underscores) dropped. */
function prettifyId(id: string): string {
  return id
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
