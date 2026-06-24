import { useMemo, useState } from 'react'
import type { Wand, PerkRef } from '../schema/snapshot'
import type { ProvenanceEntry } from '../store/runStore'
import type { Archetype } from '../analysis'
import { tierListView } from './tierListViewModel'
import { ArchetypeBoard } from './ArchetypeBoard'
import { DialControl } from './DialControl'
import { useUiStore } from './useUiStore'
import { uiStore } from '../store/uiStore'

/**
 * M4-T4 / M5-T4 — the per-archetype tier list under the guidance dial. A segmented
 * archetype selector over one rich ranked column each (held wands + generated
 * builds), on the same single page (no pagination). The dial (global rung +
 * per-card drill) and generation results come from uiStore; the worker fills
 * uiStore.gen via useGeneration (mounted in App).
 */
export function TierListPanel({
  wands,
  perks,
  pool,
  provenance,
  caps,
}: {
  wands: readonly Wand[]
  perks: readonly PerkRef[]
  pool: ReadonlySet<string>
  provenance: ReadonlyMap<string, ProvenanceEntry>
  caps: ReadonlyMap<string, number>
}) {
  const rung = useUiStore((s) => s.rung)
  const drilled = useUiStore((s) => s.drilled)
  const generated = useUiStore((s) => s.gen.builds)
  const genStatus = useUiStore((s) => s.gen.status)
  const [active, setActive] = useState<Archetype>('DAMAGE')

  const view = useMemo(
    () => tierListView(wands, perks, pool, { generated, provenance, rung, drilled, caps }),
    [wands, perks, pool, generated, provenance, rung, drilled, caps],
  )

  const column = view.columns.find((c) => c.archetype === active) ?? view.columns[0]

  return (
    <section className="tier-list">
      <DialControl />
      {genStatus === 'error' && <p className="gen-error">build generation failed — see console</p>}

      {/* The board is wrapped so the recompute loader can overlay it WITHOUT shifting layout:
          when builds reload (switch wand / pick up a spell), the prior builds stay visible
          underneath a dimmed spinner instead of the content flashing like a page reload. */}
      <div className="tier-board-wrap">
        {genStatus === 'loading' && (
          <div className="gen-overlay" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span>recomputing builds…</span>
          </div>
        )}

        {view.empty ? (
          <p className="empty-note">No held wand to rank in this capture.</p>
        ) : (
          <>
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

            {column && (
              <ArchetypeBoard column={column} onDrill={(key) => uiStore.getState().toggleDrill(key)} />
            )}

            {view.approximate && (
              <p className="cast-approx-note">
                ≈ scores are approximate — DPS is raw HP, neutral resistances, single-hit, no crit.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
