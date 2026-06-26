// M4-T4 / M5-T4 — pure view-model for the per-archetype tier list + the guidance
// dial. Mirrors castViewModel: no React/DOM here, so it is unit-tested in node and
// the components stay thin.
//
// Each archetype is a column with bands S/A/B/C/D plus a separate UNSAFE band (the
// user's chosen veto). Held wands are the Mirror baseline, present at every rung;
// GENERATED builds (M5) merge into the SAME bands by their own tier, marked
// distinctly. The dial is a PRESENTATION layer (spec §6.5): the same data is shaped
// by a `reveal` per rung (Mirror→Teach→Suggest→Prescribe), and any single card can
// be drilled to Prescribe-level detail inline — it never re-runs the engine.

import type { Wand, PerkRef } from '../schema/snapshot'
import type { ProvenanceEntry } from '../store/runStore'
import type { Rung } from '../store/uiStore'
import type { AppliedEdit, GenerateResult, PerkAdvice, TemplateId } from '../generation/types'
import { buildProvenance, type ProvenanceLabel } from '../generation/provenance'
import { templateWhy } from '../generation/copy'
import { spellTile, activeWand, resolveWandSpriteSrc, type SpellTileModel } from './viewModel'
import { analyzeWands, ARCHETYPES, type Archetype, type Tier } from '../analysis'
import { suggestEdits, type Suggestion } from '../analysis/suggestions'
import type { Hazard } from '../analysis/selfDanger'

export type BandKey = Tier | 'UNSAFE'
const BAND_ORDER: readonly BandKey[] = ['S', 'A', 'B', 'C', 'D', 'UNSAFE']

const ARCHETYPE_LABEL: Record<Archetype, string> = {
  DAMAGE: 'Damage',
  AOE: 'AoE',
  SPAM: 'Spam',
  DIGGING: 'Digging',
}

const TEMPLATE_LABEL: Record<TemplateId, string> = {
  'single-nuke': 'Nuke build',
  'trigger-payload': 'Trigger build',
  'multicast-stack': 'Multicast build',
  'multiplicative-stack': 'Multiplier build',
  'cheap-shot-spam': 'Modifier-spam build',
  spammer: 'Spam build',
  'feature-fill': 'Digging build',
  exhaustive: 'Best from your spells',
}

/** What a given rung reveals on an entry — the dial as data, not a code path. */
export interface Reveal {
  metrics: boolean
  reasons: boolean
  /** mechanic "why" copy (template explanation). */
  teach: boolean
  /** the polish edits that produced a generated build. */
  edits: boolean
  /** per-slot "go grab X" provenance. */
  provenance: boolean
  perkAdvice: boolean
  /** whether generated builds appear in the column at all. */
  generated: boolean
}

const REVEAL: Record<Rung, Reveal> = {
  // Mirror: just your wands + what they do. No advice → no generated builds.
  mirror: { metrics: true, reasons: false, teach: false, edits: false, provenance: false, perkAdvice: false, generated: false },
  // Teach: the most explanation — reasons + the mechanic "why".
  teach: { metrics: true, reasons: true, teach: true, edits: false, provenance: false, perkAdvice: true, generated: true },
  // Suggest: concrete ranked builds + the edits that got there, one-line whys.
  suggest: { metrics: true, reasons: true, teach: false, edits: true, provenance: false, perkAdvice: true, generated: true },
  // Prescribe: terse — the exact build + where to grab each spell. Least prose.
  prescribe: { metrics: false, reasons: false, teach: false, edits: true, provenance: true, perkAdvice: true, generated: true },
}

export interface TierEntryView {
  key: string
  /** Held-wand inventory slot; -1 for a generated build. */
  slot: number
  title: string
  /** The archetype tier this entry earns — shown even when it sits in UNSAFE. */
  tier: Tier
  score: number
  topMetrics: { label: string; value: string }[]
  reasons: string[]
  tiles: SpellTileModel[]
  unsafe: boolean
  /** Perks that would clear the entry's lethal hazards (when unsafe). */
  fixableByPerk: string[]
  source: 'held' | 'generated'
  /** A generated build whose deck already equals the player's HELD wand — i.e. "you've
   *  already built this." Lets the UI highlight it instead of looking like a separate
   *  suggestion. Always false for held entries. */
  matchesHeld?: boolean
  /** For a generated build: which owned wand to rebuild ("rebuild your slot-2 wand ·
   *  cap 19", or "ideal chassis" in theorycraft). Undefined for held-wand entries. */
  chassisLabel?: string
  /** The source wand's real game icon, when available (icon-ready seam; null until
   *  the mod emits per-wand sprites — see resolveWandSpriteSrc). */
  wandSpriteSrc?: string | null
  template?: TemplateId
  /** Mechanic "why" for a generated build (Teach rung). */
  teach?: string
  /** Polish edits applied to a generated build (Suggest/Prescribe rungs). */
  edits?: AppliedEdit[]
  /** Per-slot "go grab X" labels, aligned to `tiles` (Prescribe rung). */
  provenance?: (ProvenanceLabel | null)[]
  perkAdvice?: PerkAdvice
  /** What to reveal for this entry at its effective rung. */
  reveal: Reveal
  /** True when this card is individually drilled to Prescribe detail. */
  drilled: boolean
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
  /** Why this archetype produced no builds (generation note), when applicable. */
  note?: string
}

export interface TierListView {
  empty: boolean
  approximate: boolean
  rung: Rung
  columns: ArchetypeColumnView[]
}

export interface TierListOptions {
  /** Generated builds per archetype (from the worker). */
  generated?: GenerateResult | null
  /** Per-spell origin, for Prescribe's "go grab X" labels. */
  provenance?: ReadonlyMap<string, ProvenanceEntry>
  /** The global guidance rung (default: Suggest). */
  rung?: Rung
  /** wandKeys of cards individually drilled to Prescribe detail. */
  drilled?: ReadonlySet<string>
  /** Per-spell owned copy caps (from `ownedCounts`): a suggested swap never uses a
   *  spell more times than the player owns. Omitted ⇒ unlimited (the M4 behavior). */
  caps?: ReadonlyMap<string, number>
}

const EMPTY_DRILLED: ReadonlySet<string> = new Set()
const EMPTY_PROVENANCE: ReadonlyMap<string, ProvenanceEntry> = new Map()

function suggestionView(s: Suggestion): SuggestionView {
  return { label: s.label, deltaScore: s.deltaScore, fixesHazard: s.fixesHazard }
}

/**
 * Build the full renderable tier list. With no `opts` it reproduces the M4
 * held-wand view (default rung Suggest, no generated builds). The dial layers on
 * top via `opts`.
 */
export function tierListView(
  wands: readonly Wand[],
  perks: readonly PerkRef[],
  pool: ReadonlySet<string>,
  opts: TierListOptions = {},
): TierListView {
  const rung = opts.rung ?? 'suggest'
  const drilled = opts.drilled ?? EMPTY_DRILLED
  const provenance = opts.provenance ?? EMPTY_PROVENANCE
  const generated = opts.generated ?? null
  const colReveal = REVEAL[rung]

  const hasGenerated =
    generated != null && ARCHETYPES.some((a) => generated[a].builds.length > 0)
  if (wands.length === 0 && !hasGenerated) {
    return { empty: true, approximate: false, rung, columns: [] }
  }

  const revealFor = (key: string): { reveal: Reveal; drilled: boolean } => {
    const d = drilled.has(key)
    return { reveal: d ? REVEAL.prescribe : colReveal, drilled: d }
  }

  const analyses = analyzeWands(wands, perks)

  const heldEntry = (wand: Wand, i: number, archetype: Archetype): TierEntryView => {
    const a = analyses[i]
    const s = a.scores[archetype]
    const { reveal, drilled: d } = revealFor(a.key)
    return {
      key: a.key,
      slot: wand.slot,
      title: wand === primary ? 'Held wand' : `Wand · slot ${wand.slot}`,
      tier: s.tier,
      score: s.score,
      topMetrics: s.topMetrics,
      reasons: s.reasons,
      tiles: wand.spells.map((id) => spellTile(id)),
      unsafe: a.selfDanger.unsafe,
      fixableByPerk: a.selfDanger.fixableByPerk,
      source: 'held',
      provenance: buildProvenance(wand.spells, provenance),
      reveal,
      drilled: d,
    }
  }

  const generatedEntry = (
    build: GenerateResult[Archetype]['builds'][number],
    archetype: Archetype,
  ): TierEntryView => {
    const s = build.analysis.scores[archetype]
    const key = `gen:${build.analysis.key}`
    const { reveal, drilled: d } = revealFor(key)
    return {
      key,
      slot: -1,
      title: `✦ ${TEMPLATE_LABEL[build.template]}`,
      tier: s.tier,
      score: s.score,
      topMetrics: s.topMetrics,
      reasons: s.reasons,
      tiles: build.wand.spells.map((id) => spellTile(id)),
      unsafe: build.analysis.selfDanger.unsafe,
      fixableByPerk: build.analysis.selfDanger.fixableByPerk,
      source: 'generated',
      matchesHeld: heldKey != null && build.analysis.key === heldKey,
      chassisLabel: build.chassis.ideal
        ? 'ideal chassis'
        : `rebuild your slot-${build.chassis.slot} wand · cap ${build.chassis.capacity}`,
      wandSpriteSrc: resolveWandSpriteSrc(build.wand),
      template: build.template,
      teach: templateWhy(build.template),
      edits: build.edits,
      provenance: buildProvenance(build.wand.spells, provenance),
      perkAdvice: build.perkAdvice,
      reveal,
      drilled: d,
    }
  }

  const primary = activeWand(wands)
  // The held wand's stable key (excludes slot/mana), to flag a generated build that
  // already equals it. analyses is parallel to wands, so reuse its computed key.
  const heldKey = primary ? analyses[wands.indexOf(primary)]?.key : undefined
  const showSuggestions = (rung === 'teach' || rung === 'suggest') && primary != null

  const columns: ArchetypeColumnView[] = ARCHETYPES.map((archetype) => {
    const held = wands.map((w, i) => heldEntry(w, i, archetype))
    const gen =
      colReveal.generated && generated
        ? generated[archetype].builds.map((b) => generatedEntry(b, archetype))
        : []
    const entries = [...held, ...gen]

    const bands: BandView[] = BAND_ORDER.flatMap((band) => {
      const inBand =
        band === 'UNSAFE'
          ? entries.filter((e) => e.unsafe)
          : entries.filter((e) => !e.unsafe && e.tier === band)
      if (band === 'UNSAFE' && inBand.length === 0) return []
      return [{ band, entries: inBand.sort((a, b) => b.score - a.score) }]
    })

    return {
      archetype,
      label: ARCHETYPE_LABEL[archetype],
      bands,
      suggestions:
        showSuggestions && primary
          ? suggestEdits(primary, archetype, pool, perks, opts.caps).map(suggestionView)
          : [],
      note: colReveal.generated ? generated?.[archetype].note : undefined,
    }
  })

  return {
    empty: false,
    approximate: analyses.some((a) => a.approximate),
    rung,
    columns,
  }
}
