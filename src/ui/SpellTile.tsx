/* eslint-disable react-hooks/refs -- Floating UI's refs.setReference/setFloating are
   callback refs that are applied during render by design (its documented API); the
   react-hooks/refs rule false-positives on this correct usage. */
import { FloatingPortal } from '@floating-ui/react'
import type { SpellTileModel } from './viewModel'
import { useTooltip } from './useTooltip'
import { GameTooltip } from './GameTooltip'
import { spellTooltipData } from './loc'

/** One spell card: an empty socket, or a spell coloured by its action type
 *  (Noita's spell-card convention) with its real game icon when sprite bytes are
 *  present, else the spell name as text. Hovering shows the in-game-style tooltip
 *  (real name + type + mana/uses + description). Thin — data logic lives in
 *  `spellTile()` / `spellTooltipData()`. */
export function SpellTile({ tile }: { tile: SpellTileModel }) {
  const tt = useTooltip()

  if (tile.empty) {
    return <div className="spell-tile empty" aria-label="empty slot" />
  }

  return (
    <>
      <div
        ref={tt.refs.setReference}
        {...tt.getReferenceProps()}
        className={`spell-tile ${tile.typeClass}`}
        tabIndex={0}
      >
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

      {tt.open && tile.id && (
        <FloatingPortal>
          <div
            ref={tt.refs.setFloating}
            style={tt.floatingStyles}
            {...tt.getFloatingProps()}
            className="tooltip-layer"
          >
            <GameTooltip data={spellTooltipData(tile.id)} icon={tile.spriteSrc} typeClass={tile.typeClass} />
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
