// Tauri live transport — the packaged native app's equivalent of the Node WS bridge
// (bridge/watch.mjs). Tauri v2's @tauri-apps/plugin-fs `watch` is notify-backed and
// callable from JS, so the installed app watches the mod's snapshot.json directly: no
// localhost WebSocket server, no Node sidecar, no firewall prompt. Each change's raw
// text goes through the SAME ingestion boundary as fixtures and the WS bridge
// (handleBridgeMessage), so the validation + store path stays shared and tested.
// Browser dev (npm run dev) keeps using startLiveBridge() in liveClient.ts.

import { readTextFile, watch } from '@tauri-apps/plugin-fs'
import { handleBridgeMessage } from './liveClient'
import { runStore } from '../store/runStore'
import { reportLive, type LiveStatusEvent } from '../store/liveStatusStore'
import type { Snapshot } from '../schema/snapshot'

const applyToStore = (s: Snapshot) => runStore.getState().applySnapshot(s)

/** Poll-backstop interval (ms). See the backstop note in startTauriWatch. */
const POLL_MS = 1000

/** Parent directory of an absolute path (handles / and \). Pure string op, so it needs
 *  no path-plugin permission. We watch the directory (not the file) so the watcher
 *  survives the snapshot file not existing yet — it fires once the mod creates it. */
function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

/**
 * Watch the snapshot file's directory and stream snapshots into the run-state store as
 * the mod rewrites the file. Reads the current file immediately (connect-replay, like
 * bridge/watch.mjs:46-49), then re-reads on each change, deduping identical content
 * (mirrors the bridge's `last` guard). A missing/unreadable file (game not started yet)
 * is ignored. Returns a disposer that stops watching.
 *
 * `apply` is injectable for tests; production folds each snapshot into the store.
 */
export function startTauriWatch(
  path: string,
  apply: (s: Snapshot) => void = applyToStore,
  report: (event: LiveStatusEvent) => void = reportLive,
): () => void {
  let stopped = false
  let unwatch: (() => void) | undefined
  let poll: ReturnType<typeof setInterval> | undefined
  let lastText: string | null = null

  const pump = async () => {
    let text: string
    try {
      text = await readTextFile(path)
    } catch {
      return // file missing/unreadable — game not running yet (stay 'watching', not an error)
    }
    if (text === lastText) return // unrelated dir churn / identical rewrite
    lastText = text
    const result = handleBridgeMessage(text, apply)
    if (result.ok) report({ type: 'applied', at: Date.now() })
    else report({ type: 'ingest-error', message: result.issues[0]?.message ?? 'invalid snapshot' })
  }

  void (async () => {
    await pump() // replay current state on start
    if (stopped) return
    try {
      unwatch = await watch(parentDir(path), () => { if (!stopped) void pump() }, { delayMs: 200 })
      if (stopped) { unwatch(); return } // stopped while awaiting → don't leak / don't poll
      report({ type: 'watching' })
    } catch (err) {
      // watch unavailable (bad scope / wrong or missing dir) — surface it, don't swallow.
      report({ type: 'watch-error', message: err instanceof Error ? err.message : String(err) })
    }
    // Poll backstop: notify-based watch can silently fail to DELIVER events on some
    // platforms (notably the untestable Windows/Proton seam) even when watch() resolves.
    // The mod rewrites the whole file ~2x/sec and pump() dedups by content, so a periodic
    // re-read guarantees updates everywhere at negligible cost — and also covers the file
    // first appearing after the app started. Watch stays for sub-second responsiveness.
    if (!stopped) {
      poll = setInterval(() => { if (!stopped) void pump() }, POLL_MS)
      // In Node (tests) unref so a leftover interval can't keep the process alive; no-op in
      // the browser/webview (number has no unref), where the poll runs normally.
      ;(poll as unknown as { unref?: () => void }).unref?.()
    }
  })()

  return () => {
    stopped = true
    unwatch?.()
    if (poll) clearInterval(poll)
  }
}
