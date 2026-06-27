import type { LiveStatusData } from '../store/liveStatusStore'

/**
 * Pure presentation of the live-status store: status data → one diagnostic line + a tone.
 * Kept out of the component so the wording for each phase (esp. the failure modes the
 * co-player must distinguish) is unit-tested rather than eyeballed.
 */

export type LiveTone = 'idle' | 'wait' | 'ok' | 'error'
export interface LiveStatusView {
  readonly tone: LiveTone
  readonly text: string
}

/** Coarse "Ns / Nm / Nh ago" (floored), or "just now" under 2s. */
export function relativeAge(ms: number): string {
  if (ms < 2000) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m ago`
  return `${Math.floor(ms / 3_600_000)}h ago`
}

/** Map the live status to a single header line + tone. `now` is injected for testability. */
export function formatLiveStatus(s: LiveStatusData, now: number): LiveStatusView {
  switch (s.phase) {
    case 'idle':
      return { tone: 'idle', text: 'Connecting to the live snapshot…' }
    case 'watching':
      return {
        tone: 'wait',
        text: `Watching ${s.path ?? '…'} — waiting for Noita (start a run with the wand_capture mod enabled)`,
      }
    case 'connected': {
      const age = s.lastUpdate == null ? '' : ` — updated ${relativeAge(now - s.lastUpdate)}`
      const warn = s.error ? ` · last snapshot rejected: ${s.error}` : ''
      // A post-connect ingest reject is a warning, not a dead transport.
      return { tone: s.error ? 'wait' : 'ok', text: `Live${age}${warn}` }
    }
    case 'error':
      return {
        tone: 'error',
        text: `Watch failed: ${s.error ?? 'unknown error'}${s.path ? ` — ${s.path}` : ''}`,
      }
  }
}
