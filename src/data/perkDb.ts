import { parsePerkDb, type PerkDbEntry } from '../schema/perk-db'

/**
 * Read-only perk-DB lookup (spec §3.2; M2).
 *
 * Loads the recorded `perk_db.json` fixture (dumped from the game's own
 * `perk_list.lua`), validates it once via `parsePerkDb`, and indexes the entries
 * by their bare uppercase `id` for O(1) lookup. Fixture-only — no live game.
 *
 * Display names are derived from the id rather than the `ui_name` field, which
 * is a localisation key ("$perk_critical_hit") the dump does not resolve. This
 * keeps `perkDisplayName` self-contained and side-effect-free.
 */

// Vite eager glob (mirrors src/data/fixtures.test.ts) — the repo does not enable
// resolveJsonModule, so a direct `import … from './fixtures/perk_db.json'`
// would not typecheck. The glob yields the parsed JSON as the module default.
const perkDbJson = (
  import.meta.glob('./fixtures/perk_db.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>
)['./fixtures/perk_db.json']

/** Every dumped perk, indexed by its bare uppercase id (e.g. "CRITICAL_HIT"). */
export const perkDb: ReadonlyMap<string, PerkDbEntry> = new Map(
  parsePerkDb(perkDbJson).map((entry) => [entry.id, entry]),
)

/** The validated perk for `id`, or `undefined` if it is not in the DB. */
export function getPerk(id: string): PerkDbEntry | undefined {
  return perkDb.get(id)
}

/**
 * Human-readable name derived purely from the id (e.g. "CRITICAL_HIT" →
 * "Critical Hit"). Self-contained: it does not consult the DB or any loc table,
 * so it is safe for any id — an unknown id simply returns its prettified form,
 * never throwing.
 */
export function perkDisplayName(id: string): string {
  return prettifyId(id)
}

/** Real perk icon as a data URL when the bundled DB carries sprite bytes
 *  (embedded offline from data.wak by scripts/extract-sprites.mjs; the M1 mod emits
 *  the same `sprite_base64` field live), else null → caller shows text. */
export function perkSpriteSrc(id: string): string | null {
  const b64 = (getPerk(id) as Record<string, unknown> | undefined)?.sprite_base64
  return typeof b64 === 'string' && b64.length > 0 ? `data:image/png;base64,${b64}` : null
}

/** "CRITICAL_HIT" → "Critical Hit". Empty segments (stray underscores) dropped. */
function prettifyId(id: string): string {
  return id
    .split('_')
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}
