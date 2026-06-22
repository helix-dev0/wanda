// M4-T4 — pure view-model for the per-archetype tier list. Mirrors castViewModel:
// no React/DOM here, so it is unit-tested in node and the components stay thin.
//
// Each archetype is a column with the bands S/A/B/C/D plus a separate UNSAFE band
// (the user's chosen veto: a self-lethal held wand is banished below the ladder in
// EVERY column, since self-danger is per-wand — but still shows its would-be tier
// and the perk that would fix it). A per-archetype suggestions feed (depth-1 fixes
// for the primary held wand) rides along.

import type { Wand, PerkRef } from '../schema/snapshot'
import { spellTile, type SpellTileModel } from './viewModel'
import { analyzeWands, ARCHETYPES, type Archetype, type Tier } from '../analysis'
import { suggestEdits, type Suggestion } from '../analysis/suggestions'
import type { Hazard } from '../analysis/selfDanger'

export type BandKey = Tier | 'UNSAFE'
const BAND_ORDER: readonly BandKey[] = ['S', 'A', 'B', 'C', 'D', 'UNSAFE']

const ARCHETYPE_LABEL: Record<Archetype, string> = {
  DAMAGE: 'Damage',
  SPAM: 'Spam',
  AOE: 'AoE',
  MOBILITY: 'Mobility',
  DEFENSIVE: 'Defensive',
}

export interface TierEntryView {
  key: string
  slot: number
  title: string
  /** The archetype tier this wand earns — shown even when it sits in UNSAFE. */
  tier: Tier
  score: number
  topMetrics: { label: string; value: string }[]
  reasons: string[]
  tiles: SpellTileModel[]
  unsafe: boolean
  /** Perks that would clear the wand's lethal hazards (when unsafe). */
  fixableByPerk: string[]
}

export interface BandView {
  band: BandKey
  entries: TierEntryView[]
}

export interface SuggestionView {
  label: string
  deltaScore: number
  fixesHazard?: Hazard
}

export interface ArchetypeColumnView {
  archetype: Archetype
  label: string
  bands: BandView[]
  suggestions: SuggestionView[]
}

export interface TierListView {
  empty: boolean
  approximate: boolean
  columns: ArchetypeColumnView[]
}

function suggestionView(s: Suggestion): SuggestionView {
  return { label: s.label, deltaScore: s.deltaScore, fixesHazard: s.fixesHazard }
}

/** Build the full renderable tier list for the held wands. */
export function tierListView(
  wands: readonly Wand[],
  perks: readonly PerkRef[],
  pool: ReadonlySet<string>,
): TierListView {
  if (wands.length === 0) {
    return { empty: true, approximate: false, columns: [] }
  }

  const analyses = analyzeWands(wands, perks)

  const entriesFor = (archetype: Archetype): TierEntryView[] =>
    wands.map((w, i) => {
      const a = analyses[i]
      const s = a.scores[archetype]
      return {
        key: a.key,
        slot: w.slot,
        title: w.slot === 0 ? 'Held wand' : `Wand · slot ${w.slot}`,
        tier: s.tier,
        score: s.score,
        topMetrics: s.topMetrics,
        reasons: s.reasons,
        tiles: w.spells.map((id) => spellTile(id)),
        unsafe: a.selfDanger.unsafe,
        fixableByPerk: a.selfDanger.fixableByPerk,
      }
    })

  // The primary held wand (slot 0 if present) drives the suggestions feed.
  const primary = wands.find((w) => w.slot === 0) ?? wands[0]

  const columns: ArchetypeColumnView[] = ARCHETYPES.map((archetype) => {
    const entries = entriesFor(archetype)
    const bands: BandView[] = BAND_ORDER.flatMap((band) => {
      const inBand =
        band === 'UNSAFE'
          ? entries.filter((e) => e.unsafe)
          : entries.filter((e) => !e.unsafe && e.tier === band)
      // Always render the S–D ladder (even empty); show UNSAFE only when populated.
      if (band === 'UNSAFE' && inBand.length === 0) return []
      return [{ band, entries: inBand.sort((a, b) => b.score - a.score) }]
    })
    return {
      archetype,
      label: ARCHETYPE_LABEL[archetype],
      bands,
      suggestions: suggestEdits(primary, archetype, pool, perks).map(suggestionView),
    }
  })

  return {
    empty: false,
    approximate: analyses.some((a) => a.approximate),
    columns,
  }
}
