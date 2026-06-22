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

/**
 * Apply a single depth-1 edit to a wand's deck, returning a NEW wand (pure; never
 * mutates the input). The one place deck edits are realized — the suggestion
 * neighborhood here and M5's generation polish loop both go through this, so the
 * two can never drift apart.
 */
export function applyEdit(wand: Wand, edit: Edit): Wand {
  const deck = [...wand.spells]
  switch (edit.kind) {
    case 'swap':
      deck[edit.slot] = edit.to
      break
    case 'remove':
      deck[edit.slot] = null
      break
    case 'reorder': // swap deck[slot] and deck[slot+1]
      ;[deck[edit.slot], deck[edit.slot + 1]] = [deck[edit.slot + 1], deck[edit.slot]]
      break
  }
  return { ...wand, spells: deck }
}

/** All depth-1 edits, each paired with the wand it produces. When `caps` is given, a
 *  swap that would push its target spell past how many the player owns is dropped
 *  (you can't socket a card you don't have); removal and reorder never add a copy, so
 *  they're always allowed. `caps` absent ⇒ unlimited (the pre-cap behavior). */
function neighborhood(
  wand: Wand,
  pool: ReadonlySet<string>,
  caps?: ReadonlyMap<string, number>,
): { edit: Edit; wand: Wand }[] {
  const out: { edit: Edit; wand: Wand }[] = []
  const deck = wand.spells
  const push = (edit: Edit) => out.push({ edit, wand: applyEdit(wand, edit) })

  // Occurrences already in the deck; a swap to `to` (slot holds some other id) adds
  // one more, so it's allowed only while that running total stays within the cap.
  const deckCounts = new Map<string, number>()
  if (caps) for (const s of deck) if (s !== null) deckCounts.set(s, (deckCounts.get(s) ?? 0) + 1)
  const canAdd = (to: string) => !caps || (deckCounts.get(to) ?? 0) < (caps.get(to) ?? 0)

  deck.forEach((cur, i) => {
    if (cur !== null) {
      // swap this slot for each distinct pool spell the player can still spare
      for (const to of pool) {
        if (to === cur) continue
        if (!canAdd(to)) continue // a copy of `to` beyond what's owned — unavailable
        push({ kind: 'swap', slot: i, from: cur, to })
      }
      // removal
      push({ kind: 'remove', slot: i, from: cur })
    }
    // adjacent reorder (only when both slots hold a spell and they differ)
    const nextSpell = deck[i + 1]
    if (cur !== null && nextSpell != null && cur !== nextSpell) {
      push({ kind: 'reorder', slot: i })
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
 * from the `pool`. Edits that introduce a new danger are discarded. When `caps` is
 * supplied (per-spell owned copy counts), a swap that would use a spell more times
 * than the player owns is never suggested; omit `caps` for unlimited (theorycraft).
 */
export function suggestEdits(
  wand: Wand,
  target: Archetype,
  pool: ReadonlySet<string>,
  perks: readonly PerkRef[],
  caps?: ReadonlyMap<string, number>,
): Suggestion[] {
  const base = evalCandidate(wand, target, perks)

  const scored = neighborhood(wand, pool, caps).flatMap(({ edit, wand: cand }) => {
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

  // Collapse equivalent edits that read the same to the user — e.g. swapping any
  // of three identical BUBBLESHOT slots for NUKE is one suggestion, not three.
  // Sorted desc, so the first kept per label is the highest-ranked.
  const seenLabels = new Set<string>()
  const deduped = scored.filter((x) => {
    if (seenLabels.has(x.s.label)) return false
    seenLabels.add(x.s.label)
    return true
  })
  return deduped.slice(0, MAX_SUGGESTIONS).map((x) => x.s)
}
