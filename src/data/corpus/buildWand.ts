// Turn a corpus build's spell-ID list into a Wand the sim can run. This is the
// "direct import" the spec describes: our IDs ARE the salinecitrine/wiki share IDs,
// so a build is just {spellIds, alwaysCast, stats} → Wand. Modeled on the
// `metricsForDeck` helper in src/sim/metrics.test.ts.

import type { Wand } from '../../schema/snapshot'
import type { CorpusBuild } from './builds'

export function buildWandFromSpellIds(b: CorpusBuild): Wand {
  return {
    slot: 0,
    active: true,
    always_cast: b.alwaysCast,
    spells: b.spellIds,
    stats: b.stats,
  }
}
