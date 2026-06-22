import * as v from 'valibot'
import { SnapshotSchema, type Snapshot } from '../schema/snapshot'

/**
 * Ingestion boundary (spec §3.2 module 1, plan M2-T1).
 *
 * The single choke point where untrusted snapshot data — a fixture import today,
 * a bridge WebSocket message / watched `snapshot.json` later (M1-T5) — is
 * validated against the schema before it reaches the run-state store (M2-T2).
 *
 * Contract: **never throws.** Malformed input returns `{ ok: false }` carrying
 * flattened field-level issues, so the UI can show an error state and the app
 * stays up (the snapshot schema's own `parseSnapshot` throws; this is the
 * non-throwing boundary its doc-comment points to).
 */

/** A single field-level validation problem, flattened for display. */
export interface IngestIssue {
  /** Dotted path to the offending field (e.g. `wands.0.stats.mana`), or `''`
   *  for a root-level problem (bad JSON, wrong root type, missing top-level key). */
  path: string
  message: string
}

/** Outcome of ingesting untrusted snapshot data. Discriminated on `ok`. */
export type IngestResult =
  | { ok: true; snapshot: Snapshot }
  | { ok: false; issues: IngestIssue[] }

/** Validate an already-parsed value (e.g. a fixture import) into a Snapshot. */
export function ingestSnapshot(data: unknown): IngestResult {
  const result = v.safeParse(SnapshotSchema, data)
  if (result.success) return { ok: true, snapshot: result.output }
  return {
    ok: false,
    issues: result.issues.map((issue) => ({
      path: v.getDotPath(issue) ?? '',
      message: issue.message,
    })),
  }
}

/** Validate a raw JSON string (a bridge WS message or watched-file read). Bad
 *  JSON is reported as an issue rather than thrown, so the boundary holds. */
export function ingestSnapshotText(text: string): IngestResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, issues: [{ path: '', message: `invalid JSON: ${message}` }] }
  }
  return ingestSnapshot(data)
}
