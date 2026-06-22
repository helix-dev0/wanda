import type { TooltipData } from './loc'

/** The Noita-style hover card: icon + name (type-coloured) + type/stats +
 *  description. Pure presentation; the floating positioning is the caller's. */
export function GameTooltip({
  data,
  icon,
  typeClass,
}: {
  data: TooltipData
  icon?: string | null
  /** Spell action-type class (projectile/modifier/…) for the name colour. */
  typeClass?: string
}) {
  return (
    <div className={`game-tooltip${typeClass ? ` ${typeClass}` : ''}`}>
      <div className="gt-head">
        {icon && <img className="gt-icon" src={icon} alt="" width={28} height={28} />}
        <span className="gt-name">{data.name}</span>
      </div>

      {(data.typeName || data.meta.length > 0) && (
        <div className="gt-meta">
          {data.typeName && <span className="gt-type">{data.typeName.replace(/_/g, ' ').toLowerCase()}</span>}
          {data.meta.map((m) => (
            <span key={m.label} className="gt-stat">
              <span className="gt-stat-label">{m.label}</span> {m.value}
            </span>
          ))}
        </div>
      )}

      {data.description && <p className="gt-desc">{data.description}</p>}
    </div>
  )
}
