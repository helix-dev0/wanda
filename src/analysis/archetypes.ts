// M4-T1 — archetype-parameterized scoring. Each archetype is SIGNATURE-DOMINANT:
// driven mostly by its defining metric, with mana-sustainability a near-gate for
// the throughput archetypes (a wand that stalls is a poor spammer / sustained
// dealer). Output is rich PER ARCHETYPE — never one collapsed score.
//
// Tiering is ABSOLUTE (fixed reference bands), not relative-within-pool: the pool
// is 1–3 held wands today and M5 must rank generated builds on the SAME yardstick.
// The reference constants below are PROVISIONAL / uncalibrated — the only goldens
// are the three tiny fixtures, and DPS itself is approximate (see metrics.ts).
// They are the first thing to tune against real wands.

import type { Wand } from '../schema/snapshot'
import type { WandMetrics } from '../sim/metrics'
import type { WandEval } from './simCache'
import { deckFeatureCounts, type FeatureCounts } from './features/spellFeatures'

export const ARCHETYPES = ['DAMAGE', 'SPAM', 'AOE', 'MOBILITY', 'DEFENSIVE'] as const
export type Archetype = (typeof ARCHETYPES)[number]

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D'

export interface ArchetypeScore {
  archetype: Archetype
  /** 0–100, absolute. */
  score: number
  tier: Tier
  /** The 2–3 metrics/features that drove the score (already formatted). */
  topMetrics: { label: string; value: string }[]
  /** Short human notes (e.g. the mana-gate penalty). */
  reasons: string[]
}

/** Saturating normalization: 0 → 0, x=ref → ~63, asymptotes to 100. Monotonic,
 *  no hard clip, so "twice as good" keeps moving the needle with diminishing return. */
function sat(x: number, ref: number): number {
  return 100 * (1 - Math.exp(-Math.max(0, x) / ref))
}

/** Reference points where a single signal reaches ~63/100. PROVISIONAL — calibrate
 *  against real captured wands (docs/scoring-grounding-spec.md Tier 2).
 *  `sustainedDps` re-grounded 150→300 (2026-06-22): at 150 the whole 300–2000+ DPS
 *  range collapsed to S (no top-end discrimination). At 300 the saturation puts the
 *  blended-DAMAGE S threshold at ~450 sustained DPS (with proportional burst), so a
 *  merely-good ~300-DPS wand is A and an elite ~700+ wand is S — matching the Noita
 *  power curve (verified: 100→C, 300→A, 700→S, 2000→S). Monotonic
 *  (all rankings preserved); the new band intent is pinned in archetypes.test.ts. */
const REF = {
  sustainedDps: 300,
  burstDps: 400,
  /** Spread (°) at which single-target on-target fraction halves. A tight BURST (~0°)
   *  keeps full single-target DPS; a SCATTER (~10–20°) sprays and loses it. */
  spreadDeg: 20,
  /** Reach (px) at/above which single-target damage gets FULL range credit. Every ranged
   *  fixture is ≥500px (bubbleshot 500, light_bullet 567, grenade 2333, rubber_ball 9375)
   *  so they're unchanged; close-range tools (luminous drill ~47, chainsaw ~7, laser ~75)
   *  fall below and are discounted. PROVISIONAL — calibrate vs real wands (rebuild-spec §6 Q2). */
  reachRef: 250,
  projPerSec: 8,
  aoeRadius: 60,
  aoeDamage: 100, // HP of a strong blast (bomb 125, grenade 47.5, nuke 250)
  projPerCycle: 12,
} as const

/** Floor on the range factor — a close-range weapon still deals SOME single-target damage
 *  in melee, so reach never zeroes the score (it caps the discount). */
const REACH_FLOOR = 0.1

/** Fraction of single-target damage that actually reaches an engaged enemy. Full credit at
 *  reach ≥ REF.reachRef (any normal ranged projectile); discounted toward REACH_FLOOR for a
 *  short-lived close-range beam/melee used as a "damage" wand (luminous drill, chainsaw).
 *  No-op for the ranged fixtures (all ≥500px). (docs/scoring-rebuild-spec.md §2.) */
function reachFraction(reachWeightedPx: number): number {
  return Math.min(1, Math.max(REACH_FLOOR, reachWeightedPx / REF.reachRef))
}

export function tierForScore(score: number): Tier {
  if (score >= 80) return 'S'
  if (score >= 60) return 'A'
  if (score >= 40) return 'B'
  if (score >= 20) return 'C'
  return 'D'
}

function mk(
  archetype: Archetype,
  rawScore: number,
  topMetrics: { label: string; value: string }[],
  reasons: string[],
): ArchetypeScore {
  const score = Math.round(Math.max(0, Math.min(100, rawScore)))
  return { archetype, score, tier: tierForScore(score), topMetrics, reasons }
}

const hp = (n: number) => `${n.toFixed(1)} HP/s`

/** "fire+poison" etc. from the DoT capability flags, or '' if none apply. */
function dotLabel(d: WandMetrics['appliesDot']): string {
  const parts: string[] = []
  if (d.fire) parts.push('fire')
  if (d.poison) parts.push('poison')
  if (d.toxic) parts.push('toxic')
  return parts.join('+')
}

function scoreDamage(m: WandMetrics): ArchetypeScore {
  // Single-target DPS only lands if the shots hit ONE point. Spread fans them out, so a
  // wide wand loses single-target damage while a tight one keeps it — model an effective
  // "fraction on target" that decays with spread (this is what lets the scorer prefer a
  // tight BURST over a wide SCATTER at equal raw DPS). No penalty at ≤0° (a focused wand),
  // so low-spread goldens are byte-identical. Crowd/AoE is scored separately and pays
  // nothing here — spread helps there. (noita.wiki.gg: Spread randomizes projectile angle.)
  const onTarget = REF.spreadDeg / (REF.spreadDeg + Math.max(0, m.effectiveSpread))
  // Single-target DPS only counts if it reaches the target. A close-range tool (luminous
  // drill, chainsaw) delivers its DPS only in melee, so it is not a ranged damage wand —
  // discount by how far its damage actually travels. Ranged wands (≥REF.reachRef) pay nothing.
  const reach = reachFraction(m.reachWeightedPx)
  const reasons: string[] = []
  // Sustained term uses the MANA-HONEST effectiveSustainedDps (B4): a wand that out-drains
  // its regen can't keep that DPS up. Burst stays the raw peak — a mana-starved wand can
  // still nova, and the 0.3 weight credits that. Both still gated by reach + on-target.
  const score =
    0.7 * sat(m.effectiveSustainedDps * onTarget * reach, REF.sustainedDps) +
    0.3 * sat(m.burstDps * onTarget * reach, REF.burstDps)
  if (reach < 0.9 && m.sustainedDps > 0) {
    reasons.push(`short range (~${Math.round(m.reachWeightedPx)}px) — close-range, limited single-target reach`)
  }
  if (m.effectiveSpread > 8) {
    reasons.push(`wide spread (${m.effectiveSpread.toFixed(0)}°) — sprays off a single target`)
  }
  if (m.effectiveSustainedDps < m.sustainedDps - 1) {
    reasons.push(`mana-limited — sustains ~${m.effectiveSustainedDps.toFixed(0)} of ${m.sustainedDps.toFixed(0)} HP/s under continuous fire`)
  }
  // DoT is %-max-HP (~2%/s), so it shines vs tanky / boss targets a raw-HP model can't
  // see. We can detect the capability but not quantify it (poison/toxic is material stain,
  // not a damage field) — so surface it as a note, NOT a score change (no fabricated number).
  const dot = dotLabel(m.appliesDot)
  if (dot) reasons.push(`applies ${dot} DoT — extra vs tanky / boss targets`)
  return mk(
    'DAMAGE',
    score,
    [
      { label: 'Sustained DPS', value: hp(m.effectiveSustainedDps) },
      { label: 'Burst DPS', value: hp(m.burstDps) },
    ],
    reasons,
  )
}

function scoreSpam(m: WandMetrics): ArchetypeScore {
  // A spammer = sustained EFFECTIVE damage you can fire continuously (meta: "high
  // projectiles/sec alone is insufficient"). Base on sustained DPS so a 0-damage
  // CHAINSAW can't win on rate alone (the headline bug); modulate by fire rate (the
  // spam identity, as a gentle 0.6–1.0 factor so damage leads); and HARD-gate on mana
  // sustain (a spammer that stalls is a poor spammer). REFs/penalty provisional.
  // rate ∈ [0.6, 1.0] — sat() returns 0–100, so normalize to a fraction.
  const rate = 0.6 + 0.4 * (sat(m.projectilesPerSecond, REF.projPerSec) / 100)
  // A spammer also has to REACH what it sprays — a close-range beam isn't a ranged spammer.
  const reach = reachFraction(m.reachWeightedPx)
  // effectiveSustainedDps (B4) folds the mana limit in CONTINUOUSLY — a spammer that can't
  // pay for its fire rate self-throttles, which is exactly the spam failure mode. So the old
  // hard ×0.2 mana gate is gone: the smooth ratio is the honest equivalent.
  const score = sat(m.effectiveSustainedDps * reach, REF.sustainedDps) * rate
  const reasons: string[] = []
  if (m.effectiveSustainedDps < m.sustainedDps - 1) {
    reasons.push('mana-limited — a spammer must fire continuously; output drops once mana runs dry')
  } else if (m.secondsUntilStall === null) {
    reasons.push('fires indefinitely')
  }
  return mk(
    'SPAM',
    score,
    [
      { label: 'Sustained DPS', value: hp(m.effectiveSustainedDps) },
      { label: 'Projectiles/s', value: m.projectilesPerSecond.toFixed(1) },
      { label: 'Mana', value: m.manaSustainable ? 'sustainable' : 'stalls' },
    ],
    reasons,
  )
}

function scoreAoe(m: WandMetrics): ArchetypeScore {
  // Crowd clear = blast DAMAGE first (a harmless digging explosion of the same radius
  // is not AoE), blast radius second, many projectiles third. Damage + radius both
  // descend trigger payloads (a trigger→bomb's blast lives in the payload).
  const score =
    0.6 * sat(m.maxExplosionDamage, REF.aoeDamage) +
    0.25 * sat(m.maxExplosionRadius, REF.aoeRadius) +
    0.15 * sat(m.projectilesPerCycle, REF.projPerCycle)
  return mk(
    'AOE',
    score,
    [
      {
        label: 'Blast damage',
        value: m.maxExplosionDamage > 0 ? hp(m.maxExplosionDamage) : '—',
      },
      {
        label: 'Blast radius',
        value: m.maxExplosionRadius > 0 ? `${Math.round(m.maxExplosionRadius)} px` : '—',
      },
    ],
    [],
  )
}

function scoreMobility(feat: FeatureCounts): ArchetypeScore {
  // Digging OR movement is most of the value; having both → top tier.
  const score = 60 * Math.min(1, feat.DIG) + 60 * Math.min(1, feat.MOBILITY)
  const reasons: string[] = []
  if (feat.DIG) reasons.push(`digs (${feat.DIG} spell${feat.DIG > 1 ? 's' : ''})`)
  if (feat.MOBILITY) reasons.push(`mobility (${feat.MOBILITY})`)
  if (!feat.DIG && !feat.MOBILITY) reasons.push('no digging or movement spells')
  return mk(
    'MOBILITY',
    score,
    [
      { label: 'Digging', value: feat.DIG ? `yes (${feat.DIG})` : 'no' },
      { label: 'Movement', value: feat.MOBILITY ? `yes (${feat.MOBILITY})` : 'no' },
    ],
    reasons,
  )
}

function scoreDefensive(feat: FeatureCounts): ArchetypeScore {
  const score = 70 * Math.min(1, feat.DEFENSIVE) + 30 * Math.min(1, feat.HOMING)
  const reasons: string[] = []
  if (feat.DEFENSIVE) reasons.push(`defensive (${feat.DEFENSIVE})`)
  if (!feat.DEFENSIVE) reasons.push('no shields or protective fields')
  return mk(
    'DEFENSIVE',
    score,
    [
      { label: 'Defensive spells', value: String(feat.DEFENSIVE) },
      { label: 'Homing', value: feat.HOMING ? 'yes' : 'no' },
    ],
    reasons,
  )
}

/** Score one wand across every archetype (rich per-archetype, never collapsed). */
export function scoreWand(wand: Wand, ev: WandEval): Record<Archetype, ArchetypeScore> {
  const m = ev.metrics
  const feat = deckFeatureCounts(wand)
  return {
    DAMAGE: scoreDamage(m),
    SPAM: scoreSpam(m),
    AOE: scoreAoe(m),
    MOBILITY: scoreMobility(feat),
    DEFENSIVE: scoreDefensive(feat),
  }
}
