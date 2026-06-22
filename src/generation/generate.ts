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
  IMPROVE_EPS,
  MAX_CANDIDATES,
  MAX_ROUNDS,
  POLISH_POOL_MAX,
} from './budget'
import { buildPoolIndex, type PoolIndex } from './poolIndex'
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
    SPAM: [ix.projectiles, ix.multicasts, ix.modifiers],
    AOE: [ix.nukes, ix.multicasts, ix.modifiers, ix.projectiles],
    MOBILITY: [ix.diggers, ix.mobility, ix.modifiers, ix.projectiles],
    DEFENSIVE: [ix.defensive, ix.homing, ix.modifiers, ix.projectiles],
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
): { wand: Wand; edits: AppliedEdit[] } {
  let current = seed
  const edits: AppliedEdit[] = []
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (simCacheSize() - budgetFrom >= MAX_CANDIDATES) break
    const best = suggestEdits(current, archetype, pool, perks)[0]
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
  if (archetype === 'MOBILITY' && ix.diggers.length + ix.mobility.length === 0) {
    return 'No digging or movement spells in your pool.'
  }
  if (archetype === 'DEFENSIVE' && ix.defensive.length + ix.homing.length === 0) {
    return 'No defensive spells in your pool.'
  }
  return 'No build could be assembled from the current pool.'
}

function generateForArchetype(
  ix: PoolIndex,
  chassis: Wand,
  archetype: Archetype,
  constraints: Constraints,
  perks: readonly PerkRef[],
): ArchetypeBuilds {
  const ctx = { index: ix, capacity: chassis.stats.capacity, shuffle: chassis.stats.shuffle, archetype }
  const templates = TEMPLATES.filter(
    (t) => t.archetypes.includes(archetype) && !(chassis.stats.shuffle && t.orderDependent),
  )
  const seeds = templates.flatMap((t) => t.instantiate(ctx).map((deck) => ({ template: t.id, deck })))
  if (seeds.length === 0) return { builds: [], note: noteFor(ix, archetype, constraints, false) }

  const trimmed = trimPool(ix, archetype, POLISH_POOL_MAX)
  const budgetFrom = simCacheSize() // per-archetype candidate budget (cache-size delta)
  const byKey = new Map<string, GeneratedBuild>()
  for (const { template, deck } of seeds) {
    if (simCacheSize() - budgetFrom >= MAX_CANDIDATES) break
    const { wand, edits } = polish(seedWand(chassis, deck), archetype, trimmed, perks, budgetFrom)
    const analysis = analyzeWand(wand, perks)
    const build: GeneratedBuild = { wand, archetype, template, analysis, edits, perkAdvice: advisePerk(analysis) }
    const prev = byKey.get(analysis.key)
    if (!prev || rankKey(build) > rankKey(prev)) byKey.set(analysis.key, build)
  }

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

/**
 * Generate ranked builds for each requested archetype from the pool, under the
 * chassis (capacity + shuffle) and constraints. Pure + deterministic.
 */
export function generate(req: GenerateRequest): GenerateResult {
  const ix = buildPoolIndex(req.pool)
  const archetypes = req.archetypes ?? ARCHETYPES
  const result = {} as GenerateResult
  for (const a of ARCHETYPES) result[a] = { builds: [] }
  for (const a of archetypes) result[a] = generateForArchetype(ix, req.chassis, a, req.constraints, req.perks)
  return result
}
