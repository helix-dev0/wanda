import { SpellTile } from './SpellTile'
import type {
  ArchetypeColumnView,
  BandView,
  SuggestionView,
  TierEntryView,
} from './tierListViewModel'

/** One archetype's ranked S/A/B/C/D (+ Unsafe) ladder, plus its suggestions feed. */
export function ArchetypeBoard({ column }: { column: ArchetypeColumnView }) {
  return (
    <div className="archetype-board">
      <div className="tier-bands">
        {column.bands.map((b) => (
          <TierBand key={b.band} band={b} />
        ))}
      </div>
      <SuggestionsFeed suggestions={column.suggestions} archetype={column.label} />
    </div>
  )
}

function TierBand({ band }: { band: BandView }) {
  const unsafe = band.band === 'UNSAFE'
  return (
    <div className={`tier-band${unsafe ? ' unsafe' : ''}`}>
      <span className={`tier-badge tier-${band.band}`}>{unsafe ? '⚠' : band.band}</span>
      <div className="tier-entries">
        {band.entries.length === 0 ? (
          <span className="tier-empty">—</span>
        ) : (
          band.entries.map((e) => <TierEntry key={e.key} entry={e} />)
        )}
      </div>
    </div>
  )
}

function TierEntry({ entry }: { entry: TierEntryView }) {
  return (
    <div className={`tier-entry${entry.unsafe ? ' unsafe' : ''}`}>
      <div className="tier-entry-head">
        <span className="tier-entry-title">{entry.title}</span>
        <span className="tier-entry-score" title="archetype score (0–100)">
          {entry.score}
        </span>
        {entry.unsafe && (
          <span className="danger-chip">
            ⚠ unsafe
            {entry.fixableByPerk.length > 0 && <> — take {entry.fixableByPerk.join(', ')}</>}
          </span>
        )}
      </div>
      <div className="tier-entry-metrics">
        {entry.topMetrics.map((m) => (
          <span key={m.label} className="tier-metric">
            <span className="tm-label">{m.label}</span> {m.value}
          </span>
        ))}
        {entry.unsafe && <span className="would-be">would be {entry.tier}-tier if safe</span>}
      </div>
      <div className="tier-deck">
        {entry.tiles.map((t, i) => (
          <SpellTile key={`${entry.key}-${i}`} tile={t} />
        ))}
      </div>
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
