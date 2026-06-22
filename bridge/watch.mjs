// M1-T5 — the live bridge sidecar (the only inherently cross-platform bridge,
// spec invariant #7/#8: pure file-watch, no native code). THIN by design: it
// watches the mod's snapshot file and pushes its RAW text to any connected app
// over a WebSocket — all validation happens in the app's ingestion boundary, so
// this stays dumb. Run it alongside the app in live mode:
//
//   WAND_SNAPSHOT=/path/to/snapshot.json node bridge/watch.mjs
//   # then run the app with VITE_LIVE=1
//
// Config (env): WAND_SNAPSHOT (file to watch), WAND_BRIDGE_PORT (default 8787).

import chokidar from 'chokidar'
import { WebSocketServer } from 'ws'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Read the snapshot file's text, or null if it is missing/unreadable. */
export async function readSnapshot(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Best-effort default snapshot path per OS (override with WAND_SNAPSHOT). The
 *  mod's exact output path is finalized at M1-T1; until then this is a guess. */
export function defaultSnapshotPath() {
  if (process.env.WAND_SNAPSHOT) return process.env.WAND_SNAPSHOT
  const linux = join(homedir(), '.local/share/Steam/steamapps/common/Noita/snapshot.json')
  const win = 'C:/Program Files (x86)/Steam/steamapps/common/Noita/snapshot.json'
  return process.platform === 'win32' ? win : linux
}

/**
 * Watch `snapshotPath` and broadcast its text to all WebSocket clients on change.
 * New clients immediately receive the current snapshot (so the app shows state on
 * connect). Returns { port, close } — close() tears down the watcher + server.
 */
export async function createBridge({ snapshotPath, port = 0 }) {
  const wss = new WebSocketServer({ port })
  await new Promise((resolve) => wss.once('listening', resolve))

  let last = await readSnapshot(snapshotPath)
  wss.on('connection', (ws) => {
    if (last != null) ws.send(last)
  })

  const broadcast = (text) => {
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) client.send(text)
    }
  }

  const onChange = async () => {
    const text = await readSnapshot(snapshotPath)
    if (text != null) {
      last = text
      broadcast(text)
    }
  }

  const watcher = chokidar.watch(snapshotPath, {
    // Connect-replay (above) already sends existing state to each client, so skip
    // the initial add; we only need later add (file first appears) + change events.
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }, // mod writes whole-file
  })
  watcher.on('add', onChange).on('change', onChange)

  return {
    port: wss.address().port,
    async close() {
      await watcher.close()
      await new Promise((resolve) => wss.close(resolve))
    },
  }
}

// Run as a script (not when imported by a test).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snapshotPath = defaultSnapshotPath()
  const port = Number(process.env.WAND_BRIDGE_PORT ?? 8787)
  const bridge = await createBridge({ snapshotPath, port })
  console.log(`[wand-bridge] watching ${snapshotPath} → ws://localhost:${bridge.port}`)
}
