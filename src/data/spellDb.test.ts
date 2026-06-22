import { describe, it, expect } from 'vitest'
import { spellDb, getSpell, spellDisplayName, spellTypeName } from './spellDb'

// M2: read-only spell-DB lookup over the recorded spell_db.json fixture.
// Fixture-driven (no live game); asserts known spells resolve and unknown ids
// are handled safely without throwing.

describe('spellDb lookup module', () => {
  it('indexes every spell by id (>400 entries)', () => {
    expect(spellDb.size).toBeGreaterThan(400)
  })

  it('getSpell returns the entry for a known id', () => {
    const rubber = getSpell('RUBBER_BALL')
    expect(rubber).toBeDefined()
    expect(rubber?.id).toBe('RUBBER_BALL')
    expect(rubber?.name).toBe('$action_rubber_ball')
  })

  it('getSpell returns undefined for an unknown id', () => {
    expect(getSpell('NOT_A_REAL_SPELL')).toBeUndefined()
  })

  it('spellDisplayName prettifies the id (self-contained, no loc key)', () => {
    expect(spellDisplayName('RUBBER_BALL')).toBe('Rubber Ball')
    expect(spellDisplayName('BLACK_HOLE')).toBe('Black Hole')
    expect(spellDisplayName('GRENADE')).toBe('Grenade')
    expect(spellDisplayName('BUBBLESHOT')).toBe('Bubbleshot')
    expect(spellDisplayName('NUKE')).toBe('Nuke')
  })

  it('spellDisplayName falls back to the prettified id for an unknown spell (never throws)', () => {
    expect(spellDisplayName('SOME_UNKNOWN_SPELL')).toBe('Some Unknown Spell')
  })

  it('spellTypeName maps the numeric type to its name for known spells', () => {
    expect(spellTypeName('RUBBER_BALL')).toBe('PROJECTILE')
    expect(spellTypeName('GRENADE')).toBe('PROJECTILE')
    expect(spellTypeName('BUBBLESHOT')).toBe('PROJECTILE')
    expect(spellTypeName('NUKE')).toBe('PROJECTILE')
  })

  it('spellTypeName returns undefined for an unknown id', () => {
    expect(spellTypeName('NOT_A_REAL_SPELL')).toBeUndefined()
  })
})
