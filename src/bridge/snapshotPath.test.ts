import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Tauri invoke + path + dialog APIs so this is unit-testable in Node.
const h = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/home/u',
  join: async (...parts: string[]) => parts.join('/'),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: h.open }))

import {
  browseForSnapshotPath,
  resolveSnapshotPath,
  setSnapshotPathOverride,
  SNAPSHOT_PATH_KEY,
} from './snapshotPath'

// The test env is Node (no localStorage); provide an in-memory stub so the override path runs.
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
})

afterEach(() => {
  h.invoke.mockReset()
  h.open.mockReset()
  vi.unstubAllGlobals()
})

describe('resolveSnapshotPath — precedence: override → detect → os-default', () => {
  it('uses the localStorage override first, without calling detect', async () => {
    localStorage.setItem(SNAPSHOT_PATH_KEY, '/custom/snapshot.json')
    const r = await resolveSnapshotPath()
    expect(r).toEqual({ path: '/custom/snapshot.json', source: 'override', searched: [] })
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('uses Rust auto-detect when no override is set', async () => {
    h.invoke.mockResolvedValue({
      snapshot_path: '/games/Noita/snapshot.json',
      install_dir: '/games/Noita',
      searched: ['/c/Noita/snapshot.json', '/games/Noita/snapshot.json'],
    })
    const r = await resolveSnapshotPath()
    expect(r.source).toBe('detect')
    expect(r.path).toBe('/games/Noita/snapshot.json')
    expect(r.searched).toHaveLength(2)
    expect(h.invoke).toHaveBeenCalledWith('detect_noita')
  })

  it('falls back to the per-OS default when detect finds nothing, carrying searched[]', async () => {
    h.invoke.mockResolvedValue({ snapshot_path: null, install_dir: null, searched: ['/c/Noita/snapshot.json'] })
    const r = await resolveSnapshotPath()
    expect(r.source).toBe('os-default')
    expect(r.path).toContain('snapshot.json')
    expect(r.searched).toEqual(['/c/Noita/snapshot.json'])
  })

  it('falls back to the per-OS default when detect is unavailable (browser / invoke throws)', async () => {
    h.invoke.mockRejectedValue(new Error('not tauri'))
    const r = await resolveSnapshotPath()
    expect(r.source).toBe('os-default')
    expect(r.searched).toEqual([])
  })

  it('setSnapshotPathOverride persists, then takes precedence', async () => {
    setSnapshotPathOverride('  /typed/path.json  ') // trimmed on save
    h.invoke.mockResolvedValue({ snapshot_path: '/games/Noita/snapshot.json', install_dir: '/games/Noita', searched: [] })
    const r = await resolveSnapshotPath()
    expect(r).toEqual({ path: '/typed/path.json', source: 'override', searched: [] })
  })
})

describe('browseForSnapshotPath — native file picker fallback', () => {
  it('returns the picked single path', async () => {
    h.open.mockResolvedValue('/picked/snapshot.json')
    expect(await browseForSnapshotPath()).toBe('/picked/snapshot.json')
    expect(h.open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }))
  })

  it('returns null when the dialog is cancelled', async () => {
    h.open.mockResolvedValue(null)
    expect(await browseForSnapshotPath()).toBeNull()
  })

  it('returns null for an unexpected array result', async () => {
    h.open.mockResolvedValue(['/a', '/b'])
    expect(await browseForSnapshotPath()).toBeNull()
  })
})
