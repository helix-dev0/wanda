// M5 — the generation orchestrator (spec §6.4 "escalating search", step 3):
// template SEED → bounded local-search POLISH → dedup → constraint filter → rank.
// PURE + deterministic (no Date/random; stable sort with explicit tie-breaks), so
// it is fully unit-tested and the worker (T3) is a thin wrapper.
//
// It REUSES the M4 engine wholesale: analyzeWand as the fitness function, the
// suggestEdits depth-1 neighborhood (with its self-danger veto) + applyEdit as the
// polish step, the memoized evalWand cache, and deckFeatureCounts/selfDanger for
// constraints + perk advice. Nothing here re-implements simulation or scoring.

import type { Wand, PerkRef } from '../schema/snapshot'
import { analyzeWand, ARCHETYPES, type Archetype, type WandAnalysis } from '../analysis'
import { suggestEdits, applyEdit } from '../analysis/suggestions'
import { deckFeatureCounts } from '../analysis/features/spellFeatures'
import { simCacheSize } from '../analysis/simCache'
import {
  BUILDS_PER_ARCHETYPE,
  EXHAUSTIVE_COMBO_BUDGET,
  IMPROVE_EPS,
  MAX_CANDIDATES,
  MAX_ROUNDS,
  POLISH_POOL_MAX,
} from './budget'
import { buildPoolIndex, isUtilitySpell, type PoolIndex } from './poolIndex'
import { countCombinations, enumerateDecks } from './exhaustive'
import { TEMPLATES, TEMPLATE_ORDER } from './templates'
import type {
  AppliedEdit,
  ArchetypeBuilds,
  Constraints,
  GenerateRequest,
  GenerateResult,
  GeneratedBuild,
  PerkAdvice,
} from './types'

/** Lay a seed deck onto the chassis: chassis stats + always-cast, new spells[]
 *  padded/truncated to the chassis capacity. */
function seedWand(chassis: Wand, deck: string[]): Wand {
  const spells: (string | null)[] = []
  for (let i = 0; i < chassis.stats.capacity; i++) spells[i] = deck[i] ?? null
  return { ...chassis, spells }
}

/** Trim a (possibly full-DB) pool to the spells most relevant to `archetype`, so
 *  the depth-1 neighborhood stays O(capacity × POLISH_POOL_MAX). Signature spells
 *  come first; a small pool passes through whole (just reordered). */
function trimPool(ix: PoolIndex, archetype: Archetype, max: number): Set<string> {
  const priority: Record<Archetype, string[][]> = {
    DAMAGE: [ix.nukes, ix.modifiers, ix.triggers, ix.multicasts, ix.projectiles],
    AOE: [ix.nukes, ix.multicasts, ix.modifiers, ix.projectiles],
    SPAM: [ix.projectiles, ix.multicasts, ix.modifiers],
    DIGGING: [ix.diggers, ix.modifiers, ix.projectiles],
  }
  const out = new Set<string>()
  for (const bucket of priority[archetype]) {
    for (const id of bucket) {
      if (out.size >= max) return out
      out.add(id)
    }
  }
  for (const id of ix.all) {
    if (out.size >= max) break
    out.add(id)
  }
  return out
}

/** Greedy hill-climb: take the best (highest-rank) depth-1 edit each round until
 *  none improves the target score or removes a hazard, the round cap, or the
 *  candidate cap. Target score is non-decreasing EXCEPT a step may trade score to
 *  remove a lethal hazard (the safety-first behavior); suggestEdits' veto still
 *  blocks any edit that ADDS danger. */
function polish(
  seed: Wand,
  archetype: Archetype,
  pool: ReadonlySet<string>,
  perks: readonly PerkRef[],
  budgetFrom: number,
  budgetCap: number,
  caps: ReadonlyMap<string, number> | undefined,
): { wand: Wand; edits: AppliedEdit[] } {
  let current = seed
  const edits: AppliedEdit[] = []
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (simCacheSize() - budgetFrom >= budgetCap) break
    const best = suggestEdits(current, archetype, pool, perks, caps)[0]
    if (!best) break
    if (best.deltaScore < IMPROVE_EPS && best.fixesHazard == null) break
    current = applyEdit(current, best.edit)
    edits.push({ label: best.label, deltaScore: best.deltaScore, kind: best.edit.kind })
  }
  return { wand: current, edits }
}

/** "Take Fire Immunity to unlock this" — only when the build is unsafe AND a perk
 *  would fix it (reuses the M4 self-danger report; never recomputes immunities). */
function advisePerk(analysis: WandAnalysis): PerkAdvice | undefined {
  const sd = analysis.selfDanger
  if (!sd.unsafe || sd.fixableByPerk.length === 0) return undefined
  const hazards = [...new Set(sd.findings.filter((f) => f.severity === 'danger').map((f) => f.hazard))]
  return {
    perks: sd.fixableByPerk,
    reason: `This build's ${hazards.join(' + ').toLowerCase()} would hurt you — a perk can neutralize it.`,
  }
}

/** Target-archetype score, with unsafe builds demoted far below safe ones (the
 *  same Unsafe-below-the-ladder rule the tier list uses). */
function rankKey(b: GeneratedBuild): number {
  const score = b.analysis.scores[b.archetype].score
  return b.analysis.selfDanger.unsafe ? score - 1000 : score
}

function noteFor(
  ix: PoolIndex,
  archetype: Archetype,
  constraints: Constraints,
  hadCandidates: boolean,
): string {
  if (ix.all.length === 0) return 'No spells in your pool yet.'
  if (hadCandidates && constraints.noSelfDamage) {
    return 'Every build from this pool would hurt you — pick a safety perk or relax the constraint.'
  }
  if (hadCandidates && constraints.mustDig) return 'No build keeps a digging spell.'
  if (constraints.mustDig && ix.diggers.length === 0) return 'No digging spell in your pool.'
  if (archetype === 'DAMAGE' || archetype === 'AOE') {
    if (ix.nukes.length === 0 && ix.projectiles.length === 0) {
      return 'No offensive spells in your pool to build with.'
    }
  }
  if (archetype === 'DIGGING' && ix.diggers.length === 0) {
    return 'No digging spell in your pool.'
  }
  return 'No build could be assembled from the current pool.'
}

function generateForArchetype(
  ix: PoolIndex,
  chasses: readonly Wand[],
  archetype: Archetype,
  constraints: Constraints,
  perks: readonly PerkRef[],
  caps: ReadonlyMap<string, number> | undefined,
  ideal: boolean,
): ArchetypeBuilds {
  // For damage archetypes, drop UTILITY (digging / teleport) spells from the polish
  // pool too: the scorer counts their tiny base damage (crit/multicast-inflated), so an
  // unfiltered polish keeps re-adding diggers to a "damage" build even after the template
  // seeds clean shots. Digging/teleport live in the MOBILITY (utility) tab.
  const isDamageArchetype = archetype === 'DAMAGE' || archetype === 'SPAM' || archetype === 'AOE'
  const pool0 = trimPool(ix, archetype, POLISH_POOL_MAX)
  const trimmed = isDamageArchetype ? new Set([...pool0].filter((id) => !isUtilitySpell(id))) : pool0
  // Each candidate chassis gets a FAIR share of the per-archetype budget, measured
  // from its OWN start offset — so chassis #1 can't starve #2..N. Different-capacity
  // chassis are distinct sim-cache entries (wandKey includes stats), so the delta
  // genuinely accrues across them. N=1 (theorycraft) ⇒ subCap = MAX_CANDIDATES,
  // byte-identical to the single-chassis behavior.
  const subCap = Math.ceil(MAX_CANDIDATES / Math.max(1, chasses.length))
  const byKey = new Map<string, GeneratedBuild>()
  let totalSeeds = 0

  for (const chassis of chasses) {
    const ctx = { index: ix, capacity: chassis.stats.capacity, shuffle: chassis.stats.shuffle, archetype, caps }
    const templates = TEMPLATES.filter(
      (t) => t.archetypes.includes(archetype) && !(chassis.stats.shuffle && t.orderDependent),
    )
    const seeds = templates.flatMap((t) => t.instantiate(ctx).map((deck) => ({ template: t.id, deck })))
    totalSeeds += seeds.length
    if (seeds.length === 0) continue

    // Built ONCE per chassis (same for every build on it): which owned wand to rebuild.
    const attribution = {
      slot: chassis.slot,
      capacity: chassis.stats.capacity,
      shuffle: chassis.stats.shuffle,
      ideal,
    }
    const budgetFrom = simCacheSize() // per-CHASSIS candidate budget (cache-size delta)
    for (const { template, deck } of seeds) {
      if (simCacheSize() - budgetFrom >= subCap) break
      const { wand, edits } = polish(seedWand(chassis, deck), archetype, trimmed, perks, budgetFrom, subCap, caps)
      const analysis = analyzeWand(wand, perks)
      const build: GeneratedBuild = {
        wand,
        chassis: attribution,
        archetype,
        template,
        analysis,
        edits,
        perkAdvice: advisePerk(analysis),
      }
      const prev = byKey.get(analysis.key)
      if (!prev || rankKey(build) > rankKey(prev)) byKey.set(analysis.key, build)
    }
  }

  // "No build" ONLY when no chassis could even seed (the union across chassis is empty).
  if (totalSeeds === 0) return { builds: [], note: noteFor(ix, archetype, constraints, false) }

  let builds = [...byKey.values()]
  const hadCandidates = builds.length > 0
  if (constraints.mustDig) builds = builds.filter((b) => deckFeatureCounts(b.wand).DIG > 0)
  if (constraints.noSelfDamage) builds = builds.filter((b) => !b.analysis.selfDanger.unsafe)

  builds.sort(
    (a, b) =>
      rankKey(b) - rankKey(a) ||
      a.edits.length - b.edits.length ||
      TEMPLATE_ORDER[a.template] - TEMPLATE_ORDER[b.template],
  )
  builds = builds.slice(0, BUILDS_PER_ARCHETYPE)
  return builds.length > 0 ? { builds } : { builds: [], note: noteFor(ix, archetype, constraints, hadCandidates) }
}

/** Non-null spells in a deck (build complexity, used as a tie-break — prefer the simpler). */
const deckLen = (w: Wand): number => w.spells.reduce((n, s) => (s ? n + 1 : n), 0)
const deckSig = (w: Wand): string => w.spells.filter((s): s is string => s != null).join(',')

/**
 * Exhaustive survey: enumerate EVERY cap-limited spell combination on each chassis, score
 * each once (one analyzeWand yields all archetype scores), and keep the best (highest-ranked)
 * build per (archetype, structural key). "Run all the options" — for a small owned pool this
 * is provably complete, so generation can't miss an optimum a human finds. Enablers are NOT
 * excluded; the honest scorer ranks enabler+payload high and enabler-only low. Pure +
 * deterministic. The caller gates this on countCombinations ≤ budget.
 */
function generateExhaustive(
  ix: PoolIndex,
  req: GenerateRequest,
  caps: ReadonlyMap<string, number> | undefined,
): GenerateResult {
  const byArch = {} as Record<Archetype, Map<string, GeneratedBuild>>
  for (const a of ARCHETYPES) byArch[a] = new Map()

  for (const chassis of req.chassis) {
    const decks = enumerateDecks(req.pool, caps, chassis.stats.capacity, ix, EXHAUSTIVE_COMBO_BUDGET)
    const attribution = {
      slot: chassis.slot,
      capacity: chassis.stats.capacity,
      shuffle: chassis.stats.shuffle,
      ideal: false,
    }
    for (const deck of decks) {
      const wand = seedWand(chassis, deck)
      const analysis = analyzeWand(wand, req.perks)
      // One scored deck is a candidate for EVERY archetype — keep the best per archetype.
      for (const a of ARCHETYPES) {
        const build: GeneratedBuild = {
          wand,
          chassis: attribution,
          archetype: a,
          template: 'exhaustive',
          analysis,
          edits: [],
          perkAdvice: advisePerk(analysis),
        }
        const prev = byArch[a].get(analysis.key)
        if (!prev || rankKey(build) > rankKey(prev)) byArch[a].set(analysis.key, build)
      }
    }
  }

  const result = {} as GenerateResult
  for (const a of ARCHETYPES) {
    // Drop builds that score ~0 for THIS archetype: the survey scores every deck for every
    // archetype, so an archetype with no relevant spells (e.g. DEFENSIVE from a pure-damage
    // pool) must yield a note, not a junk 0-score "build".
    let builds = [...byArch[a].values()].filter((b) => b.analysis.scores[a].score > 0)
    const hadCandidates = builds.length > 0
    if (req.constraints.mustDig) builds = builds.filter((b) => deckFeatureCounts(b.wand).DIG > 0)
    if (req.constraints.noSelfDamage) builds = builds.filter((b) => !b.analysis.selfDanger.unsafe)
    builds.sort(
      (x, y) =>
        rankKey(y) - rankKey(x) || deckLen(x.wand) - deckLen(y.wand) || deckSig(x.wand).localeCompare(deckSig(y.wand)),
    )
    result[a] =
      builds.length > 0
        ? { builds: builds.slice(0, BUILDS_PER_ARCHETYPE) }
        : { builds: [], note: noteFor(ix, a, req.constraints, hadCandidates) }
  }
  return result
}

/**
 * Generate ranked builds for each requested archetype from the pool, under the
 * chassis (capacity + shuffle) and constraints. Pure + deterministic.
 *
 * Strategy switch: when the owned pool is small enough to enumerate every spell combination
 * on the roomiest chassis (≤ EXHAUSTIVE_COMBO_BUDGET), run the EXHAUSTIVE survey — a complete
 * "run all options". Otherwise (large pool / theorycraft full-DB) fall back to the bounded
 * template-seed + local-search path. Both rank on the same honest fitness.
 */
export function generate(req: GenerateRequest): GenerateResult {
  const ix = buildPoolIndex(req.pool)
  // Owned-copy caps (M5 quantity fix): a Map for O(1) lookups in templates + polish.
  // Absent ⇒ unlimited (theorycraft); never constrains a build to fewer copies.
  const caps = req.counts ? new Map(req.counts) : undefined
  const ideal = req.theorycraft === true
  const archetypes = req.archetypes ?? ARCHETYPES
  const result = {} as GenerateResult
  for (const a of ARCHETYPES) result[a] = { builds: [] }

  const maxCap = req.chassis.reduce((m, c) => Math.max(m, c.stats.capacity), 0)
  const combos = ideal || req.pool.length === 0 ? Infinity : countCombinations(req.pool, caps, maxCap)
  if (combos <= EXHAUSTIVE_COMBO_BUDGET) {
    const ex = generateExhaustive(ix, req, caps)
    for (const a of archetypes) result[a] = ex[a]
    return result
  }

  // Large pool / theorycraft: bounded template-seed + polish. An empty chassis list builds
  // nothing; generateForArchetype handles it gracefully (no seeds → a pool-appropriate note).
  for (const a of archetypes) {
    result[a] = generateForArchetype(ix, req.chassis, a, req.constraints, req.perks, caps, ideal)
  }
  return result
}
