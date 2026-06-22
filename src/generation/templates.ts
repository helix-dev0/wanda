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

/** One nuke, with damage modifiers stacked before it. Fires regardless of order,
 *  so it is allowed on shuffle (the pre-nuke modifiers are then a best-effort). */
const singleNuke: Template = {
  id: 'single-nuke',
  orderDependent: false,
  archetypes: ['DAMAGE', 'AOE'],
  instantiate({ index, capacity }) {
    if (index.nukes.length === 0 || capacity < 1) return []
    const mods = index.modifiers.slice(0, Math.max(0, capacity - 1))
    return [truncate([...mods, index.nukes[0]], capacity)]
  },
}

/** A trigger modifier delivering a payload on impact — order is essential
 *  (trigger must precede its carrier), so this is shuffle-gated. */
const triggerPayload: Template = {
  id: 'trigger-payload',
  orderDependent: true,
  archetypes: ['DAMAGE', 'AOE'],
  instantiate({ index, capacity }) {
    if (index.triggers.length === 0 || index.projectiles.length === 0 || capacity < 2) return []
    const proj = projectilesByMana(index)
    const carrier = proj[0]
    const payload = proj[1] ?? proj[0]
    const deck = capacity >= 3 ? [index.triggers[0], carrier, payload] : [index.triggers[0], carrier]
    return [truncate(deck, capacity)]
  },
}

/** A multicast spell followed by repeated shots — draws N at once. Order-loose
 *  enough to allow on shuffle (it still draws N, just from a luck-of-draw set). */
const multicastStack: Template = {
  id: 'multicast-stack',
  orderDependent: false,
  archetypes: ['SPAM', 'AOE', 'DAMAGE'],
  instantiate({ index, capacity }) {
    if (index.multicasts.length === 0 || index.projectiles.length === 0 || capacity < 2) return []
    const cheap = projectilesByMana(index)[0]
    const shots = Array.from({ length: Math.max(1, capacity - 1) }, () => cheap)
    return [truncate([index.multicasts[0], ...shots], capacity)]
  },
}

/** The deck filled with the cheapest projectile — continuous fire. */
const spammer: Template = {
  id: 'spammer',
  orderDependent: false,
  archetypes: ['SPAM'],
  instantiate({ index, capacity }) {
    const cheap = projectilesByMana(index)
    if (cheap.length === 0 || capacity < 1) return []
    return [truncate(Array.from({ length: capacity }, () => cheap[0]), capacity)]
  },
}

/** The relevant feature spells for MOBILITY/DEFENSIVE (whose scores are purely
 *  feature-count), padded with cheap projectiles so the wand still attacks. */
const featureFill: Template = {
  id: 'feature-fill',
  orderDependent: false,
  archetypes: ['MOBILITY', 'DEFENSIVE'],
  instantiate({ index, capacity, archetype }) {
    const wanted =
      archetype === 'MOBILITY'
        ? unique([...index.diggers, ...index.mobility])
        : archetype === 'DEFENSIVE'
          ? unique([...index.defensive, ...index.homing])
          : []
    if (wanted.length === 0 || capacity < 1) return []
    const deck = wanted.slice(0, capacity)
    const filler = projectilesByMana(index)
    for (let fi = 0; deck.length < capacity && filler.length > 0; fi++) {
      deck.push(filler[fi % filler.length])
    }
    return [truncate(deck, capacity)]
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
