// Resolve the absolute path the app watches for the mod's snapshot.json.
// Precedence: explicit user override (localStorage, set in Settings) → per-OS Steam/Noita
// default (mirrors bridge/watch.mjs:30-35). On Linux/Proton the real file lives under a
// per-install steamapps/compatdata/.../pfx path that can't be auto-derived — there the
// override is the primary mechanism, which is why Settings exposes it.

import { homeDir, join } from '@tauri-apps/api/path'

/** localStorage key for the user's snapshot-path override. */
export const SNAPSHOT_PATH_KEY = 'wand.snapshotPath'

/** The persisted override, or null if unset / storage unavailable. */
export function snapshotPathOverride(): string | null {
  try {
    return localStorage.getItem(SNAPSHOT_PATH_KEY)
  } catch {
    return null
  }
}

/** Persist (or clear, when given an empty string) the snapshot-path override. */
export function setSnapshotPathOverride(path: string): void {
  try {
    if (path.trim()) localStorage.setItem(SNAPSHOT_PATH_KEY, path.trim())
    else localStorage.removeItem(SNAPSHOT_PATH_KEY)
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Best-effort per-OS default snapshot path (matches the bridge's defaults). */
export async function osDefaultSnapshotPath(): Promise<string> {
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)
  if (isWindows) {
    return 'C:/Program Files (x86)/Steam/steamapps/common/Noita/snapshot.json'
  }
  const home = await homeDir()
  return join(home, '.local/share/Steam/steamapps/common/Noita/snapshot.json')
}

/** Override if set, else the per-OS default. */
export async function resolveSnapshotPath(): Promise<string> {
  return snapshotPathOverride() ?? (await osDefaultSnapshotPath())
}
