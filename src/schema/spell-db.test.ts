import { describe, it, expect } from 'vitest'
import * as v from 'valibot'
import { SpellDbSchema, SpellDbEntrySchema, ACTION_TYPE, parseSpellDb } from './spell-db'

// Realistic entries taken from verbatim gun_actions.lua quotes (vexx32/noita-data):
// a basic projectile, a modifier, a draw-many/multicast, and a limited-use nuke.
const LIGHT_BULLET = {
  id: 'LIGHT_BULLET',
  type: ACTION_TYPE.PROJECTILE,
  name: '$action_light_bullet',
  description: '$actiondesc_light_bullet',
  sprite: 'data/ui_gfx/gun_actions/light_bullet.png',
  related_projectiles: ['data/entities/projectiles/deck/light_bullet.xml'],
  spawn_level: '0,1,2',
  spawn_probability: '2,1,0.5',
  price: 100,
  mana: 5,
  // no max_uses ⇒ unlimited
}
const DAMAGE = {
  id: 'DAMAGE',
  type: ACTION_TYPE.MODIFIER,
  name: '$action_damage',
  description: '$actiondesc_damage',
  price: 140,
  mana: 5,
  custom_xml_file: 'data/entities/misc/custom_cards/damage.xml',
}
const BURST_2 = {
  id: 'BURST_2',
  type: ACTION_TYPE.DRAW_MANY,
  name: '$action_burst_2',
  description: '$actiondesc_burst_2',
  price: 140,
  mana: 0,
}
const BLACK_HOLE = {
  id: 'BLACK_HOLE',
  type: ACTION_TYPE.PROJECTILE,
  name: '$action_black_hole',
  description: '$actiondesc_black_hole',
  price: 200,
  mana: 180,
  max_uses: 3,
  never_unlimited: true,
}
const VALID = [LIGHT_BULLET, DAMAGE, BURST_2, BLACK_HOLE]

function entryErrorPaths(entry: unknown): string[] {
  const r = v.safeParse(SpellDbEntrySchema, entry)
  expect(r.success).toBe(false)
  return r.issues!.map((i) => v.getDotPath(i)).filter((p): p is string => p !== null)
}

describe('SpellDbSchema', () => {
  it('parses a list of real spell entries', () => {
    const db = parseSpellDb(VALID) // throws if invalid
    expect(db).toHaveLength(4)
    expect(db[3].id).toBe('BLACK_HOLE')
    expect(db[3].max_uses).toBe(3)
    expect(db[0].type).toBe(ACTION_TYPE.PROJECTILE)
  })

  it('treats an absent max_uses as valid (unlimited spell)', () => {
    expect(v.safeParse(SpellDbEntrySchema, LIGHT_BULLET).success).toBe(true)
  })

  it('preserves unknown raw-dump fields on output (looseObject round-trip)', () => {
    // gun_actions.lua entries carry fields we do not model (sprite_unidentified,
    // related_extra_entities, modded keys); the engine adapter (M3) may need them.
    const parsed = v.parse(SpellDbEntrySchema, {
      ...LIGHT_BULLET,
      sprite_unidentified: 'data/ui_gfx/gun_actions/light_bullet_unidentified.png',
      modded_field: 7,
    }) as Record<string, unknown>
    expect(parsed.sprite_unidentified).toContain('unidentified')
    expect(parsed.modded_field).toBe(7)
  })

  it('enforces the ACTION_TYPE enum (rejects type 8)', () => {
    expect(entryErrorPaths({ ...LIGHT_BULLET, type: 8 })).toContain('type')
  })

  it('rejects an entry missing its id', () => {
    const noId = { type: ACTION_TYPE.PROJECTILE, name: '$action_x', mana: 5 }
    expect(entryErrorPaths(noId)).toContain('id')
  })

  it('rejects a wrong-typed field (mana as string)', () => {
    expect(entryErrorPaths({ ...LIGHT_BULLET, mana: 'lots' })).toContain('mana')
  })

  it('reports the array index in errors for a bad entry in the DB', () => {
    const r = v.safeParse(SpellDbSchema, [LIGHT_BULLET, { ...DAMAGE, type: 99 }])
    expect(r.success).toBe(false)
    expect(r.issues!.map((i) => v.getDotPath(i))).toContain('1.type')
  })
})
