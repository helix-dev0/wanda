import { SpellTile } from './SpellTile'
import type {
  ArchetypeColumnView,
  BandView,
  SuggestionView,
  TierEntryView,
} from './tierListViewModel'

/** One archetype's ranked S/A/B/C/D (+ Unsafe) ladder — held wands and generated
 *  builds in the same bands — plus its suggestions feed. The dial's reveal flags on
 *  each entry decide how much detail to show; `onDrill` toggles a card to Prescribe. */
export function ArchetypeBoard({
  column,
  onDrill,
}: {
  column: ArchetypeColumnView
  onDrill: (key: string) => void
}) {
  return (
    <div className="archetype-board">
      <div className="tier-bands">
        {column.bands.map((b) => (
          <TierBand key={b.band} band={b} onDrill={onDrill} />
        ))}
      </div>
      {column.note && <p className="tier-note">{column.note}</p>}
      <SuggestionsFeed suggestions={column.suggestions} archetype={column.label} />
    </div>
  )
}

function TierBand({ band, onDrill }: { band: BandView; onDrill: (key: string) => void }) {
  const unsafe = band.band === 'UNSAFE'
  return (
    <div className={`tier-band${unsafe ? ' unsafe' : ''}`}>
      <span className={`tier-badge tier-${band.band}`}>{unsafe ? '⚠' : band.band}</span>
      <div className="tier-entries">
        {band.entries.length === 0 ? (
          <span className="tier-empty">—</span>
        ) : (
          band.entries.map((e) => <TierEntry key={e.key} entry={e} onDrill={onDrill} />)
        )}
      </div>
    </div>
  )
}

function TierEntry({ entry, onDrill }: { entry: TierEntryView; onDrill: (key: string) => void }) {
  const r = entry.reveal
  return (
    <div
      className={`tier-entry${entry.unsafe ? ' unsafe' : ''}${
        entry.source === 'generated' ? ' generated' : ' held'
      }${entry.matchesHeld ? ' matches-held' : ''}`}
    >
      <div className="tier-entry-head">
        {/* Visually separate "your wands" from "build ideas" while keeping them ranked together. */}
        <span className={`source-tag ${entry.source}`}>
          {entry.source === 'held' ? '◈ your wand' : 'build idea'}
        </span>
        <span className="tier-entry-title">{entry.title}</span>
        <span className="tier-entry-score" title="archetype score (0–100)">
          {entry.score}
        </span>
        {entry.matchesHeld && (
          <span className="held-match-chip" title="your held wand already is this build">
            ✓ you have this
          </span>
        )}
        <button
          type="button"
          className="drill-toggle"
          aria-expanded={entry.drilled}
          title={entry.drilled ? 'just a hint' : 'tell me exactly'}
          onClick={() => onDrill(entry.key)}
        >
          {entry.drilled ? '▾' : '▸'} drill
        </button>
        {entry.unsafe && (
          <span className="danger-chip">
            ⚠ unsafe
            {entry.fixableByPerk.length > 0 && <> — take {entry.fixableByPerk.join(', ')}</>}
          </span>
        )}
      </div>

      {entry.chassisLabel && (
        <div className="tier-entry-chassis" title="which wand to rebuild this on">
          {entry.wandSpriteSrc && (
            <img className="chassis-icon" src={entry.wandSpriteSrc} alt="" width={16} height={16} />
          )}
          <span>{entry.chassisLabel}</span>
        </div>
      )}

      {r.metrics && (
        <div className="tier-entry-metrics">
          {entry.topMetrics.map((m) => (
            <span key={m.label} className="tier-metric">
              <span className="tm-label">{m.label}</span> {m.value}
            </span>
          ))}
          {entry.unsafe && <span className="would-be">would be {entry.tier}-tier if safe</span>}
        </div>
      )}

      {r.teach && entry.teach && <p className="entry-teach">{entry.teach}</p>}
      {r.reasons && entry.reasons.length > 0 && (
        <ul className="entry-reasons">
          {entry.reasons.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}

      <div className="tier-deck">
        {entry.tiles.map((t, i) => (
          <div key={`${entry.key}-${i}`} className="deck-slot">
            <SpellTile tile={t} />
            {r.provenance && entry.provenance?.[i] && (
              <span className={`prov-chip prov-${entry.provenance[i]!.kind}`}>
                {entry.provenance[i]!.text}
              </span>
            )}
          </div>
        ))}
      </div>

      {r.edits && entry.edits && entry.edits.length > 0 && (
        <ul className="entry-edits">
          {entry.edits.map((e, i) => (
            <li key={i}>
              <span className="edit-label">{e.label}</span>
              {e.deltaScore > 0 && <span className="edit-delta">+{e.deltaScore}</span>}
            </li>
          ))}
        </ul>
      )}

      {r.perkAdvice && entry.perkAdvice && (
        <p className="entry-perk-advice">
          ⚑ {entry.perkAdvice.reason} <em>{entry.perkAdvice.perks.join(', ')}</em>
        </p>
      )}
    </div>
  )
}

function SuggestionsFeed({
  suggestions,
  archetype,
}: {
  suggestions: SuggestionView[]
  archetype: string
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="suggestions">
      <span className="suggestions-title">✦ Suggestions · {archetype}</span>
      <ul className="suggestion-list">
        {suggestions.map((s, i) => (
          <li key={i} className="suggestion">
            <span className="sugg-label">{s.label}</span>
            {s.deltaScore > 0 && <span className="sugg-delta">+{s.deltaScore}</span>}
            {s.fixesHazard && (
              <span className="sugg-fix">removes {s.fixesHazard.toLowerCase()} self-danger</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
