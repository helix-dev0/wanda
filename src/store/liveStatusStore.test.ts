import { describe, expect, it } from 'vitest'
import {
  createLiveStatusStore,
  freshLiveStatus,
  liveStatusReducer,
  type LiveStatusData,
} from './liveStatusStore'

// The live-status store is the diagnostic backbone for the packaged app's live
// pipeline: it turns the previously-silent transport failures into a readable
// phase + message. These tests pin the reducer's three required distinctions —
// "watching but no data yet" vs "watcher dead / path wrong" vs "data arriving but
// rejected" — which the co-player needs to tell apart from a single status line.

const fresh = freshLiveStatus()

describe('freshLiveStatus', () => {
  it('starts idle with nothing resolved', () => {
    expect(fresh).toEqual<LiveStatusData>({
      phase: 'idle',
      path: null,
      source: null,
      searched: [],
      lastUpdate: null,
      error: null,
    })
  })
})

describe('liveStatusReducer', () => {
  it('resolved records path + source (+ searched) without leaving idle (not watching yet)', () => {
    const s = liveStatusReducer(fresh, {
      type: 'resolved',
      path: '/n/snapshot.json',
      source: 'detect',
      searched: ['/a/snapshot.json', '/n/snapshot.json'],
    })
    expect(s.path).toBe('/n/snapshot.json')
    expect(s.source).toBe('detect')
    expect(s.searched).toEqual(['/a/snapshot.json', '/n/snapshot.json'])
    expect(s.phase).toBe('idle')
  })

  it('watching moves idle → watching with no error', () => {
    const s = liveStatusReducer({ ...fresh, phase: 'idle' }, { type: 'watching' })
    expect(s.phase).toBe('watching')
    expect(s.error).toBeNull()
  })

  it('applied → connected, stamps lastUpdate, clears any error', () => {
    const prev: LiveStatusData = { ...fresh, phase: 'watching', error: 'snapshot rejected: bad' }
    const s = liveStatusReducer(prev, { type: 'applied', at: 1234 })
    expect(s.phase).toBe('connected')
    expect(s.lastUpdate).toBe(1234)
    expect(s.error).toBeNull()
  })

  it('ingest-error keeps the transport phase (watching) and only sets the message', () => {
    const s = liveStatusReducer({ ...fresh, phase: 'watching' }, { type: 'ingest-error', message: 'invalid JSON' })
    expect(s.phase).toBe('watching') // transport alive — NOT a watch error
    expect(s.error).toBe('invalid JSON')
  })

  it('ingest-error after connected stays connected (file was read, just bad now)', () => {
    const prev: LiveStatusData = { ...fresh, phase: 'connected', lastUpdate: 9 }
    const s = liveStatusReducer(prev, { type: 'ingest-error', message: 'schema: wands' })
    expect(s.phase).toBe('connected')
    expect(s.error).toBe('schema: wands')
    expect(s.lastUpdate).toBe(9) // last good update preserved
  })

  it('watch-error → error phase with the message (the invisible Windows bug, now visible)', () => {
    const s = liveStatusReducer({ ...fresh, phase: 'watching' }, { type: 'watch-error', message: 'dir not found' })
    expect(s.phase).toBe('error')
    expect(s.error).toBe('dir not found')
  })

  it('watching does not downgrade a connected session', () => {
    const prev: LiveStatusData = { ...fresh, phase: 'connected', lastUpdate: 5 }
    const s = liveStatusReducer(prev, { type: 'watching' })
    expect(s.phase).toBe('connected')
    expect(s.lastUpdate).toBe(5)
  })

  it('watching clears a prior watch-error (watcher recovered)', () => {
    const prev: LiveStatusData = { ...fresh, phase: 'error', error: 'dir not found' }
    const s = liveStatusReducer(prev, { type: 'watching' })
    expect(s.phase).toBe('watching')
    expect(s.error).toBeNull()
  })
})

describe('createLiveStatusStore', () => {
  it('report() folds events through the reducer; reset() returns to fresh', () => {
    const store = createLiveStatusStore()
    store.getState().report({ type: 'resolved', path: '/p', source: 'override' })
    store.getState().report({ type: 'watching' })
    store.getState().report({ type: 'applied', at: 42 })
    expect(store.getState().phase).toBe('connected')
    expect(store.getState().path).toBe('/p')
    expect(store.getState().lastUpdate).toBe(42)

    store.getState().reset()
    const { phase, path, source, searched, lastUpdate, error } = store.getState()
    expect({ phase, path, source, searched, lastUpdate, error }).toEqual(freshLiveStatus())
  })
})
