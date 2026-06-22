import { useEffect, useMemo } from 'react'
import { ownedCounts, runStore } from './store/runStore'
import { useRunStore } from './ui/useRunStore'
import { demoRun } from './data/demoRun'
import { WandPanel } from './ui/WandPanel'
import { activeWand } from './ui/viewModel'
import { RunSidebar } from './ui/RunSidebar'
import { CastSimPanel } from './ui/CastSimPanel'
import { TierListPanel } from './ui/TierListPanel'
import { useGeneration } from './ui/useGeneration'
import { isLive, startLive } from './bridge/startLive'
import { SnapshotSettings } from './ui/SnapshotSettings'

/**
 * M2 live-mirror dashboard. Everything visible on one page — current wand(s) on
 * the left, the run-state side (bag / perks / seen-this-run pool) on the right —
 * no pagination. The ranked "best builds" tier list (M4/M5, needs the simulator
 * + analysis) drops into the marked slot on this same page.
 *
 * Data source is the recorded fixtures (the fixture-driven default; the live
 * bridge replaces this at M1-T5). The whole run is applied so the seen-this-run
 * pool is complete and the current wand is the latest capture. `?capture=N` is a
 * dev/verification override to view an earlier capture (e.g. the null-slot wand).
 */
function App() {
  useEffect(() => {
    // Live mode: Tauri file-watch in the packaged app, WS bridge in browser dev
    // (VITE_LIVE=1). Default in a plain browser: replay the recorded fixtures.
    if (isLive()) {
      runStore.getState().reset()
      return startLive()
    }
    const cap = new URLSearchParams(window.location.search).get('capture')
    const last = demoRun.length - 1
    const n = parseInt(cap ?? '', 10) // 1-based; absent/non-numeric → full run
    const upto = Number.isNaN(n) ? last : Math.min(Math.max(n - 1, 0), last)
    runStore.getState().reset()
    for (let i = 0; i <= upto; i++) runStore.getState().applySnapshot(demoRun[i])
  }, [])

  // Drive build generation off the UI thread into uiStore.gen (rendered at M5-T4).
  useGeneration()

  const wands = useRunStore((s) => s.wands)
  const bag = useRunStore((s) => s.spellInventory)
  const perks = useRunStore((s) => s.perks)
  const pool = useRunStore((s) => s.ledger.spells)
  const provenance = useRunStore((s) => s.ledger.provenance)
  const heldWand = activeWand(wands)
  // Owned copy counts (current frame): caps live suggestions to what the player can
  // actually socket — never advise a swap to a spell you don't hold a spare of.
  const caps = useMemo(() => ownedCounts(wands, bag), [wands, bag])

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="rune" aria-hidden="true">☿</span> Wand Grimoire
        </h1>
        {isLive() ? (
          <span className="status-pill" title="streaming live (Tauri file-watch, or the dev bridge with VITE_LIVE)">
            ◉ live
          </span>
        ) : (
          <span className="status-pill" title="reading recorded fixtures (no game needed)">
            ◉ demo data
          </span>
        )}
        <SnapshotSettings />
      </header>

      <div className="dashboard">
        <section className="col col-current">
          <h2 className="section-title">Your Wands</h2>
          {wands.length === 0 ? (
            <p className="empty-note">
              {isLive()
                ? 'Waiting for Noita — enable the wand_capture mod and start a run (press F8 to capture).'
                : 'No wand held in this capture.'}
            </p>
          ) : (
            <div className="wands">
              {wands.map((wand) => (
                <WandPanel key={wand.slot} wand={wand} active={wand === heldWand} />
              ))}
            </div>
          )}

          <h2 className="section-title">Cast Simulation</h2>
          {wands.length === 0 ? (
            <p className="empty-note">No wand to simulate in this capture.</p>
          ) : (
            <div className="cast-sims">
              {wands.map((wand) => (
                <CastSimPanel key={wand.slot} wand={wand} />
              ))}
            </div>
          )}
        </section>

        <section className="col col-builds">
          <h2 className="section-title">Best Builds</h2>
          <TierListPanel wands={wands} perks={perks} pool={pool} provenance={provenance} caps={caps} />
        </section>

        <aside className="col col-run">
          <RunSidebar bag={bag} perks={perks} pool={[...pool]} />
        </aside>
      </div>
    </div>
  )
}

export default App
