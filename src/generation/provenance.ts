// M5 provenance JOIN — turns the run ledger's per-spell origin into the "go grab
// X" label Prescribe shows. This is the CONSUMPTION side (presentation), run on the
// main thread against the latest ledger; the PRODUCTION side (accumulating origin +
// freshness) lives in src/store/runStore.ts. Pure + node-testable.

import type { ItemOrigin, ProvenanceEntry } from '../store/runStore'

/** A build spell's "where to get it" tag, with a coarse kind for color-coded chips. */
export interface ProvenanceLabel {
  /** Human tag, e.g. "your bag" / "shop" / "seen earlier". (UI adds any chrome.) */
  text: string
  kind: ItemOrigin | 'stale' | 'unknown'
}

/** Label shown for a spell that is on screen now, by where it currently is. */
const FRESH_TEXT: Record<ItemOrigin, string> = {
  owned: 'your bag',
  shop: 'shop',
  pedestal: 'pedestal',
  holy_mountain: 'holy mountain',
}

/**
 * Where to grab one build spell, reflecting the LATEST snapshot's freshness:
 * - in the pool and on screen now → its current origin ("your bag" / "shop" / …)
 * - in the pool but not on screen → "seen earlier" (you passed it this run)
 * - not in the pool at all        → "theorycraft" (full-DB mode; you don't have it)
 */
export function labelForSpell(
  id: string,
  provenance: ReadonlyMap<string, ProvenanceEntry>,
): ProvenanceLabel {
  const e = provenance.get(id)
  if (!e) return { text: 'theorycraft', kind: 'unknown' }
  if (!e.fresh) return { text: 'seen earlier', kind: 'stale' }
  return { text: FRESH_TEXT[e.origin], kind: e.origin }
}

/** Per-slot provenance labels for a build's deck (empty slots → null). */
export function buildProvenance(
  spells: readonly (string | null)[],
  provenance: ReadonlyMap<string, ProvenanceEntry>,
): (ProvenanceLabel | null)[] {
  return spells.map((id) => (id === null ? null : labelForSpell(id, provenance)))
}
