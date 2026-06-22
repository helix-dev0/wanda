/* eslint-disable react-hooks/refs -- Floating UI's refs.setReference/setFloating are
   callback refs that are applied during render by design (its documented API); the
   react-hooks/refs rule false-positives on this correct usage. */
import { FloatingPortal } from '@floating-ui/react'
import type { PerkRef } from '../schema/snapshot'
import { perkDisplayName, perkSpriteSrc } from '../data/perkDb'
import { perkTooltipData } from './loc'
import { useTooltip } from './useTooltip'
import { GameTooltip } from './GameTooltip'

/** One acquired perk as a chip with its real game icon; hovering shows the
 *  in-game-style tooltip (real name + description). */
export function PerkChip({ perk }: { perk: PerkRef }) {
  const tt = useTooltip()
  const icon = perkSpriteSrc(perk.id)

  return (
    <>
      <span ref={tt.refs.setReference} {...tt.getReferenceProps()} className="perk-chip" tabIndex={0}>
        {icon && <img className="perk-icon" src={icon} alt="" width={20} height={20} />}
        {perkDisplayName(perk.id)}
        {perk.stacks > 1 && <b> ×{perk.stacks}</b>}
      </span>

      {tt.open && (
        <FloatingPortal>
          <div
            ref={tt.refs.setFloating}
            style={tt.floatingStyles}
            {...tt.getFloatingProps()}
            className="tooltip-layer"
          >
            <GameTooltip data={perkTooltipData(perk.id)} icon={icon} />
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
