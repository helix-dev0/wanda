import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { PerkDbSchema, PerkDbEntrySchema, parsePerkDb } from './perk-db'

// Realistic entries from verbatim perk_list.lua quotes (NathanSnail/noitadata):
const EXTRA_MONEY = {
  id: 'EXTRA_MONEY',
  ui_name: '$perk_extra_money',
  ui_description: '$perkdesc_extra_money',
  ui_icon: 'data/ui_gfx/perk_icons/extra_money.png',
  perk_icon: 'data/items_gfx/perks/extra_money.png',
  game_effect: 'EXTRA_MONEY',
  stackable: true,
}
const PROTECTION_FIRE = {
  id: 'PROTECTION_FIRE',
  ui_name: '$perk_protection_fire',
  ui_description: '$perkdesc_protection_fire',
  ui_icon: 'data/ui_gfx/perk_icons/protection_fire.png',
  perk_icon: 'data/items_gfx/perks/protection_fire.png',
  game_effect: 'PROTECTION_FIRE',
  stackable: false,
  usable_by_enemies: true,
}
const GLASS_CANNON = {
  id: 'GLASS_CANNON',
  ui_name: '$perk_glass_cannon',
  ui_description: '$perkdesc_glass_cannon',
  ui_icon: 'data/ui_gfx/perk_icons/glass_cannon.png',
  perk_icon: 'data/items_gfx/perks/glass_cannon.png',
  game_effect: 'DAMAGE_MULTIPLIER',
  stackable: true,
  stackable_is_rare: true,
  stackable_maximum: 2,
  max_in_perk_pool: 2,
  usable_by_enemies: true,
}
const VALID = [EXTRA_MONEY, PROTECTION_FIRE, GLASS_CANNON]

function entryErrorPaths(entry: unknown): string[] {
  const r = v.safeParse(PerkDbEntrySchema, entry)
  expect(r.success).toBe(false)
  return r.issues!.map((i) => v.getDotPath(i)).filter((p): p is string => p !== null)
}

describe('PerkDbSchema', () => {
  it('parses a list of real perk entries', () => {
    const db = parsePerkDb(VALID) // throws if invalid
    expect(db).toHaveLength(3)
    expect(db[1].id).toBe('PROTECTION_FIRE')
    expect(db[2].stackable_maximum).toBe(2)
  })

  it('preserves unknown raw-dump fields on output (looseObject round-trip)', () => {
    // The real dump carries fields the app does not model (_tags, script_*, etc.);
    // looseObject must KEEP them on output so M3/M4 enrichment can still read them.
    const withExtras = { ...PROTECTION_FIRE, _tags: 'protection', script_source_file: 'x.lua' }
    const parsed = v.parse(PerkDbEntrySchema, withExtras) as Record<string, unknown>
    expect(parsed._tags).toBe('protection')
    expect(parsed.script_source_file).toBe('x.lua')
  })

  it('accepts an app-computed effects block and enforces the immunity enum', () => {
    const enriched = { ...PROTECTION_FIRE, effects: { immunities: ['FIRE'], modifiers: {} } }
    expect(v.safeParse(PerkDbEntrySchema, enriched).success).toBe(true)
    const bad = { ...PROTECTION_FIRE, effects: { immunities: ['BANANA'], modifiers: {} } }
    expect(entryErrorPaths(bad)).toContain('effects.immunities.0')
  })

  it('rejects a perk missing ui_name', () => {
    const noName = { id: 'PROTECTION_FIRE', ui_description: '$perkdesc_protection_fire' }
    expect(entryErrorPaths(noName)).toContain('ui_name')
  })

  it('rejects a wrong-typed field (stackable as number)', () => {
    expect(entryErrorPaths({ ...PROTECTION_FIRE, stackable: 1 })).toContain('stackable')
  })

  it('reports the array index in errors for a bad entry in the DB', () => {
    const r = v.safeParse(PerkDbSchema, [EXTRA_MONEY, { ...GLASS_CANNON, ui_name: 123 }])
    expect(r.success).toBe(false)
    expect(r.issues!.map((i) => v.getDotPath(i))).toContain('1.ui_name')
  })
})
