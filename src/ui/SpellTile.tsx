import type { SpellTileModel } from './viewModel'

/** One deck slot: an empty socket, or a spell rune coloured by its action type
 *  (Noita's spell-card convention). Thin — all logic lives in `spellTile()`. */
export function SpellTile({ tile }: { tile: SpellTileModel }) {
  if (tile.empty) {
    return <div className="spell-tile empty" aria-label="empty slot" />
  }

  const title = [
    tile.name,
    tile.typeName ?? 'unknown type',
    tile.mana !== null ? `${tile.mana} mana` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`spell-tile ${tile.typeClass}`} title={title}>
      {tile.alwaysCast && <span className="spell-ac" title="always cast">AC</span>}
      <span className="spell-name">{tile.name}</span>
      {tile.mana !== null && <span className="spell-mana">{tile.mana}</span>}
    </div>
  )
}
