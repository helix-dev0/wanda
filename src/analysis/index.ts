// M4 — analysis engine public entry. Joins the simulator (cached) with archetype
// scoring and the self-danger veto into one per-wand verdict. The view-model
// (Slice F) consumes WandAnalysis to render the per-archetype tier list, placing
// any `selfDanger.unsafe` wand in the Unsafe band.

import type { Wand, PerkRef } from '../schema/snapshot'
import type { WandMetrics } from '../sim/metrics'
import { evalWand } from './simCache'
import { wandKey } from './wandKey'
import { scoreWand, type Archetype, type ArchetypeScore } from './archetypes'
import { deckFeatureCounts } from './features/spellFeatures'
import { evaluateSelfDanger, type SelfDangerReport } from './selfDanger'

export interface WandAnalysis {
  /** Structural cache key (stable across slots + current mana). */
  key: string
  metrics: WandMetrics
  /** Simulation/damage is not a faithful reproduction (modded / always-cast). */
  approximate: boolean
  selfDanger: SelfDangerReport
  scores: Record<Archetype, ArchetypeScore>
  /** MOBILITY demoted to a capability flag (§5.3 — teleport wands are trivial to build,
   *  not a tiered optimization target): the deck has a teleport/levitation spell. */
  mobility: boolean
}

/** Fully analyze one wand relative to the player's acquired perks. */
export function analyzeWand(wand: Wand, perks: readonly PerkRef[]): WandAnalysis {
  const ev = evalWand(wand)
  return {
    key: wandKey(wand),
    metrics: ev.metrics,
    approximate: ev.sim.approximate || ev.metrics.damageApproximate,
    selfDanger: evaluateSelfDanger(wand, ev.sim.shots, perks),
    scores: scoreWand(wand, ev, perks),
    mobility: deckFeatureCounts(wand).MOBILITY > 0,
  }
}

/** Analyze every held wand (the tier-list input). */
export function analyzeWands(
  wands: readonly Wand[],
  perks: readonly PerkRef[],
): WandAnalysis[] {
  return wands.map((w) => analyzeWand(w, perks))
}

export { ARCHETYPES, type Archetype, type ArchetypeScore, type Tier } from './archetypes'
export type { SelfDangerReport, HazardFinding, Hazard } from './selfDanger'
