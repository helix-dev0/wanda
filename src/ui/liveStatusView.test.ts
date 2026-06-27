import { describe, expect, it } from 'vitest'
import { formatLiveStatus, relativeAge } from './liveStatusView'
import { freshLiveStatus, type LiveStatusData } from '../store/liveStatusStore'

const base = freshLiveStatus()

describe('relativeAge', () => {
  it('reads as just-now / seconds / minutes / hours', () => {
    expect(relativeAge(500)).toBe('just now')
    expect(relativeAge(3000)).toBe('3s ago')
    expect(relativeAge(65_000)).toBe('1m ago')
    expect(relativeAge(2 * 3_600_000)).toBe('2h ago')
  })
})

describe('formatLiveStatus', () => {
  it('idle → connecting', () => {
    expect(formatLiveStatus(base, 0).tone).toBe('idle')
  })

  it('watching names the watched path so a wrong path is visible', () => {
    const s: LiveStatusData = { ...base, phase: 'watching', path: 'C:/Games/Noita/snapshot.json' }
    const v = formatLiveStatus(s, 0)
    expect(v.tone).toBe('wait')
    expect(v.text).toContain('C:/Games/Noita/snapshot.json')
    expect(v.text).toMatch(/waiting for Noita/i)
  })

  it('connected shows a relative last-update and reads ok', () => {
    const s: LiveStatusData = { ...base, phase: 'connected', lastUpdate: 1000 }
    const v = formatLiveStatus(s, 4000)
    expect(v.tone).toBe('ok')
    expect(v.text).toContain('Live')
    expect(v.text).toContain('3s ago')
  })

  it('connected-but-rejected warns without dropping the live state', () => {
    const s: LiveStatusData = { ...base, phase: 'connected', lastUpdate: 1000, error: 'schema: wands' }
    const v = formatLiveStatus(s, 2000)
    expect(v.tone).toBe('wait')
    expect(v.text).toMatch(/rejected/i)
    expect(v.text).toContain('schema: wands')
  })

  it('watch-error reads as an error and names the bad path', () => {
    const s: LiveStatusData = { ...base, phase: 'error', error: 'dir not found', path: 'D:/Noita/snapshot.json' }
    const v = formatLiveStatus(s, 0)
    expect(v.tone).toBe('error')
    expect(v.text).toMatch(/watch failed/i)
    expect(v.text).toContain('D:/Noita/snapshot.json')
  })
})
