import type { Wand } from '../schema/snapshot'
import { wandStatRows, spellTile } from './viewModel'
import { SpellTile } from './SpellTile'

/** One wand as a carved stone-tablet panel: title, stat grid, optional
 *  always-cast row, and the ordered deck of spell runes (empties included).
 *  `active` marks the currently-held wand among several carried wands. */
export function WandPanel({ wand, active = false }: { wand: Wand; active?: boolean }) {
  const rows = wandStatRows(wand)

  return (
    <section className={`wand-panel${active ? ' active' : ''}`}>
      <header className="wand-header">
        <span className="sigil" aria-hidden="true">❖</span>
        <h2>Wand · slot {wand.slot}</h2>
        {active && <span className="held-badge" title="currently held">● held</span>}
      </header>

      <div className="wand-stats">
        {rows.map((r) => (
          <div className="stat-row" key={r.key}>
            <span className="stat-label">{r.label}</span>
            <span className="stat-value">{r.value}</span>
          </div>
        ))}
      </div>

      {wand.always_cast.length > 0 && (
        <div className="deck-group">
          <span className="deck-label">Always Cast</span>
          <div className="deck">
            {wand.always_cast.map((id, i) => (
              <SpellTile key={`ac-${i}`} tile={spellTile(id, { alwaysCast: true })} />
            ))}
          </div>
        </div>
      )}

      <div className="deck-group">
        <span className="deck-label">Deck · {wand.spells.length} slots</span>
        <div className="deck">
          {wand.spells.map((id, i) => (
            <SpellTile key={i} tile={spellTile(id)} />
          ))}
        </div>
      </div>
    </section>
  )
}
