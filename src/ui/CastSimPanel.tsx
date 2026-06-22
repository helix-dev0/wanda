import type { Wand } from '../schema/snapshot'
import { castView } from './castViewModel'
import { MetricsPanel } from './MetricsPanel'
import { CastTree } from './CastTree'

/** "What this wand actually does": simulated cast metrics + the cast tree for one
 *  held wand. Precursor to the M4/M5 ranked tier list that will own this slot. */
export function CastSimPanel({ wand }: { wand: Wand }) {
  const v = castView(wand)

  return (
    <section className="wand-panel cast-sim">
      <header className="wand-header">
        <span className="sigil" aria-hidden="true">
          ✶
        </span>
        <h2>{v.title}</h2>
      </header>

      {v.empty ? (
        <p className="empty-note">This wand fires nothing (empty deck).</p>
      ) : (
        <>
          <MetricsPanel metrics={v.metrics} />
          <CastTree shots={v.shots} />
          <p className="cast-approx-note">
            {v.missingSpells.length > 0 && (
              <span className="cast-warn">
                Unknown spell{v.missingSpells.length > 1 ? 's' : ''}: {v.missingSpells.join(', ')}.{' '}
              </span>
            )}
            ≈ damage is approximate — raw HP, neutral resistances, single-hit, no crit.
          </p>
        </>
      )}
    </section>
  )
}
