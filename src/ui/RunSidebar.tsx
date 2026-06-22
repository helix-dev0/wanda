import type { SpellInventoryEntry, PerkRef } from '../schema/snapshot'
import { spellTile } from './viewModel'
import { SpellTile } from './SpellTile'
import { PerkChip } from './PerkChip'

/** The run-state side: the loose spell bag (with use counts), acquired perks,
 *  and the "seen this run" spell pool (M2-T4). Each renders an honest empty
 *  state. Reuses SpellTile + the same theme as the wand panels. */
export function RunSidebar({
  bag,
  perks,
  pool,
}: {
  bag: readonly SpellInventoryEntry[]
  perks: readonly PerkRef[]
  pool: readonly string[]
}) {
  return (
    <>
      <section className="side-card">
        <h3>
          Spell Bag <span className="count">{bag.length}</span>
        </h3>
        {bag.length === 0 ? (
          <p className="empty-note">Empty.</p>
        ) : (
          <div className="deck">
            {bag.map((entry, i) => (
              <SpellTile
                key={`${entry.action_id}-${i}`}
                tile={spellTile(entry.action_id, { usesRemaining: entry.uses_remaining ?? null })}
              />
            ))}
          </div>
        )}
      </section>

      <section className="side-card">
        <h3>
          Perks <span className="count">{perks.length}</span>
        </h3>
        {perks.length === 0 ? (
          <p className="empty-note">None acquired yet.</p>
        ) : (
          <div className="perk-chips">
            {perks.map((perk) => (
              <PerkChip key={perk.id} perk={perk} />
            ))}
          </div>
        )}
      </section>

      <section className="side-card">
        <h3>
          Seen This Run <span className="count">{pool.length}</span>
        </h3>
        {pool.length === 0 ? (
          <p className="empty-note">Nothing seen yet.</p>
        ) : (
          <div className="deck">
            {pool.map((id) => (
              <SpellTile key={id} tile={spellTile(id)} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}
