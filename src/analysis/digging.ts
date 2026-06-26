// DIGGING — a first-class archetype scored by capability × sustainability
// (scoring-model-v2-spec §5.3). Capability is a CURATED, wiki-grounded map: verified at
// implementation, the durability tier is NOT a clean projectile stat — only 1 of 445
// projectile XMLs carries ground_penetration_max_durability_to_destroy; the canonical
// diggers dig via explosion ray_energy (digger 100000, nuke 6.7M) or special fields
// (black_hole). So we curate from noita.wiki.gg/wiki/Digging (a cited mechanic, #9), not
// from the table. Sustainability reuses the existing mana metrics.

import type { Wand } from '../schema/snapshot'
import type { WandMetrics } from '../sim/metrics'
import { spellFeatures } from './features/spellFeatures'
import { scoreFromScalar, type ScalarBands } from './ttk'

/**
 * Spell id → the max material durability TIER (0–14) the spell can break, for the DEDICATED
 * diggers (the SPELL_FEATURES `DIG` set). Cited noita.wiki.gg/wiki/Digging; the exact mids are
 * PROVISIONAL (the meta-expert confirms), the anchors firm: Luminous Drill / Giga black hole
 * break everything (incl. Cursed Rock), a chainsaw only soft terrain. NUKE etc. can break rock
 * too, but a nuke is NOT a digging build — only `DIG`-tagged spells count (see digCapability).
 */
export const DIG_TIER: Record<string, number> = {
  // Top tier — dig-strength 14, breaks everything incl. Cursed Rock.
  LUMINOUS_DRILL: 14,
  LASER_LUMINOUS_DRILL: 14,
  BLACK_HOLE_GIGA: 14,
  // High — digs Cursed Rock via field.
  BLACK_HOLE: 13,
  BLACK_HOLE_BIG: 13,
  MATTER_EATER: 11,
  // Mid — strong digging bolts / blasts.
  POWERDIGGER: 10,
  TNTBOX: 9,
  DIGGER: 8,
  // Enabler-grade — soft terrain only (a fast-cast enabler, not a real miner).
  CHAINSAW: 6,
}

/** The maximum material durability tier the wand's DEDICATED dig spells can break (0 = none).
 *  Gated on the `DIG` feature tag so an offensive spell that incidentally breaks terrain
 *  (a nuke, a drilling laser) never routes the wand to the DIGGING archetype. */
export function digCapability(wand: Wand): number {
  const ids = [...wand.spells.filter((s): s is string => s !== null), ...wand.always_cast]
  let best = 0
  for (const id of ids) {
    if (!spellFeatures(id).includes('DIG')) continue
    best = Math.max(best, DIG_TIER[id] ?? 0)
  }
  return best
}

/** Can the wand dig CONTINUOUSLY? 1 = sustains forever; a penalty when it out-drains its
 *  mana. The good complex diggers (Black Hole: 180 mana + 80 cast-delay, not made unlimited
 *  by the Unlimited Spells perk) are exactly the hard-to-sustain ones. PROVISIONAL penalty;
 *  reuses the mana-sustainability metric so a Wand-Refresh / Greek-letter loop that DOES
 *  sustain reads as sustainable. */
export function digSustainability(m: WandMetrics): number {
  // PROVISIONAL penalty, softened so it can't invert the dig-tier order: a stalling top-tier
  // all-material digger (Black Hole, breaks ANY material slowly) must still out-rank a
  // sustainable soft-only tool (Chainsaw, can't scratch rock). 0.55 keeps the sustainable
  // Luminous Drill on top while leaving Black Hole above the soft diggers.
  return m.manaSustainable ? 1 : 0.55
}

export interface DigScore {
  /** Max durability tier broken (0–14). */
  capability: number
  /** Continuous-dig factor in [0,1]. */
  sustainability: number
  /** capability/14 × sustainability, in [0,1] — the DIGGING ordering scalar. */
  scalar: number
}

/** The DIGGING scalar breakdown for a wand (capability × sustainability). */
export function digScore(wand: Wand, m: WandMetrics): DigScore {
  const capability = digCapability(wand)
  const sustainability = digSustainability(m)
  return { capability, sustainability, scalar: (capability / 14) * sustainability }
}

/** PROVISIONAL DIGGING bands over the [0,1] capability×sustainability scalar (meta-expert
 *  tunes): a sustainable top-tier digger is S, an unsustainable one or a low-tier one drops. */
export const DIG_BANDS: ScalarBands = { C: 0.2, B: 0.4, A: 0.6, S: 0.85 }

/** Whether the wand can dig at all (the routing gate for the DIGGING archetype). */
export function isDigger(wand: Wand): boolean {
  return digCapability(wand) > 0
}

/** Map a wand's dig scalar to 0–100 (used by the scorer at S4). */
export function digScoreValue(wand: Wand, m: WandMetrics): number {
  return scoreFromScalar(digScore(wand, m).scalar, DIG_BANDS)
}
