import { describe, it, expect } from 'vitest'
import { WebSocket } from 'ws'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBridge, readSnapshot } from './watch.mjs'

/** A message queue so no WS message is missed between awaits. */
function collector(ws) {
  const queue = []
  const waiters = []
  ws.on('message', (data) => {
    const s = String(data)
    const w = waiters.shift()
    if (w) w(s)
    else queue.push(s)
  })
  return () =>
    new Promise((resolve, reject) => {
      if (queue.length) return resolve(queue.shift())
      const t = setTimeout(() => reject(new Error('timeout waiting for ws message')), 4000)
      waiters.push((s) => {
        clearTimeout(t)
        resolve(s)
      })
    })
}

describe('live bridge sidecar', () => {
  it('readSnapshot returns null for a missing file (never throws)', async () => {
    expect(await readSnapshot(join(tmpdir(), 'wand-no-such-file-xyz.json'))).toBeNull()
  })

  it('replays the current snapshot on connect and broadcasts the raw text on change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wand-bridge-'))
    const file = join(dir, 'snapshot.json')
    await writeFile(file, '{"v":1}')
    const bridge = await createBridge({ snapshotPath: file, port: 0 })
    try {
      const ws = new WebSocket(`ws://localhost:${bridge.port}`)
      const next = collector(ws)
      await new Promise((r) => ws.once('open', r))

      // connect-replay = the file's current contents
      expect(await next()).toBe('{"v":1}')

      // a write is broadcast verbatim (the bridge does no parsing)
      const changed = next()
      await writeFile(file, '{"v":2}')
      expect(await changed).toBe('{"v":2}')

      ws.close()
    } finally {
      await bridge.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
