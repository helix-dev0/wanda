// Simulator-driven NEAR-EXHAUSTIVE search (spec §6 "run all options"). For a small
// owned pool, enumerate EVERY cap-limited spell COMBINATION up to the chassis capacity,
// lay each out in ONE meta-canonical ordering, and hand the decks to the (now honest)
// scorer. For the maintainer's fresh-run pool this is genuinely exhaustive — every
// arrangement of their spells is surveyed, so generation can no longer miss an optimum.
//
// Why combinations × ONE canonical order (not all permutations): the permutation space is
// C! and explodes, but the scorer is order-sensitive only for a few meta patterns —
// modifiers must precede a multicast to broadcast, a trigger must precede its carrier. The
// canonical order (modifiers → multicast → trigger → shots) realizes those, so one ordering
// per combination captures the strong builds. (Deeper ordering search is a later refinement.)
//
// ENABLERS (chainsaw, luminous drill) are INCLUDED, never excluded: the honest range/mana
// scorer ranks enabler+payload high (fast cycle, payload carries the reach) and enabler-only
// low (short reach), so the old `isUtilitySpell` damage-exclusion is unnecessary here.
// (docs/scoring-rebuild-spec.md §0.)

import type { PoolIndex } from './poolIndex'

export type Caps = ReadonlyMap<string, number> | undefined

/** Canonical deck-ordering role (lower = earlier). Modifiers lead so they broadcast to a
 *  following multicast / wrap a following carrier; the multicast draws the rest; triggers
 *  precede their payloads; everything else (shots, enablers, nukes) trails. Within a role,
 *  the pool's own order is preserved for stability. */
function roleRank(id: string, ix: PoolIndex): number {
  if (ix.modifiers.includes(id)) return 0
  if (ix.multicasts.includes(id)) return 1
  if (ix.triggers.includes(id)) return 2
  return 3
}

/** Lay a multiset (id → count) into one canonical-ordered deck. Deterministic. */
function canonicalDeck(counts: ReadonlyMap<string, number>, order: readonly string[], ix: PoolIndex): string[] {
  const ids = [...counts.keys()].sort(
    (a, b) => roleRank(a, ix) - roleRank(b, ix) || order.indexOf(a) - order.indexOf(b),
  )
  const deck: string[] = []
  for (const id of ids) for (let i = 0; i < (counts.get(id) ?? 0); i++) deck.push(id)
  return deck
}

/** Per-id usable copies on a deck of this capacity: min(owned cap, capacity). Unlimited
 *  (caps absent / id not in caps) ⇒ capacity (you can't fit more than the deck holds). */
function capFor(id: string, caps: Caps, capacity: number): number {
  return Math.min(caps && caps.has(id) ? (caps.get(id) ?? 0) : capacity, capacity)
}

/** How many distinct cap-limited multisets of total size 1..capacity exist over `ids` — the
 *  candidate-budget estimate used to choose exhaustive vs bounded search. Product of
 *  (perId cap + 1) less the empty set, but counted by size so it respects the capacity cap. */
export function countCombinations(ids: readonly string[], caps: Caps, capacity: number): number {
  let dp = new Array<number>(capacity + 1).fill(0)
  dp[0] = 1
  for (const id of ids) {
    const cap = capFor(id, caps, capacity)
    const next = new Array<number>(capacity + 1).fill(0)
    for (let s = 0; s <= capacity; s++) {
      if (dp[s] === 0) continue
      for (let take = 0; take <= cap && s + take <= capacity; take++) next[s + take] += dp[s]
    }
    dp = next
  }
  let total = 0
  for (let s = 1; s <= capacity; s++) total += dp[s]
  return total
}

/** Enumerate every cap-limited spell combination (size 1..capacity) from `ids`, each in
 *  canonical order. Deterministic. Hard-stops at `maxDecks` (a runaway guard); call only when
 *  countCombinations ≤ budget for a complete survey. */
export function enumerateDecks(
  ids: readonly string[],
  caps: Caps,
  capacity: number,
  ix: PoolIndex,
  maxDecks: number,
): string[][] {
  const decks: string[][] = []
  const counts = new Map<string, number>()
  const recurse = (i: number, size: number): void => {
    if (decks.length >= maxDecks) return
    if (i >= ids.length) {
      if (size > 0) decks.push(canonicalDeck(counts, ids, ix))
      return
    }
    const id = ids[i]
    const cap = Math.min(capFor(id, caps, capacity), capacity - size)
    for (let take = 0; take <= cap; take++) {
      if (take > 0) counts.set(id, take)
      else counts.delete(id)
      recurse(i + 1, size + take)
      if (decks.length >= maxDecks) break
    }
    counts.delete(id)
  }
  recurse(0, 0)
  return decks
}
