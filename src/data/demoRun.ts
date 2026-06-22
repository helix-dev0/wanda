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

export const demoRun: Snapshot[] = Object.keys(files)
  .sort()
  .flatMap((key) => {
    const result = ingestSnapshot(files[key])
    return result.ok ? [result.snapshot] : []
  })
