import { useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { snapshotPathOverride, setSnapshotPathOverride } from '../bridge/snapshotPath'

/**
 * Packaged-app setting: the absolute path the capture mod writes `snapshot.json` to.
 * Auto-detection covers the standard Steam/Noita locations; this override is the way to
 * point at a Linux/Proton prefix (which can't be auto-derived). Persisted to localStorage
 * and applied on the next launch. Rendered only inside Tauri — in browser dev the Node
 * bridge owns the path (WAND_SNAPSHOT), so there's nothing to set here.
 *
 * Inline-styled on purpose (no shared CSS) so it stays a self-contained drop-in.
 */
export function SnapshotSettings() {
  if (!isTauri()) return null
  return <SnapshotSettingsInner />
}

function SnapshotSettingsInner() {
  const [path, setPath] = useState(() => snapshotPathOverride() ?? '')
  const [saved, setSaved] = useState(false)

  const save = () => {
    setSnapshotPathOverride(path)
    setSaved(true)
  }

  return (
    <details style={{ fontSize: '0.8rem' }}>
      <summary
        style={{ cursor: 'pointer', opacity: 0.8 }}
        title="Where the wand_capture mod writes snapshot.json"
      >
        ⚙ snapshot path
      </summary>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.4rem' }}>
        <input
          type="text"
          value={path}
          spellCheck={false}
          placeholder="auto-detect — set this for Proton"
          onChange={(e) => {
            setPath(e.target.value)
            setSaved(false)
          }}
          style={{
            width: '30rem',
            maxWidth: '55vw',
            fontFamily: 'monospace',
            fontSize: '0.78rem',
            padding: '0.25rem 0.4rem',
          }}
        />
        <button type="button" onClick={save} style={{ cursor: 'pointer' }}>
          save
        </button>
        {saved && <span style={{ opacity: 0.75 }}>saved — restart the app to apply</span>}
      </div>
    </details>
  )
}
