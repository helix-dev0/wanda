import { describe, it, expect } from 'vitest'
import { spellTile, wandStatRows, SPELL_TYPE_CLASS, resolveSpriteSrc } from './viewModel'
import type { Wand } from '../schema/snapshot'
import type { SpellDbEntry } from '../schema/spell-db'

// M2-T3: the presentational logic the wand panel renders. Kept pure (no React,
// no DOM) so "matches the stat values" is proven in a fast node unit test; the
// actual rendering is verified in a real browser.

const snapshot01Wand: Wand = {
  slot: 0,
  stats: {
    shuffle: false,
    spellsPerCast: 1,
    castDelay: 13,
    rechargeTime: 28,
    manaMax: 83,
    mana: 83,
    manaChargeSpeed: 25,
    capacity: 2,
    spread: 0,
    speedMultiplier: 1,
  },
  always_cast: [],
  spells: ['RUBBER_BALL', 'RUBBER_BALL'],
}

describe('spellTile', () => {
  it('models a known spell with its display name, type, and mana', () => {
    const t = spellTile('RUBBER_BALL')
    expect(t.empty).toBe(false)
    expect(t.name).toBe('Rubber Ball')
    expect(t.typeName).toBe('PROJECTILE')
    expect(t.typeClass).toBe(SPELL_TYPE_CLASS.PROJECTILE)
    expect(t.mana).toBe(5)
    expect(t.alwaysCast).toBe(false)
  })

  it('models an empty deck slot', () => {
    const t = spellTile(null)
    expect(t.empty).toBe(true)
    expect(t.name).toBe('')
    expect(t.typeName).toBeNull()
    expect(t.typeClass).toBe('empty')
  })

  it('flags an always-cast spell', () => {
    expect(spellTile('GRENADE', { alwaysCast: true }).alwaysCast).toBe(true)
  })

  it('degrades gracefully for an unknown (e.g. modded) spell id', () => {
    const t = spellTile('TOTALLY_MADE_UP_SPELL')
    expect(t.empty).toBe(false)
    expect(t.name).toBe('Totally Made Up Spell') // prettified id fallback
    expect(t.typeName).toBeNull()
    expect(t.typeClass).toBe('unknown')
  })

  it('carries uses-remaining for a limited bag spell', () => {
    const t = spellTile('NUKE', { usesRemaining: 1 })
    expect(t.usesRemaining).toBe(1)
    expect(t.mana).toBe(200) // NUKE drains 200 mana
  })

  it('defaults uses-remaining to null (deck spells / unlimited)', () => {
    expect(spellTile('RUBBER_BALL').usesRemaining).toBeNull()
    expect(spellTile(null).usesRemaining).toBeNull()
  })

  it('has no sprite source yet (fixtures carry only a game-internal path)', () => {
    // Real icons arrive once the mod exports sprite bytes + we re-capture (M1).
    expect(spellTile('RUBBER_BALL').spriteSrc).toBeNull()
  })
})

describe('resolveSpriteSrc — sprite-ready, lights up when the mod exports bytes', () => {
  it('returns null without sprite bytes', () => {
    expect(resolveSpriteSrc(undefined)).toBeNull()
    expect(resolveSpriteSrc({ id: 'X', type: 0, name: '$x' } as SpellDbEntry)).toBeNull()
  })

  it('builds a data URL from a base64 sprite the DB dump may carry (looseObject)', () => {
    const entry = { id: 'X', type: 0, name: '$x', sprite_base64: 'AAAA' } as unknown as SpellDbEntry
    expect(resolveSpriteSrc(entry)).toBe('data:image/png;base64,AAAA')
  })
})

describe('wandStatRows', () => {
  it('formats every stat into a labeled row in a stable order', () => {
    const rows = wandStatRows(snapshot01Wand)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(byKey.shuffle).toBe('No')
    expect(byKey.castDelay).toBe('0.22s') // 13 frames @ 60fps
    expect(byKey.rechargeTime).toBe('0.47s') // 28 frames
    expect(byKey.mana).toBe('83/83')
    expect(byKey.capacity).toBe('2')
    expect(byKey.spread).toBe('0.0°')
    // every row carries a human label
    expect(rows.every((r) => r.label.length > 0)).toBe(true)
  })
})
