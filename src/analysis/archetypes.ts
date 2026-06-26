// scoring-v2 — archetype scoring grounded in expected time-to-kill (TTK) vs cited
// reference enemies (docs/scoring-model-v2-spec.md §5). DAMAGE/AOE/SPAM are combat
// archetypes (overlap is intentional — a great wand legitimately tops several); DIGGING is
// capability × sustainability. Output is rich PER ARCHETYPE — never one collapsed score.
//
// Tiering is ABSOLUTE: the band cutoffs come from enemy HP + encounter cadence (ttk.ts),
// NOT relative-within-pool and NEVER from human wand tiers (#9). The cutoffs are provisional
// (method fixed, meta-expert tunes the numbers at S6). MOBILITY is a capability flag on the
// analysis (index.ts), not a tiered archetype; DEFENSIVE was dropped ("not a wand thing").

import type { Wand } from '../schema/snapshot'
import type { WandMetrics } from '../sim/metrics'
import type { WandEval } from './simCache'
import {
  ttkAgainst,
  aoeClearSeconds,
  spamKillRate,
  scoreFromTtk,
  scoreFromScalar,
  type FocusFactors,
  DAMAGE_BANDS_MID,
  DAMAGE_BANDS_BOSS,
  AOE_BANDS,
  SPAM_RATE_BANDS,
} from './ttk'
import { REFERENCE_ENEMIES } from './referenceEnemies'
import { digScore, DIG_BANDS } from './digging'

export const ARCHETYPES = ['DAMAGE', 'AOE', 'SPAM', 'DIGGING'] as const
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
const secs = (n: number) => (Number.isFinite(n) ? `${n.toFixed(1)}s` : '∞')

/** Spread (°) at which the single-target on-target fraction halves — kept from v1 (§5.3:
 *  the spread→on-target factor stays for single-target accuracy). */
const SPREAD_HALF_DEG = 20

/** Single-target focusing: a tight wand keeps its DPS on one point; a wide / close-range
 *  one doesn't. AOE/SPAM apply this differently (AOE not at all — §5.3). */
function focusFactors(m: WandMetrics): FocusFactors {
  return {
    onTarget: SPREAD_HALF_DEG / (SPREAD_HALF_DEG + Math.max(0, m.effectiveSpread)),
    reach: m.reachUsability,
  }
}

/** "fire+poison" etc. from the DoT capability flags, or '' if none apply. */
function dotLabel(d: WandMetrics['appliesDot']): string {
  const parts: string[] = []
  if (d.fire) parts.push('fire')
  if (d.poison) parts.push('poison')
  if (d.toxic) parts.push('toxic')
  return parts.join('+')
}

/** DAMAGE — single tough target. Expected TTK vs the mid bruiser (Isohiisi 150) AND the
 *  boss (Ylialkemisti 1000); the boss anchor discriminates the top end (most strong wands
 *  one-shot the mid bruiser). Burst folds into TTK (a fast kill = low TTK), so there is no
 *  separate inflatable burst term. */
function scoreDamage(m: WandMetrics): ArchetypeScore {
  const f = focusFactors(m)
  const ttkMid = ttkAgainst(m, REFERENCE_ENEMIES.midBruiser.hp, f)
  const ttkBoss = ttkAgainst(m, REFERENCE_ENEMIES.bossSponge.hp, f)
  const score =
    0.4 * scoreFromTtk(ttkMid, DAMAGE_BANDS_MID) + 0.6 * scoreFromTtk(ttkBoss, DAMAGE_BANDS_BOSS)
  const reasons: string[] = []
  if (f.reach < 0.9 && m.sustainedDps > 0) {
    reasons.push(`close range — only ~${Math.round(f.reach * 100)}% of its damage reaches a ranged target`)
  }
  if (m.effectiveSpread > 8) {
    reasons.push(`wide spread (${m.effectiveSpread.toFixed(0)}°) — sprays off a single target`)
  }
  if (m.effectiveSustainedDps < m.sustainedDps - 1) {
    reasons.push(`mana-limited — sustains ~${m.effectiveSustainedDps.toFixed(0)} of ${m.sustainedDps.toFixed(0)} HP/s under continuous fire`)
  }
  const dot = dotLabel(m.appliesDot)
  if (dot) reasons.push(`applies ${dot} DoT — softens tanky / boss targets`)
  return mk(
    'DAMAGE',
    score,
    [
      { label: 'Kill · Big Hiisi', value: secs(ttkMid) },
      { label: 'Kill · boss', value: secs(ttkBoss) },
    ],
    reasons,
  )
}

/** AOE — clear a swarm. Time to clear a reference swarm of weak mobs (Haulikkohiisi 22.5):
 *  one cast clears explosion-radius mobs + penetrating-projectile mobs + per-projectile
 *  direct kills. Spread/range do NOT gate AOE (a blast clears a cluster regardless). */
function scoreAoe(m: WandMetrics): ArchetypeScore {
  const clear = aoeClearSeconds(m)
  const score = scoreFromTtk(clear, AOE_BANDS)
  const reasons: string[] = []
  if (m.pierceHitHP > 0 && m.pierceReachPx > 0) {
    reasons.push('penetrates — one shot hits several enemies along its path')
  }
  if (m.maxExplosionDamage > 0) reasons.push(`explosive blast (${m.maxExplosionDamage.toFixed(0)} HP)`)
  return mk(
    'AOE',
    score,
    [
      { label: 'Clear a swarm', value: secs(clear) },
      { label: 'Blast', value: m.maxExplosionDamage > 0 ? hp(m.maxExplosionDamage) : '—' },
    ],
    reasons,
  )
}

/** SPAM — sustained, mana-holdable. The sustainable weak-mob kill-rate (mobs/sec you can
 *  fire indefinitely); hard-gated by mana (effectiveSustainedDps self-throttles a wand that
 *  can't pay for its fire). "DAMAGE you can hold forever, spread-tolerant." */
function scoreSpam(m: WandMetrics): ArchetypeScore {
  const rate = spamKillRate(m)
  const score = scoreFromScalar(rate, SPAM_RATE_BANDS)
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
      { label: 'Kills/s · weak mob', value: rate.toFixed(1) },
      { label: 'Mana', value: m.manaSustainable ? 'sustainable' : 'stalls' },
    ],
    reasons,
  )
}

/** DIGGING — capability (max durability tier the deck breaks, 0–14) × sustainability (can
 *  it dig continuously). The good complex diggers (Black Hole) are exactly the hard-to-
 *  sustain ones. Gold-preservation is a displayed caveat, never scored. */
function scoreDigging(wand: Wand, m: WandMetrics): ArchetypeScore {
  const ds = digScore(wand, m)
  const score = scoreFromScalar(ds.scalar, DIG_BANDS)
  const reasons: string[] = []
  if (ds.capability === 0) {
    reasons.push('no digging spell')
  } else {
    if (!m.manaSustainable) reasons.push('high mana cost — can’t dig continuously without a refresh loop')
    reasons.push('note: drilling / explosions may destroy gold')
  }
  return mk(
    'DIGGING',
    score,
    [
      { label: 'Dig tier', value: ds.capability > 0 ? `${ds.capability}/14` : '—' },
      { label: 'Sustain', value: ds.capability > 0 ? (m.manaSustainable ? 'continuous' : 'limited') : '—' },
    ],
    reasons,
  )
}

/** Score one wand across every archetype (rich per-archetype, never collapsed). */
export function scoreWand(wand: Wand, ev: WandEval): Record<Archetype, ArchetypeScore> {
  const m = ev.metrics
  return {
    DAMAGE: scoreDamage(m),
    AOE: scoreAoe(m),
    SPAM: scoreSpam(m),
    DIGGING: scoreDigging(wand, m),
  }
}
