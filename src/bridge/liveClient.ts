// M1-T5 (app side) — consume the live bridge. The bridge sidecar (bridge/watch.mjs)
// watches the mod's snapshot file and pushes its raw text over a WebSocket; here we
// validate each message through the SAME ingestion boundary as fixtures and fold it
// into the run-state store. Fixtures remain the default; this path is opt-in via
// VITE_LIVE so the app always runs without the bridge.

import { ingestSnapshotText, type IngestResult } from '../ingestion/ingest'
import { runStore } from '../store/runStore'
import { reportLive, type LiveStatusEvent } from '../store/liveStatusStore'
import type { Snapshot } from '../schema/snapshot'

/** Default bridge endpoint (matches bridge/watch.mjs's default port). */
export const DEFAULT_BRIDGE_URL = 'ws://localhost:8787'

/** True when the app should run in live mode (VITE_LIVE=1). Fixtures otherwise. */
export function liveEnabled(): boolean {
  const v = import.meta.env.VITE_LIVE
  return v === '1' || v === 'true'
}

/**
 * Apply one bridge message: validate the raw text through the ingestion boundary
 * and, only if valid, hand the snapshot to `apply`. Pure (no socket/store) so it
 * is unit-tested directly; returns the ingest result for callers/tests.
 */
export function handleBridgeMessage(text: string, apply: (s: Snapshot) => void): IngestResult {
  const result = ingestSnapshotText(text)
  if (result.ok) apply(result.snapshot)
  return result
}

/**
 * Connect to the live bridge and stream snapshots into the run-state store as they
 * arrive, auto-reconnecting if the bridge drops. Returns a disposer that stops
 * reconnecting and closes the socket.
 */
export function startLiveBridge(
  url: string = DEFAULT_BRIDGE_URL,
  report: (event: LiveStatusEvent) => void = reportLive,
): () => void {
  let socket: WebSocket | null = null
  let stopped = false
  let retry: ReturnType<typeof setTimeout> | undefined

  const connect = () => {
    if (stopped) return
    socket = new WebSocket(url)
    socket.onopen = () => report({ type: 'watching' })
    socket.onmessage = (e) => {
      const result = handleBridgeMessage(String(e.data), (s) => runStore.getState().applySnapshot(s))
      if (result.ok) report({ type: 'applied', at: Date.now() })
      else report({ type: 'ingest-error', message: result.issues[0]?.message ?? 'invalid snapshot' })
    }
    socket.onclose = () => {
      if (!stopped) {
        report({ type: 'watch-error', message: 'live bridge disconnected — retrying' })
        retry = setTimeout(connect, 1000)
      }
    }
    socket.onerror = () => socket?.close()
  }
  connect()

  return () => {
    stopped = true
    clearTimeout(retry)
    if (!socket) return
    // Closing a still-CONNECTING socket logs "closed before connection established"
    // (e.g. React StrictMode's dev double-mount). Close once it's open instead.
    if (socket.readyState === WebSocket.OPEN) socket.close()
    else socket.addEventListener('open', () => socket?.close(), { once: true })
  }
}
