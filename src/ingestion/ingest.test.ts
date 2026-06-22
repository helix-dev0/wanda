import { describe, it, expect } from 'vitest'
import { ingestSnapshot, ingestSnapshotText } from './ingest'
import type { Snapshot } from '../schema/snapshot'

// M2-T1: the ingestion boundary. Untrusted snapshot data (a fixture import now,
// a bridge WS message / watched file later) is validated here BEFORE it reaches
// the store. The contract: never throw — malformed input yields { ok: false }
// with field-level issues so the app can show an error state and stay up.
//
// Real captured fixtures are loaded via Vite's import.meta.glob (matches
// data/fixtures.test.ts); malformed cases clone a fixture and mutate the clone
// so they never bleed into the shared module objects.
const fixtures = import.meta.glob('../data/fixtures/snapshot_*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const snap = (suffix: string): unknown => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (key === undefined) throw new Error(`fixture not found: ${suffix}`)
  return fixtures[key]
}
const clone = (suffix: string) => structuredClone(snap(suffix)) as Snapshot
const snapshotKeys = Object.keys(fixtures)

describe('ingestSnapshot — happy path', () => {
  it('ingests every recorded fixture as { ok: true }', () => {
    expect(snapshotKeys.length).toBeGreaterThan(0)
    for (const key of snapshotKeys) {
      const result = ingestSnapshot(fixtures[key])
      expect(result.ok).toBe(true)
    }
  })

  it('returns the typed snapshot on success (values preserved)', () => {
    const result = ingestSnapshot(snap('snapshot_01.json'))
    expect(result.ok).toBe(true)
    if (!result.ok) return // narrows for TS
    expect(result.snapshot.schema).toBe(1)
    expect(result.snapshot.wands[0].spells).toEqual(['RUBBER_BALL', 'RUBBER_BALL'])
    expect(result.snapshot.wands[0].stats.capacity).toBe(2)
  })
})

describe('ingestSnapshot — rejects malformed without throwing', () => {
  it('never throws, whatever the input', () => {
    for (const bad of [null, undefined, 42, 'hello', [], {}, { schema: 1 }]) {
      expect(() => ingestSnapshot(bad)).not.toThrow()
      expect(ingestSnapshot(bad).ok).toBe(false)
    }
  })

  it('reports a missing wand stat with a field-level path', () => {
    const input = clone('snapshot_02.json')
    // @ts-expect-error deliberately constructing an invalid value (required stat)
    delete input.wands[0].stats.mana
    const result = ingestSnapshot(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.path)).toContain('wands.0.stats.mana')
    expect(result.issues[0].message).toBeTruthy()
  })

  it('reports a wrong-typed stat with a field-level path', () => {
    const input = clone('snapshot_02.json')
    // @ts-expect-error deliberately constructing an invalid value (wrong type)
    input.wands[0].stats.shuffle = 'nope'
    const result = ingestSnapshot(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.path)).toContain('wands.0.stats.shuffle')
  })

  it('reports a bad schema version', () => {
    const input = clone('snapshot_01.json')
    // @ts-expect-error deliberately constructing an invalid value (literal 1)
    input.schema = 2
    const result = ingestSnapshot(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((i) => i.path)).toContain('schema')
  })
})

describe('ingestSnapshotText — JSON string boundary (bridge WS / watched file)', () => {
  it('parses + validates a valid JSON string', () => {
    const result = ingestSnapshotText(JSON.stringify(snap('snapshot_03.json')))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.snapshot.wands[0].spells).toEqual(['BUBBLESHOT', 'BUBBLESHOT', 'BUBBLESHOT'])
  })

  it('reports invalid JSON as an issue instead of throwing', () => {
    expect(() => ingestSnapshotText('{ not valid json')).not.toThrow()
    const result = ingestSnapshotText('{ not valid json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0].message.toLowerCase()).toContain('json')
  })

  it('still validates structurally-valid-JSON-but-wrong-shape', () => {
    const result = ingestSnapshotText('{"schema":1}')
    expect(result.ok).toBe(false)
  })
})
