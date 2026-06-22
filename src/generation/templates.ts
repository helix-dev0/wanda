// M5 — wand templates (spec §6.4): detect key spells in the pool and instantiate
// known-good shapes, which the polish loop then refines. Each template returns
// ordered seed decks (spell ids) bounded to capacity; it returns NOTHING when the
// pool can't satisfy it (graceful). Order-dependent templates are gated OUT on a
// shuffle chassis, where deck order isn't honored (M4 sims one seed-0 sample).
//
// These are heuristic STARTING points, not the answer — the M4 scorer + the polish
// loop are the source of truth. Thresholds are intentionally loose.

import type { Archetype } from '../analysis'
import type { TemplateId } from './types'
import { type PoolIndex, projectilesByMana } from './poolIndex'

export interface TemplateContext {
  index: PoolIndex
  capacity: number
  shuffle: boolean
  archetype: Archetype
  /** Per-spell OWNED copy cap (from `ownedCounts`): a seed may use each id at most
   *  `caps.get(id) ?? 0` times. `undefined` ⇒ unlimited (theorycraft + pre-cap
   *  callers) — the load-bearing default that keeps theorycraft and existing tests
   *  byte-identical. */
  caps?: ReadonlyMap<string, number>
}

export interface Template {
  id: TemplateId
  /** True when the deck's order is essential (gated out on a shuffle chassis). */
  orderDependent: boolean
  /** Archetypes this template primarily serves. */
  archetypes: readonly Archetype[]
  /** 0..N ordered seed decks, each already trimmed to ≤ capacity. */
  instantiate(ctx: TemplateContext): string[][]
}

const truncate = (deck: string[], capacity: number): string[] => deck.slice(0, Math.max(0, capacity))
const unique = (ids: string[]): string[] => [...new Set(ids)]

type Caps = ReadonlyMap<string, number> | undefined

/** Try to reserve ONE copy of `id` against the shared `used` multiset under `caps`.
 *  Returns true (and records the use) if a copy is still available, false once `id`
 *  is at its owned cap. `caps === undefined` ⇒ unlimited. The buckets in a PoolIndex
 *  are OVERLAPPING views of one multiset (NUKE is a nuke AND a projectile; CHAINSAW
 *  a digger AND a projectile), so EVERY placement in a seed must go through one
 *  shared `used` — no template may charge a different counter or skip the guard. */
function place(caps: Caps, used: Map<string, number>, id: string): boolean {
  const u = used.get(id) ?? 0
  if (caps && u >= (caps.get(id) ?? 0)) return false
  used.set(id, u + 1)
  return true
}

/** Greedily draw up to `n` ids from `candidates` (in order), reserving each against
 *  the shared `used` multiset. Exhausts a candidate's remaining copies before moving
 *  on (so the cheapest spam shot fills first, spilling to the next when capped) and
 *  stops EARLY once nothing is placeable — the seed is then short and `seedWand` pads
 *  the rest with null, so a spell never repeats beyond how many the player owns. With
 *  `caps === undefined`, the first candidate fills every slot (the pre-cap behavior). */
function draftFill(candidates: readonly string[], n: number, caps: Caps, used: Map<string, number>): string[] {
  const out: string[] = []
  for (const id of candidates) {
    while (out.length < n && place(caps, used, id)) out.push(id)
    if (out.length >= n) break
  }
  return out
}

/** One nuke, with damage modifiers stacked before it. Fires regardless of order,
 *  so it is allowed on shuffle (the pre-nuke modifiers are then a best-effort). */
const singleNuke: Template = {
  id: 'single-nuke',
  orderDependent: false,
  archetypes: ['DAMAGE', 'AOE'],
  instantiate({ index, capacity, caps }) {
    if (index.nukes.length === 0 || capacity < 1) return []
    const used = new Map<string, number>()
    const nuke = index.nukes[0]
    if (!place(caps, used, nuke)) return [] // must own the nuke
    const mods: string[] = []
    for (const m of index.modifiers) {
      if (mods.length >= capacity - 1) break
      if (place(caps, used, m)) mods.push(m)
    }
    return [truncate([...mods, nuke], capacity)]
  },
}

/** A trigger modifier delivering a payload on impact — order is essential
 *  (trigger must precede its carrier), so this is shuffle-gated. */
const triggerPayload: Template = {
  id: 'trigger-payload',
  orderDependent: true,
  archetypes: ['DAMAGE', 'AOE'],
  instantiate({ index, capacity, caps }) {
    if (index.triggers.length === 0 || index.projectiles.length === 0 || capacity < 2) return []
    const used = new Map<string, number>()
    const trigger = index.triggers[0]
    if (!place(caps, used, trigger)) return [] // must own the trigger
    const proj = projectilesByMana(index)
    const carrier = proj[0]
    if (!place(caps, used, carrier)) return [] // must own a carrier projectile
    const deck = [trigger, carrier]
    // Prefer a DISTINCT 2nd-cheapest payload (the original heuristic); fall back to a
    // second copy of the carrier only when one is still owned — never duplicate it
    // into a deck that holds a single owned projectile.
    if (capacity >= 3) {
      const payload = proj[1] ?? proj[0]
      if (place(caps, used, payload)) deck.push(payload)
    }
    return [truncate(deck, capacity)]
  },
}

/** A multicast spell followed by repeated shots — draws N at once. Order-loose
 *  enough to allow on shuffle (it still draws N, just from a luck-of-draw set). */
const multicastStack: Template = {
  id: 'multicast-stack',
  orderDependent: false,
  archetypes: ['SPAM', 'AOE', 'DAMAGE'],
  instantiate({ index, capacity, caps }) {
    if (index.multicasts.length === 0 || index.projectiles.length === 0 || capacity < 2) return []
    const used = new Map<string, number>()
    const mc = index.multicasts[0]
    if (!place(caps, used, mc)) return [] // must own the multicast
    const shots = draftFill(projectilesByMana(index), capacity - 1, caps, used)
    if (shots.length === 0) return [] // need at least one owned shot to multicast
    return [truncate([mc, ...shots], capacity)]
  },
}

/** The deck filled with the cheapest projectile — continuous fire. */
const spammer: Template = {
  id: 'spammer',
  orderDependent: false,
  archetypes: ['SPAM'],
  instantiate({ index, capacity, caps }) {
    const cheap = projectilesByMana(index)
    if (cheap.length === 0 || capacity < 1) return []
    const deck = draftFill(cheap, capacity, caps, new Map())
    return deck.length > 0 ? [deck] : []
  },
}

/** The relevant feature spells for MOBILITY/DEFENSIVE (whose scores are purely
 *  feature-count), padded with cheap projectiles so the wand still attacks. */
const featureFill: Template = {
  id: 'feature-fill',
  orderDependent: false,
  archetypes: ['MOBILITY', 'DEFENSIVE'],
  instantiate({ index, capacity, archetype, caps }) {
    const wanted =
      archetype === 'MOBILITY'
        ? unique([...index.diggers, ...index.mobility])
        : archetype === 'DEFENSIVE'
          ? unique([...index.defensive, ...index.homing])
          : []
    if (wanted.length === 0 || capacity < 1) return []
    const used = new Map<string, number>()
    const deck: string[] = []
    for (const id of wanted) {
      if (deck.length >= capacity) break
      if (place(caps, used, id)) deck.push(id)
    }
    // Pad with cheap projectiles so the wand still attacks — charged against the SAME
    // `used`, so a dual-role spell (e.g. CHAINSAW: digger AND projectile) already
    // placed as a feature spell can't reappear as filler beyond its owned count.
    deck.push(...draftFill(projectilesByMana(index), capacity - deck.length, caps, used))
    return deck.length > 0 ? [truncate(deck, capacity)] : []
  },
}

export const TEMPLATES: readonly Template[] = [
  singleNuke,
  triggerPayload,
  multicastStack,
  spammer,
  featureFill,
]

/** Stable priority for tie-breaking equally-scored builds (earlier = preferred). */
export const TEMPLATE_ORDER: Record<TemplateId, number> = {
  'single-nuke': 0,
  'trigger-payload': 1,
  'multicast-stack': 2,
  spammer: 3,
  'feature-fill': 4,
}
