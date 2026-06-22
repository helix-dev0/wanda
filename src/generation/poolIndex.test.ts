import { describe, it, expect } from 'vitest'
import { buildPoolIndex, projectilesByMana, spellMana } from './poolIndex'

describe('buildPoolIndex — bucket pool spells by role', () => {
  it('buckets by feature tag + DB type', () => {
    const ix = buildPoolIndex(['NUKE', 'ADD_TRIGGER', 'DAMAGE', 'LIGHT_BULLET', 'CHAINSAW'])
    expect(ix.nukes).toEqual(['NUKE'])
    expect(ix.triggers).toEqual(['ADD_TRIGGER']) // type OTHER, tagged TRIGGER
    expect(ix.diggers).toEqual(['CHAINSAW'])
    expect(ix.modifiers).toEqual(['DAMAGE']) // type MODIFIER
    // NUKE is itself a type-0 projectile, so it lands in both nukes and projectiles
    expect(ix.projectiles).toEqual(expect.arrayContaining(['NUKE', 'LIGHT_BULLET', 'CHAINSAW']))
    expect(ix.all).toHaveLength(5)
  })

  it('derives MULTICAST from the DRAW_MANY type (not the curated feature map)', () => {
    expect(buildPoolIndex(['BURST_3']).multicasts).toEqual(['BURST_3'])
  })

  it('dedups and preserves first-seen order', () => {
    expect(buildPoolIndex(['LIGHT_BULLET', 'LIGHT_BULLET', 'BOMB']).all).toEqual(['LIGHT_BULLET', 'BOMB'])
  })

  it('puts unknown/modded ids only in `all` and never throws', () => {
    const ix = buildPoolIndex(['TOTALLY_FAKE_SPELL'])
    expect(ix.all).toEqual(['TOTALLY_FAKE_SPELL'])
    expect(ix.projectiles).toEqual([])
    expect(ix.nukes).toEqual([])
  })

  it('orders projectiles cheapest-mana first', () => {
    // CHAINSAW(1) < LIGHT_BULLET(5) < BOMB(25)
    expect(projectilesByMana(buildPoolIndex(['BOMB', 'LIGHT_BULLET', 'CHAINSAW']))).toEqual([
      'CHAINSAW',
      'LIGHT_BULLET',
      'BOMB',
    ])
  })

  it('spellMana reads DB mana; unknown → 0', () => {
    expect(spellMana('NUKE')).toBe(200)
    expect(spellMana('TOTALLY_FAKE_SPELL')).toBe(0)
  })
})
