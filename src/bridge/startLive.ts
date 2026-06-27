// Pick the live transport for the current runtime. Inside the packaged Tauri app we watch
// the snapshot file directly via plugin-fs (tauriClient); in a browser (npm run dev) we use
// the Node WebSocket bridge (liveClient). Both converge on the same ingestion boundary, so
// the app's data path is identical either way. The installed app is a live tool by default;
// a plain browser shows recorded fixtures unless VITE_LIVE opts into the dev bridge.

import { isTauri } from '@tauri-apps/api/core'
import { liveEnabled, startLiveBridge } from './liveClient'
import { startTauriWatch } from './tauriClient'
import { resolveSnapshotPath } from './snapshotPath'
import { reportLive } from '../store/liveStatusStore'

/** True when the app should stream live data: running inside Tauri (the installed app),
 *  or VITE_LIVE=1 in browser dev. False → the app replays recorded fixtures. */
export function isLive(): boolean {
  return isTauri() || liveEnabled()
}

/**
 * Start the live transport appropriate to the runtime and return a disposer. In Tauri the
 * snapshot path is resolved (per-OS default or the user's override) before watching; the
 * returned disposer is safe to call before that async resolution completes.
 */
export function startLive(): () => void {
  if (!isTauri()) return startLiveBridge()

  let stopped = false
  let dispose: (() => void) | undefined
  void resolveSnapshotPath().then(({ path, source, searched }) => {
    if (stopped) return
    // Surface the resolved path + how it was chosen, so the status line names it.
    reportLive({ type: 'resolved', path, source, searched })
    dispose = startTauriWatch(path)
    if (stopped) dispose()
  })
  return () => {
    stopped = true
    dispose?.()
  }
}
