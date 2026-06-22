// M4 — stable structural identity key for a wand.
//
// Extracted verbatim from runStore's pool-dedup signature (M2) so the analysis
// layer's sim cache (simCache.ts) and the run-ledger dedup share ONE keying
// scheme instead of drifting apart. Excludes `slot` (a wand moves between slots)
// and the volatile current `mana`; everything else is the chassis. Stat entries
// are sorted so the key is independent of the emitter's key order (the Linux
// maintainer and Windows co-player may serialize stats in different orders —
// otherwise the same wand would key differently on the two machines).

import type { Wand } from '../schema/snapshot'

/** Stable identity key for a wand (chassis + loadout; ignores slot + current mana). */
export function wandKey(w: Wand): string {
  const stableStats = Object.fromEntries(
    Object.entries(w.stats)
      .filter(([k]) => k !== 'mana')
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  return JSON.stringify({ stats: stableStats, always_cast: w.always_cast, spells: w.spells })
}
