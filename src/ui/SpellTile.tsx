import type { SpellTileModel } from './viewModel'

/** One spell card: an empty socket, or a spell coloured by its action type
 *  (Noita's spell-card convention). Renders the real game icon when sprite bytes
 *  are available (see resolveSpriteSrc), else the spell name as text. Thin — all
 *  logic lives in `spellTile()`. */
export function SpellTile({ tile }: { tile: SpellTileModel }) {
  if (tile.empty) {
    return <div className="spell-tile empty" aria-label="empty slot" />
  }

  const title = [
    tile.name,
    tile.typeName ?? 'unknown type',
    tile.mana !== null ? `${tile.mana} mana` : null,
    tile.usesRemaining !== null ? `${tile.usesRemaining} uses left` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`spell-tile ${tile.typeClass}`} title={title}>
      {tile.usesRemaining !== null && (
        <span className="spell-uses" title="charges left">
          ×{tile.usesRemaining}
        </span>
      )}
      {tile.alwaysCast && (
        <span className="spell-ac" title="always cast">
          AC
        </span>
      )}
      {tile.spriteSrc ? (
        <img className="spell-icon" src={tile.spriteSrc} alt={tile.name} width={28} height={28} />
      ) : (
        <span className="spell-name">{tile.name}</span>
      )}
      {tile.mana !== null && <span className="spell-mana">{tile.mana}</span>}
    </div>
  )
}
