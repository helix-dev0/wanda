import { ingestSnapshot } from '../ingestion/ingest'
import type { Snapshot } from '../schema/snapshot'

/**
 * The recorded fixtures, ingested through the validation boundary and ordered by
 * filename — a replayable "demo run" the app steps through to exercise the live
 * mirror + the seen-this-run pool entirely without the game (the fixture-driven
 * default; live data replaces this behind a flag at M1-T5).
 *
 * Malformed fixtures are skipped rather than crashing the app (the ingestion
 * contract); in practice all committed fixtures are schema-valid.
 */
const files = import.meta.glob('./fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const all: Snapshot[] = Object.keys(files)
  .sort()
  .flatMap((key) => {
    const result = ingestSnapshot(files[key])
    return result.ok ? [result.snapshot] : []
  })

// demoRun is ONE replayable run. Other-run scenario fixtures share this folder (e.g.
// the quantity-fix snapshot_05, run-50) but must NOT be appended — applying a second
// run_id would reset the ledger mid-demo and bury the curated run-10 view. Keep only
// the first run's snapshots; reach a scenario fixture via its own test, not the demo.
const firstRunId = all[0]?.run_id
export const demoRun: Snapshot[] = all.filter((s) => s.run_id === firstRunId)
