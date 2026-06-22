import type { CastNodeView, CastShotView } from './castViewModel'
import { SpellTile } from './SpellTile'

/** One projectile in the cast: its type-coloured rune, a ×N badge when the
 *  engine grouped identical projectiles, and any trigger payload nested below. */
function CastNode({ node }: { node: CastNodeView }) {
  return (
    <div className="cast-node">
      <div className="cast-tile">
        <SpellTile tile={node.tile} />
        {node.count > 1 && <span className="cast-count">×{node.count}</span>}
      </div>
      {node.children.length > 0 && (
        <div className="cast-children">
          <span className="cast-trigger-label" aria-label="triggers">
            ⮡ triggers
          </span>
          <div className="deck">
            {node.children.map((c) => (
              <CastNode key={c.key} node={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** The fire-until-reload cycle: each cast (shot) as a row of projectile runes. */
export function CastTree({ shots }: { shots: CastShotView[] }) {
  return (
    <div className="cast-tree">
      {shots.map((shot) => (
        <div className="deck-group" key={shot.index}>
          <span className="deck-label">
            Cast {shot.index}
            {shot.manaDrain != null && shot.manaDrain > 0 ? ` · ${Math.round(shot.manaDrain)} mana` : ''}
          </span>
          <div className="deck">
            {shot.projectiles.length === 0 ? (
              <span className="empty-note">no projectiles</span>
            ) : (
              shot.projectiles.map((n) => <CastNode key={n.key} node={n} />)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
