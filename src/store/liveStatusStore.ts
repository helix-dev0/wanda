import { createStore } from 'zustand/vanilla'

/**
 * Live-status store — the diagnostic backbone for the packaged app's live pipeline.
 * Mirrors uiStore's vanilla-store pattern (factory + singleton, no React import) so the
 * reducer is Node-testable. Kept SEPARATE from runStore: transport health must not couple
 * to the run-domain reducer, and it must survive the run-reset that fires on a new run_id.
 *
 * Before this, every transport failure was swallowed (missing file, watch() rejection,
 * discarded IngestResult) and the UI showed the same "Waiting for Noita…" regardless — so
 * "the app doesn't do anything" was unreadable. This store surfaces the three distinct
 * failure modes a user must tell apart:
 *   • watching, no data yet      — game not started; normal
 *   • watch-error (phase:error)  — watcher dead / path wrong (the Windows bug)
 *   • ingest-error               — file read OK but the snapshot was rejected (JSON/schema)
 */

export type LivePhase = 'idle' | 'watching' | 'connected' | 'error'
/** How the watched path was chosen (drives the Settings hint shown to the user). */
export type PathSource = 'override' | 'detect' | 'os-default'

export interface LiveStatusData {
  readonly phase: LivePhase
  /** Resolved watch path (Tauri) — null until resolved / in fixtures mode. */
  readonly path: string | null
  readonly source: PathSource | null
  /** Date.now() of the last successful snapshot apply. */
  readonly lastUpdate: number | null
  /** Human-readable diagnostic for the current failure, or null when healthy. */
  readonly error: string | null
}

export type LiveStatusEvent =
  | { type: 'resolved'; path: string; source: PathSource }
  | { type: 'watching' }
  | { type: 'applied'; at: number }
  | { type: 'ingest-error'; message: string }
  | { type: 'watch-error'; message: string }

export interface LiveStatusActions {
  /** Fold a transport event into the status (pure reducer under the hood). */
  report: (event: LiveStatusEvent) => void
  /** Back to fresh (e.g. switching transports / leaving live mode). */
  reset: () => void
}

export type LiveStatusStore = LiveStatusData & LiveStatusActions

/** A fresh, fully-default live status. */
export function freshLiveStatus(): LiveStatusData {
  return { phase: 'idle', path: null, source: null, lastUpdate: null, error: null }
}

/**
 * Pure transition. The phase distinctions are the whole point:
 * - `applied` is the only thing that reaches `connected` + stamps `lastUpdate`.
 * - `watch-error` is the only thing that reaches `error` (a dead watcher).
 * - `ingest-error` keeps the transport phase (the file WAS read) and only sets `error`,
 *   so "data arriving but bad" reads differently from "watcher down".
 * - `watching` never downgrades an established `connected` session and clears a prior
 *   watch-error (the watcher recovered).
 */
export function liveStatusReducer(s: LiveStatusData, e: LiveStatusEvent): LiveStatusData {
  switch (e.type) {
    case 'resolved':
      return { ...s, path: e.path, source: e.source }
    case 'watching':
      return {
        ...s,
        phase: s.phase === 'connected' ? 'connected' : 'watching',
        error: s.phase === 'error' ? null : s.error,
      }
    case 'applied':
      return { ...s, phase: 'connected', lastUpdate: e.at, error: null }
    case 'ingest-error':
      return { ...s, phase: s.phase === 'connected' ? 'connected' : 'watching', error: e.message }
    case 'watch-error':
      return { ...s, phase: 'error', error: e.message }
  }
}

/** Create an isolated live-status store (one per app; factory enables clean tests). */
export function createLiveStatusStore() {
  return createStore<LiveStatusStore>()((set) => ({
    ...freshLiveStatus(),
    report: (event) => set((s) => liveStatusReducer(s, event)),
    reset: () => set(freshLiveStatus()),
  }))
}

export type LiveStatusStoreApi = ReturnType<typeof createLiveStatusStore>

/** The app-wide live-status store. The UI binds to it via `useLiveStatus`. */
export const liveStatusStore = createLiveStatusStore()

/** Default reporter the bridge transports fold their events through. */
export const reportLive = (event: LiveStatusEvent): void => liveStatusStore.getState().report(event)
