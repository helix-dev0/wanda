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
import { type PoolIndex, projectilesByMana, damageProjectilesByMana, damageModifiers } from './poolIndex'

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
    const proj = damageProjectilesByMana(index)
    if (proj.length === 0) return [] // a trigger needs a DAMAGE carrier/payload, not a digger
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

/** How many distinct multicasts to seed a variant for. The scorer (spread-aware) then
 *  ranks them, so a SCATTER and a BURST both get tried and the tight one wins for DAMAGE
 *  instead of us guessing from pool order. Bounded so the candidate count stays small. */
const MULTICAST_VARIANTS = 3

/** A multicast spell followed by repeated shots — draws N at once. Order-loose
 *  enough to allow on shuffle (it still draws N, just from a luck-of-draw set). One seed
 *  per multicast so the scorer can prefer a tight BURST over a wide SCATTER. */
const multicastStack: Template = {
  id: 'multicast-stack',
  orderDependent: false,
  archetypes: ['SPAM', 'AOE', 'DAMAGE'],
  instantiate({ index, capacity, caps }) {
    if (index.multicasts.length === 0 || index.projectiles.length === 0 || capacity < 2) return []
    const seeds: string[][] = []
    for (const mc of index.multicasts.slice(0, MULTICAST_VARIANTS)) {
      const used = new Map<string, number>()
      if (!place(caps, used, mc)) continue // must own this multicast
      const shots = draftFill(damageProjectilesByMana(index), capacity - 1, caps, used)
      if (shots.length === 0) continue // need at least one owned shot to multicast
      seeds.push(truncate([mc, ...shots], capacity))
    }
    return seeds
  },
}

/** Damage modifiers BROADCAST to a multicast's draws — the meta's multiplier engine
 *  (a modifier before a multicast applies to ALL drawn projectiles for one cost: crit ×,
 *  damage +). Validated against the engine: [DAMAGE, CRITICAL_HIT, BURST_3, LIGHT_BULLET
 *  ×3] does ~6× the sustained DPS of the bare multicast (43→257). Order is essential
 *  (modifiers + multicast must precede the shots) → shuffle-gated. The mods/shots split
 *  mirrors that validated shape (~half the non-multicast slots to modifiers). Needs ≥1
 *  multicast, ≥1 modifier, ≥1 projectile, capacity ≥3. */
const multiplicativeStack: Template = {
  id: 'multiplicative-stack',
  orderDependent: true,
  archetypes: ['DAMAGE', 'SPAM', 'AOE'],
  instantiate({ index, capacity, caps }) {
    if (
      index.multicasts.length === 0 ||
      index.modifiers.length === 0 ||
      index.projectiles.length === 0 ||
      capacity < 3
    ) {
      return []
    }
    // Modifiers lead so they broadcast; cap them at ~half the non-multicast slots so the
    // multicast still has shots to draw (the validated 2-mods/3-shots shape at cap 6).
    const maxMods = Math.max(1, Math.floor((capacity - 1) / 2))
    // Emit ONE seed PER multicast (capped) instead of guessing from pool order: the scorer
    // is spread-aware, so it picks the tight BURST over a wide SCATTER on its own merits.
    // Each seed respects owned caps independently (its own `used`).
    const seeds: string[][] = []
    for (const mc of index.multicasts.slice(0, MULTICAST_VARIANTS)) {
      const used = new Map<string, number>()
      if (!place(caps, used, mc)) continue // must own this multicast
      const mods: string[] = []
      for (const m of damageModifiers(index)) {
        if (mods.length >= maxMods) break
        if (place(caps, used, m)) mods.push(m)
      }
      if (mods.length === 0) continue // no owned damage modifier ⇒ this is just multicast-stack
      const shots = draftFill(damageProjectilesByMana(index), capacity - mods.length - 1, caps, used)
      if (shots.length === 0) continue // need at least one shot for the multicast to draw
      seeds.push(truncate([...mods, mc, ...shots], capacity))
    }
    return seeds
  },
}

/** A damage modifier paired with the cheapest projectile, repeated — each shot carries
 *  the modifier's bonus ("a flat +bonus disproportionately helps weak spells"; the
 *  cheap-shot × right-modifier pairing is the unit of value). Validated: ~3× the bare
 *  spam (20→58). Order is essential (modifier before its shot) → shuffle-gated. The
 *  modifier-broadcast multicast above is stronger when a multicast is owned; this is the
 *  no-multicast fallback. Needs ≥1 modifier, ≥1 projectile, capacity ≥2. */
const cheapShotSpam: Template = {
  id: 'cheap-shot-spam',
  orderDependent: true,
  archetypes: ['SPAM', 'DAMAGE'],
  instantiate({ index, capacity, caps }) {
    const mods = damageModifiers(index)
    if (mods.length === 0 || index.projectiles.length === 0 || capacity < 2) return []
    const used = new Map<string, number>()
    const proj = damageProjectilesByMana(index)
    const takeProj = (): string | null => proj.find((p) => place(caps, used, p)) ?? null
    const takeMod = (): string | null => mods.find((m) => place(caps, used, m)) ?? null
    const deck: string[] = []
    while (deck.length < capacity) {
      const shot = takeProj()
      if (!shot) break
      // Prepend a modifier when the [mod, shot] pair still fits and one is still owned.
      const mod = deck.length + 1 < capacity ? takeMod() : null
      if (mod) deck.push(mod)
      deck.push(shot)
    }
    // Must actually pair a modifier with a shot (else it is just `spammer`).
    if (!deck.some((id) => mods.includes(id))) return []
    return deck.length >= 2 ? [truncate(deck, capacity)] : []
  },
}

/** The deck filled with the cheapest projectile — continuous fire. */
const spammer: Template = {
  id: 'spammer',
  orderDependent: false,
  archetypes: ['SPAM'],
  instantiate({ index, capacity, caps }) {
    const cheap = damageProjectilesByMana(index)
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
  multiplicativeStack,
  multicastStack,
  cheapShotSpam,
  spammer,
  featureFill,
]

/** Stable priority for tie-breaking equally-scored builds (earlier = preferred). New
 *  modifier-stacking templates are appended (not renumbered) so existing tie-breaks are
 *  unchanged; they win on score when stronger, so their tie-break rank rarely matters. */
export const TEMPLATE_ORDER: Record<TemplateId, number> = {
  'single-nuke': 0,
  'trigger-payload': 1,
  'multicast-stack': 2,
  spammer: 3,
  'feature-fill': 4,
  'multiplicative-stack': 5,
  'cheap-shot-spam': 6,
  exhaustive: 7,
}
