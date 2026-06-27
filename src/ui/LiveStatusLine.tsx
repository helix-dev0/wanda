import { useEffect, useState } from 'react'
import { useLiveStatus } from './useLiveStatus'
import { formatLiveStatus } from './liveStatusView'

/**
 * One diagnostic line under the header reporting the live transport's health: which path
 * is being watched, whether snapshots are flowing, and any watch/ingest error. This is the
 * keystone fix — it turns "the app doesn't do anything" into a readable cause the user (or
 * the Windows co-player) can act on. Render only in live mode.
 */
export function LiveStatusLine() {
  const status = useLiveStatus((s) => s)
  // Re-render once a second so "updated Ns ago" stays current between snapshots.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const { tone, text } = formatLiveStatus(status, now)
  return (
    <p className={`live-status live-status--${tone}`} role="status" aria-live="polite">
      {text}
    </p>
  )
}
