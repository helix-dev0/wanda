import { describe, it, expect } from 'vitest'
import { parseSnapshot } from '../schema/snapshot'
import { parseSpellDb } from '../schema/spell-db'
import { parsePerkDb } from '../schema/perk-db'

// M0-T5: every recorded fixture (captured from the real game by the mod) must
// parse against the schemas. If one fails, the SCHEMA is wrong — real data is
// the source of truth — so fix the schema, not the fixture.
//
// Fixtures are eager-loaded via Vite's import.meta.glob (no node:fs; runs under
// vitest), so new snapshot_*.json files are auto-discovered.
const fixtures = import.meta.glob('./fixtures/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

const fixture = (suffix: string): unknown => {
  const key = Object.keys(fixtures).find((k) => k.endsWith('/' + suffix))
  if (key === undefined) throw new Error(`fixture not found: ${suffix}`)
  return fixtures[key]
}
const snapshotKeys = Object.keys(fixtures).filter((k) => /\/snapshot_[^/]+\.json$/.test(k))

describe('recorded fixtures parse against the schemas', () => {
  it('has at least one snapshot fixture', () => {
    expect(snapshotKeys.length).toBeGreaterThan(0)
  })

  it.each(snapshotKeys.map((k) => [k] as [string]))('%s parses cleanly', (key) => {
    const snap = parseSnapshot(fixtures[key]) // throws on any schema violation
    expect(snap.schema).toBe(1)
    expect(Array.isArray(snap.wands)).toBe(true)
  })

  it('snapshot_01 is the captured starting wand (RUBBER_BALL x2, capacity 2)', () => {
    const snap = parseSnapshot(fixture('snapshot_01.json'))
    expect(snap.wands[0].spells).toEqual(['RUBBER_BALL', 'RUBBER_BALL'])
    expect(snap.wands[0].stats.capacity).toBe(2)
    expect(snap.wands[0].stats.shuffle).toBe(false)
  })

  it('spell_db parses; numeric types in range; unmodeled keys preserved', () => {
    const db = parseSpellDb(fixture('spell_db.json'))
    expect(db.length).toBeGreaterThan(400)
    for (const s of db) expect(s.type).toBeGreaterThanOrEqual(0)
    const bomb = db.find((s) => s.id === 'BOMB')!
    expect(bomb.type).toBe(0)
    // looseObject must keep fields the schema does not model
    expect((bomb as Record<string, unknown>).sprite_unidentified).toContain('unidentified')
  })

  it('perk_db parses; stackable is boolean; unmodeled keys preserved', () => {
    const db = parsePerkDb(fixture('perk_db.json'))
    expect(db.length).toBeGreaterThan(100)
    const crit = db.find((p) => p.id === 'CRITICAL_HIT')!
    expect(crit.stackable).toBe(true)
    expect((crit as Record<string, unknown>).particle_effect).toBe('critical_hit_boost')
  })
})
