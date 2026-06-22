// M4 — memoized per-wand simulation + metrics.
//
// The scorer (archetypes), self-danger, suggestions, AND the M3 cast view-model
// all need the same simulate→computeMetrics result for a given wand. Performance
// is a HARD requirement (spec §6.4): the tier list re-ranks as the run changes
// and local search evaluates hundreds of candidate wands, so we memoize by the
// wand's structural key. Candidate wands built during search are plain objects,
// so two equal chassis+loadouts share a cache entry.
//
// CAVEAT (intentional, see plan decision D4): wandKey excludes the volatile
// current `mana`, so `metrics.secondsUntilStall` (the only mana-dependent field —
// metrics.ts) is cached at the FIRST-seen mana for a given chassis. Archetype
// scoring deliberately keys off the mana-INDEPENDENT `manaSustainable` instead,
// so this never affects tiers. If a future live view needs a mana-accurate
// "stalls in Ns" readout it should fold mana into the key here.

import type { Wand } from '../schema/snapshot'
import { simulateWand, type SimResult } from '../sim/simulateWand'
import { computeMetrics, type WandMetrics } from '../sim/metrics'
import { wandKey } from './wandKey'

export interface WandEval {
  sim: SimResult
  metrics: WandMetrics
}

const cache = new Map<string, WandEval>()

/** Simulate a wand and derive its metrics, memoized by structural key. The
 *  returned object is shared across calls for the same key (referentially
 *  stable until `clearSimCache`), so callers must treat it as read-only. */
export function evalWand(wand: Wand): WandEval {
  const key = wandKey(wand)
  const hit = cache.get(key)
  if (hit) return hit
  const sim = simulateWand(wand)
  const metrics = computeMetrics(sim.shots, sim.reloadTime, wand.stats, sim.hitIterationLimit)
  const result: WandEval = { sim, metrics }
  cache.set(key, result)
  return result
}

/** Drop the memo. Call on run reset (a new run invalidates everything) and to
 *  keep unit tests isolated. */
export function clearSimCache(): void {
  cache.clear()
}
