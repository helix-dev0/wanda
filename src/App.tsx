import { useEffect, useState } from 'react'
import { runStore } from './store/runStore'
import { useRunStore } from './ui/useRunStore'
import { demoRun } from './data/demoRun'
import { WandPanel } from './ui/WandPanel'

/**
 * M2 live-mirror shell. Drives the run-state store from the recorded fixtures via
 * a frame stepper (the fixture-driven default; live bridge data replaces this at
 * M1-T5). Replaying frames 0..n from a reset keeps the seen-this-run pool exact.
 * T3 renders the wand panels; T4 will add the spell-pool / perks / ledger side.
 */
function App() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    runStore.getState().reset()
    for (let i = 0; i <= frame && i < demoRun.length; i++) {
      runStore.getState().applySnapshot(demoRun[i])
    }
  }, [frame])

  const wands = useRunStore((s) => s.wands)
  const runId = useRunStore((s) => s.runId)
  const timestamp = useRunStore((s) => s.timestamp)
  const poolSize = useRunStore((s) => s.ledger.spells.size)

  const atStart = frame === 0
  const atEnd = frame >= demoRun.length - 1

  return (
    <div className="app">
      <header className="app-header">
        <div className="title-block">
          <h1>
            <span className="rune" aria-hidden="true">☿</span> Wand Grimoire
          </h1>
          <p className="tagline">live mirror of the current run</p>
        </div>

        <dl className="run-meta">
          <div>
            <dt>run</dt>
            <dd>{runId ?? '—'}</dd>
          </div>
          <div>
            <dt>frame</dt>
            <dd>{timestamp ?? '—'}</dd>
          </div>
          <div>
            <dt>pool</dt>
            <dd>{poolSize} seen</dd>
          </div>
        </dl>

        <div className="stepper" role="group" aria-label="fixture stepper">
          <button type="button" onClick={() => setFrame((f) => Math.max(0, f - 1))} disabled={atStart}>
            ‹ prev
          </button>
          <span className="frame-count">
            fixture {frame + 1} / {demoRun.length}
          </span>
          <button
            type="button"
            onClick={() => setFrame((f) => Math.min(demoRun.length - 1, f + 1))}
            disabled={atEnd}
          >
            next ›
          </button>
        </div>
      </header>

      <main className="wands">
        {wands.length === 0 ? (
          <p className="empty-note">No wands in this snapshot.</p>
        ) : (
          wands.map((wand) => <WandPanel key={wand.slot} wand={wand} />)
        )}
      </main>
    </div>
  )
}

export default App
