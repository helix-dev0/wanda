import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Snapshot } from '../schema/snapshot'

// Mock @tauri-apps/plugin-fs. Everything the hoisted vi.mock factory touches must come
// from vi.hoisted() (it runs before normal top-level consts are initialized).
const h = vi.hoisted(() => {
  const state: { cb?: () => void } = {}
  const unwatch = vi.fn()
  const readTextFile = vi.fn()
  const watch = vi.fn(async (_paths: unknown, cb: () => void) => {
    state.cb = cb
    return unwatch
  })
  return { state, unwatch, readTextFile, watch }
})

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: h.readTextFile,
  watch: h.watch,
}))

import { startTauriWatch } from './tauriClient'

const snap = (run_id: string) =>
  JSON.stringify({ schema: 1, run_id, timestamp: 1, player: { perks: [] }, wands: [], spell_inventory: [] })

const tick = () => new Promise((r) => setTimeout(r, 10))

beforeEach(() => {
  h.readTextFile.mockReset()
  h.watch.mockClear()
  h.unwatch.mockClear()
  h.state.cb = undefined
})

describe('startTauriWatch — Tauri fs-watch live transport', () => {
  it('replays the current snapshot on start (initial read → apply)', async () => {
    h.readTextFile.mockResolvedValue(snap('run-a'))
    const applied: Snapshot[] = []
    startTauriWatch('/noita/snapshot.json', (s) => applied.push(s))
    await vi.waitFor(() => expect(applied).toHaveLength(1))
    expect(applied[0].run_id).toBe('run-a')
  })

  it('re-reads + applies on each change, deduping identical content', async () => {
    h.readTextFile.mockResolvedValue(snap('run-a'))
    const applied: Snapshot[] = []
    startTauriWatch('/noita/snapshot.json', (s) => applied.push(s))
    await vi.waitFor(() => expect(h.state.cb).toBeTypeOf('function'))
    await vi.waitFor(() => expect(applied).toHaveLength(1))

    h.state.cb!() // identical content → deduped, no second apply
    await tick()
    expect(applied).toHaveLength(1)

    h.readTextFile.mockResolvedValue(snap('run-b')) // changed → applied
    h.state.cb!()
    await vi.waitFor(() => expect(applied).toHaveLength(2))
    expect(applied[1].run_id).toBe('run-b')
  })

  it('ignores a missing/unreadable file (no throw, no apply)', async () => {
    h.readTextFile.mockRejectedValue(new Error('ENOENT'))
    const applied: Snapshot[] = []
    startTauriWatch('/noita/snapshot.json', (s) => applied.push(s))
    await tick()
    expect(applied).toHaveLength(0)
  })

  it('disposer stops watching', async () => {
    h.readTextFile.mockResolvedValue(snap('run-a'))
    const stop = startTauriWatch('/noita/snapshot.json', () => {})
    await vi.waitFor(() => expect(h.watch).toHaveBeenCalled())
    stop()
    expect(h.unwatch).toHaveBeenCalledTimes(1)
  })
})

describe('startTauriWatch — live-status reporting (the diagnostics fix)', () => {
  it('reports applied + watching on a valid replay', async () => {
    h.readTextFile.mockResolvedValue(snap('run-a'))
    const report = vi.fn()
    startTauriWatch('/noita/snapshot.json', () => {}, report)
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ type: 'applied' })))
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith({ type: 'watching' }))
  })

  it('reports watch-error when watch() rejects (the previously-silent Windows failure)', async () => {
    h.readTextFile.mockResolvedValue(snap('run-a'))
    h.watch.mockRejectedValueOnce(new Error('forbidden path'))
    const report = vi.fn()
    startTauriWatch('/noita/snapshot.json', () => {}, report)
    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith({ type: 'watch-error', message: 'forbidden path' }),
    )
  })

  it('reports ingest-error on malformed snapshot text (transport alive, data bad)', async () => {
    h.readTextFile.mockResolvedValue('}{ not json')
    const report = vi.fn()
    startTauriWatch('/noita/snapshot.json', () => {}, report)
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ type: 'ingest-error' })))
  })

  it('a missing file stays watching — no applied/ingest-error', async () => {
    h.readTextFile.mockRejectedValue(new Error('ENOENT'))
    const report = vi.fn()
    startTauriWatch('/noita/snapshot.json', () => {}, report)
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith({ type: 'watching' }))
    expect(report).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'applied' }))
    expect(report).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ingest-error' }))
  })
})

describe('startTauriWatch — poll backstop (cross-platform guarantee)', () => {
  it('re-reads on the interval even when the watcher never delivers an event', async () => {
    vi.useFakeTimers()
    try {
      h.readTextFile.mockResolvedValue(snap('run-a'))
      const applied: Snapshot[] = []
      const stop = startTauriWatch('/noita/snapshot.json', (s) => applied.push(s))
      await vi.advanceTimersByTimeAsync(0) // flush replay + watch setup
      expect(applied).toHaveLength(1)

      // Mod rewrites the file, but NO watch callback fires (notify silently dropped it).
      h.readTextFile.mockResolvedValue(snap('run-b'))
      await vi.advanceTimersByTimeAsync(1100) // poll fires → picks up the change anyway
      expect(applied).toHaveLength(2)
      expect(applied[1].run_id).toBe('run-b')
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
