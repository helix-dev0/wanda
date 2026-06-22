// M5 generation search budget — the bounds that keep template-seeded generation
// interactive (spec §6.4: "heuristics + templates + local search, NEVER brute
// force"). These are TUNING KNOBS, provisional and uncalibrated like the M4 REF
// constants in archetypes.ts — they bound the work, they are not measured optima.

/** How many builds to surface per archetype (top pick + a couple of alternates). */
export const BUILDS_PER_ARCHETYPE = 3

/** Greedy polish hill-climb: max improving steps applied to one seed deck. */
export const MAX_ROUNDS = 3

/** Hard ceiling on total candidate sims per generate() request (all seeds × all
 *  rounds). The safety valve against a pathologically large pool (e.g. the full-DB
 *  theorycraft mode); when tripped, generation returns its best-so-far. */
export const MAX_CANDIDATES = 1500

/** Minimum target-archetype score gain (points, 0–100) worth taking a polish step
 *  for. Scores are integer-rounded, so sub-point "gains" are noise. */
export const IMPROVE_EPS = 1

/** Cap on the per-archetype polish pool drawn from a large source pool. Depth-1
 *  neighborhood is O(capacity × |pool|), so the full ~422-spell DB is trimmed to
 *  the top-K most relevant spells (by feature) for the target archetype before
 *  polishing — keeps theorycraft builds useful instead of cap-truncated. */
export const POLISH_POOL_MAX = 60
