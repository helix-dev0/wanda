// Resolve the absolute path the app watches for the mod's snapshot.json.
// Precedence: explicit user override (localStorage, set in Settings) → per-OS Steam/Noita
// default (mirrors bridge/watch.mjs:30-35). On Linux/Proton the real file lives under a
// per-install steamapps/compatdata/.../pfx path that can't be auto-derived — there the
// override is the primary mechanism, which is why Settings exposes it.

import { homeDir, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { PathSource } from '../store/liveStatusStore'

/** localStorage key for the user's snapshot-path override. */
export const SNAPSHOT_PATH_KEY = 'wand.snapshotPath'

/** Result of the Rust `detect_noita` command (src-tauri/src/noita_detect.rs). */
export interface NoitaDetection {
  snapshot_path: string | null
  install_dir: string | null
  searched: string[]
}

/** A resolved snapshot path plus how it was chosen — feeds the live-status diagnostics. */
export interface ResolvedSnapshot {
  path: string
  source: PathSource
  /** Paths auto-detect probed (when it ran); empty if detection was unavailable. */
  searched: string[]
}

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

/** Ask the Rust backend to locate Noita (parses Steam's libraryfolders.vdf, no fs-scope
 *  wall). Returns null outside Tauri or if the command is unavailable. */
async function detectViaRust(): Promise<NoitaDetection | null> {
  try {
    return await invoke<NoitaDetection>('detect_noita')
  } catch {
    return null // not running in Tauri, or the command isn't registered
  }
}

/**
 * Resolve the snapshot path by precedence: explicit user override → Rust auto-detect of the
 * Steam/Noita install → per-OS hardcoded guess (last resort). The chosen `source` + the probed
 * paths flow into the status line so a wrong/guessed path is visible instead of silent.
 */
export async function resolveSnapshotPath(): Promise<ResolvedSnapshot> {
  const override = snapshotPathOverride()
  if (override) return { path: override, source: 'override', searched: [] }

  const detection = await detectViaRust()
  if (detection?.snapshot_path) {
    return { path: detection.snapshot_path, source: 'detect', searched: detection.searched }
  }

  // Detection found nothing (or is unavailable) — fall back to the best-effort guess, but carry
  // the searched list so the UI can flag that this path is a guess, not a found install.
  return { path: await osDefaultSnapshotPath(), source: 'os-default', searched: detection?.searched ?? [] }
}

/**
 * Open a native file picker for snapshot.json — the escape hatch when auto-detect can't find the
 * install (e.g. a Proton prefix or a non-standard drive). Returns the chosen path, or null if
 * cancelled. (Tauri grants the picked path fs scope for THIS session only — not persisted — and
 * we apply the override on the next launch, so out-of-static-scope picks rely on the capability's
 * fs:scope after restart; the broad Steam/$HOME + C:-H: scope covers the realistic install paths.)
 */
export async function browseForSnapshotPath(): Promise<string | null> {
  const picked = await open({
    multiple: false,
    directory: false,
    title: 'Select the snapshot.json the wand_capture mod writes',
    filters: [{ name: 'snapshot', extensions: ['json'] }],
  })
  return typeof picked === 'string' ? picked : null
}
