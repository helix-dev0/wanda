// M4-T3 — local-search suggestions ("incremental fixes"). Depth-1 only: every
// candidate is the wand with ONE edit (a single swap from the pool, an adjacent
// reorder, or a removal), scored against a target archetype via the simulator.
// Spec §6.4 step 2 ("ship first") — bounded beam/hill-climb and a web worker are
// deferred to M5's combinatorial generation. Budget ≈ N deck slots × P pool
// spells (+ N removals + N−1 reorders); each candidate is one cached evalWand, so
// a rerank is a few hundred sub-ms sims on the main thread.
//
// Self-danger is a veto here too: an edit that INTRODUCES a new un-neutralized
// lethal hazard is discarded; an edit that REMOVES one gets a visibility bonus so
// "swap X→Y, removes the fire self-danger" surfaces even at a small score delta.

import type { Wand, PerkRef } from '../schema/snapshot'
import { evalWand } from './simCache'
import { scoreWand, type Archetype } from './archetypes'
import { evaluateSelfDanger, type Hazard } from './selfDanger'
import { spellDisplayName } from '../data/spellDb'

export type Edit =
  | { kind: 'swap'; slot: number; from: string; to: string }
  | { kind: 'reorder'; slot: number } // swap deck[slot] and deck[slot+1]
  | { kind: 'remove'; slot: number; from: string }

export interface Suggestion {
  edit: Edit
  label: string
  /** Target-archetype score change vs the current wand (may be 0 when the win is
   *  purely safety). */
  deltaScore: number
  archetype: Archetype
  /** A lethal hazard this edit removes, if any. */
  fixesHazard?: Hazard
}

/** Visibility bonus (in score points) for an edit that clears a lethal hazard, so
 *  a safety fix ranks alongside a meaningful damage gain. */
const HAZARD_FIX_BONUS = 25

const MAX_SUGGESTIONS = 6

interface CandidateEval {
  score: number
  unsafe: boolean
  dangerHazards: Set<Hazard>
}

function evalCandidate(wand: Wand, target: Archetype, perks: readonly PerkRef[]): CandidateEval {
  const ev = evalWand(wand)
  const sd = evaluateSelfDanger(wand, ev.sim.shots, perks)
  return {
    score: scoreWand(wand, ev)[target].score,
    unsafe: sd.unsafe,
    dangerHazards: new Set(sd.findings.filter((f) => f.severity === 'danger').map((f) => f.hazard)),
  }
}

const withDeck = (wand: Wand, spells: (string | null)[]): Wand => ({ ...wand, spells })

/** All depth-1 edits, each paired with the wand it produces. */
function neighborhood(wand: Wand, pool: ReadonlySet<string>): { edit: Edit; wand: Wand }[] {
  const out: { edit: Edit; wand: Wand }[] = []
  const deck = wand.spells

  deck.forEach((cur, i) => {
    if (cur !== null) {
      // swap this slot for each distinct pool spell
      for (const to of pool) {
        if (to === cur) continue
        const next = [...deck]
        next[i] = to
        out.push({ edit: { kind: 'swap', slot: i, from: cur, to }, wand: withDeck(wand, next) })
      }
      // removal
      const removed = [...deck]
      removed[i] = null
      out.push({ edit: { kind: 'remove', slot: i, from: cur }, wand: withDeck(wand, removed) })
    }
    // adjacent reorder (only when both slots hold a spell and they differ)
    const nextSpell = deck[i + 1]
    if (cur !== null && nextSpell != null && cur !== nextSpell) {
      const swapped = [...deck]
      swapped[i] = nextSpell
      swapped[i + 1] = cur
      out.push({ edit: { kind: 'reorder', slot: i }, wand: withDeck(wand, swapped) })
    }
  })
  return out
}

function labelFor(edit: Edit): string {
  switch (edit.kind) {
    case 'swap':
      return `Swap ${spellDisplayName(edit.from)} → ${spellDisplayName(edit.to)}`
    case 'remove':
      return `Remove ${spellDisplayName(edit.from)}`
    case 'reorder':
      return `Reorder slot ${edit.slot + 1} ↔ ${edit.slot + 2}`
  }
}

/**
 * Ranked depth-1 edits that improve `target` (or remove a lethal hazard), drawn
 * from the owned+seen `pool`. Edits that introduce a new danger are discarded.
 */
export function suggestEdits(
  wand: Wand,
  target: Archetype,
  pool: ReadonlySet<string>,
  perks: readonly PerkRef[],
): Suggestion[] {
  const base = evalCandidate(wand, target, perks)

  const scored = neighborhood(wand, pool).flatMap(({ edit, wand: cand }) => {
    const c = evalCandidate(cand, target, perks)
    // Veto: never suggest making a previously-safe wand unsafe.
    if (c.unsafe && !base.unsafe) return []

    const deltaScore = c.score - base.score
    const removed = [...base.dangerHazards].find((h) => !c.dangerHazards.has(h))
    const rank = deltaScore + (removed ? HAZARD_FIX_BONUS : 0)
    if (rank <= 0) return [] // only surface edits that actually help

    const s: Suggestion = { edit, label: labelFor(edit), deltaScore, archetype: target }
    if (removed) s.fixesHazard = removed
    return [{ s, rank }]
  })

  scored.sort((a, b) => b.rank - a.rank)
  return scored.slice(0, MAX_SUGGESTIONS).map((x) => x.s)
}
