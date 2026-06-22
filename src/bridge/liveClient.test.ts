import { describe, it, expect, vi } from 'vitest'
import { handleBridgeMessage, liveEnabled } from './liveClient'
import type { Snapshot } from '../schema/snapshot'

const validText = JSON.stringify({
  schema: 1,
  run_id: 'live-1',
  timestamp: 42,
  player: { perks: [] },
  wands: [],
  spell_inventory: [],
})

describe('handleBridgeMessage — validate + apply a bridge message', () => {
  it('applies a valid snapshot through the ingestion boundary', () => {
    const applied: Snapshot[] = []
    const r = handleBridgeMessage(validText, (s) => applied.push(s))
    expect(r.ok).toBe(true)
    expect(applied).toHaveLength(1)
    expect(applied[0].run_id).toBe('live-1')
  })

  it('does NOT apply malformed JSON (boundary holds)', () => {
    const applied: Snapshot[] = []
    const r = handleBridgeMessage('}{ not json', (s) => applied.push(s))
    expect(r.ok).toBe(false)
    expect(applied).toHaveLength(0)
  })

  it('does NOT apply a schema-invalid snapshot', () => {
    const applied: Snapshot[] = []
    const r = handleBridgeMessage(JSON.stringify({ schema: 1, nope: true }), (s) => applied.push(s))
    expect(r.ok).toBe(false)
    expect(applied).toHaveLength(0)
  })
})

describe('liveEnabled — gated on VITE_LIVE', () => {
  it('defaults to false (fixtures are the default)', () => {
    expect(liveEnabled()).toBe(false)
  })

  it('is true when VITE_LIVE is set', () => {
    vi.stubEnv('VITE_LIVE', '1')
    expect(liveEnabled()).toBe(true)
    vi.unstubAllEnvs()
  })
})
