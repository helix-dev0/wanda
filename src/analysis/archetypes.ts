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

/** Reference points where a single signal reaches ~63/100. Provisional. */
const REF = {
  sustainedDps: 150,
  burstDps: 400,
  projPerSec: 8,
  aoeRadius: 60,
  projPerCycle: 12,
} as const

/** Multipliers applied when the wand can't sustain fire (the near-gate). */
const MANA_PENALTY = { damage: 0.6, spam: 0.35 } as const

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

function scoreDamage(m: WandMetrics): ArchetypeScore {
  let score = 0.7 * sat(m.sustainedDps, REF.sustainedDps) + 0.3 * sat(m.burstDps, REF.burstDps)
  const reasons: string[] = []
  if (!m.manaSustainable) {
    score *= MANA_PENALTY.damage
    reasons.push('mana-limited — damage falls off under sustained fire')
  }
  return mk(
    'DAMAGE',
    score,
    [
      { label: 'Sustained DPS', value: hp(m.sustainedDps) },
      { label: 'Burst DPS', value: hp(m.burstDps) },
    ],
    reasons,
  )
}

function scoreSpam(m: WandMetrics): ArchetypeScore {
  let score = sat(m.projectilesPerSecond, REF.projPerSec)
  const reasons: string[] = []
  if (!m.manaSustainable) {
    score *= MANA_PENALTY.spam
    reasons.push('not mana-sustainable — a spammer must fire continuously')
  } else if (m.secondsUntilStall === null) {
    reasons.push('fires indefinitely')
  }
  return mk(
    'SPAM',
    score,
    [
      { label: 'Projectiles/s', value: m.projectilesPerSecond.toFixed(1) },
      { label: 'Mana', value: m.manaSustainable ? 'sustainable' : 'stalls' },
    ],
    reasons,
  )
}

function scoreAoe(m: WandMetrics): ArchetypeScore {
  // Radius-dominant: crowd clear is fundamentally about blast size, with a small
  // bonus for spraying many projectiles.
  const score =
    0.8 * sat(m.maxExplosionRadius, REF.aoeRadius) + 0.2 * sat(m.projectilesPerCycle, REF.projPerCycle)
  return mk(
    'AOE',
    score,
    [
      {
        label: 'Blast radius',
        value: m.maxExplosionRadius > 0 ? `${Math.round(m.maxExplosionRadius)} px` : '—',
      },
      { label: 'Projectiles/cycle', value: String(m.projectilesPerCycle) },
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
