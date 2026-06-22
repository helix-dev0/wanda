import { useMemo, useState } from 'react'
import type { Wand, PerkRef } from '../schema/snapshot'
import type { Archetype } from '../analysis'
import { tierListView } from './tierListViewModel'
import { ArchetypeBoard } from './ArchetypeBoard'

/**
 * M4-T4 — the per-archetype tier list for the held wands. A segmented archetype
 * selector (tabs) over one rich ranked column each, on the same single page (no
 * pagination). Drops into App's "Best Builds" slot. Generated builds (M5) will
 * join the same columns.
 */
export function TierListPanel({
  wands,
  perks,
  pool,
}: {
  wands: readonly Wand[]
  perks: readonly PerkRef[]
  pool: ReadonlySet<string>
}) {
  const view = useMemo(() => tierListView(wands, perks, pool), [wands, perks, pool])
  const [active, setActive] = useState<Archetype>('DAMAGE')

  if (view.empty) {
    return <p className="empty-note">No held wand to rank in this capture.</p>
  }

  const column = view.columns.find((c) => c.archetype === active) ?? view.columns[0]

  return (
    <section className="tier-list">
      <div className="archetype-tabs" role="tablist" aria-label="Archetype">
        {view.columns.map((c) => (
          <button
            key={c.archetype}
            type="button"
            role="tab"
            aria-selected={c.archetype === active}
            className={`archetype-tab${c.archetype === active ? ' active' : ''}`}
            onClick={() => setActive(c.archetype)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ArchetypeBoard column={column} />

      {view.approximate && (
        <p className="cast-approx-note">
          ≈ scores are approximate — DPS is raw HP, neutral resistances, single-hit, no crit.
        </p>
      )}
    </section>
  )
}
