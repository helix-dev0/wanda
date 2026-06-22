// M5 generation — shared types. The generation pipeline is a PURE, serializable
// module (the web worker in T3 is a thin wrapper), so everything here is plain
// data: no Sets/Maps/functions cross a postMessage boundary, and GeneratedBuild
// IS the worker DTO (provenance is joined on the main thread at render time).

import type { Wand, PerkRef } from '../schema/snapshot'
import type { Archetype, WandAnalysis } from '../analysis'
import type { Edit } from '../analysis/suggestions'

/** The known-good wand patterns generation seeds from (spec §6.4). `feature-fill`
 *  serves MOBILITY/DEFENSIVE, whose scores are feature-count driven. */
export type TemplateId =
  | 'single-nuke'
  | 'trigger-payload'
  | 'multicast-stack'
  | 'spammer'
  | 'feature-fill'

/** Optional generation constraints the player can impose (spec §6.3). */
export interface Constraints {
  /** Require a digging spell in the build. */
  mustDig?: boolean
  /** Reject any build that would hurt the player (self-danger unsafe). */
  noSelfDamage?: boolean
}

/** One polish step applied to a seed, kept for Teach/Prescribe "what we changed". */
export interface AppliedEdit {
  label: string
  /** Target-archetype score gained by this step. */
  deltaScore: number
  kind: Edit['kind']
}

/** Perk-pick advice when the best build is unsafe but a perk would fix it. */
export interface PerkAdvice {
  /** Perk ids that would neutralize the build's lethal hazards. */
  perks: string[]
  reason: string
}

/** A generated candidate wand, scored. Plain data → safe to postMessage. */
export interface GeneratedBuild {
  wand: Wand
  /** The archetype this build was generated to maximize. */
  archetype: Archetype
  template: TemplateId
  /** The scorer's full verdict (per-archetype scores, metrics, self-danger). */
  analysis: WandAnalysis
  /** Polish edits applied to the seed, in order. */
  edits: AppliedEdit[]
  perkAdvice?: PerkAdvice
}

/** Builds for one archetype, plus a note explaining an empty result. */
export interface ArchetypeBuilds {
  builds: GeneratedBuild[]
  /** Why `builds` is empty (e.g. "No digging spell in your pool."), else undefined. */
  note?: string
}

/** generate() output — one entry per requested archetype. */
export type GenerateResult = Record<Archetype, ArchetypeBuilds>

/** generate() input. `pool` is an array (not a Set) so it survives postMessage. */
export interface GenerateRequest {
  pool: string[]
  chassis: Wand
  perks: PerkRef[]
  constraints: Constraints
  /** Defaults to all archetypes. */
  archetypes?: Archetype[]
}

// --- worker protocol (all structured-cloneable; no Sets/Maps/functions) ---------

/** main → worker: a generation request tagged with a monotonic id. */
export type GenRequestMsg = GenerateRequest & { type: 'generate'; reqId: number }

/** worker → main: success. */
export interface GenResponseMsg {
  type: 'result'
  reqId: number
  result: GenerateResult
}

/** worker → main: the generate() call threw. */
export interface GenErrorMsg {
  type: 'error'
  reqId: number
  message: string
}

export type WorkerResponse = GenResponseMsg | GenErrorMsg
