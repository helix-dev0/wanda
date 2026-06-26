import { describe, it, expect } from 'vitest'
import { buildPoolIndex, projectilesByMana, spellMana, isDamageModifier, damageModifiers } from './poolIndex'

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

describe('damageModifiers — sim-grounded allowlist (not a blocklist)', () => {
  it('isDamageModifier TRUE for modifiers that raise a real damage field', () => {
    expect(isDamageModifier('DAMAGE')).toBe(true) // damage_projectile_add += 0.4
    expect(isDamageModifier('CRITICAL_HIT')).toBe(true) // damage_critical_chance += 15
  })

  it('isDamageModifier FALSE for utility modifiers with no damage field (the bug)', () => {
    expect(isDamageModifier('BURN_TRAIL')).toBe(false) // fire trail — game_effect_entities, no damage
    expect(isDamageModifier('HOMING')).toBe(false) // accuracy, not damage
    expect(isDamageModifier('HEAVY_SPREAD')).toBe(false) // spread, not damage
  })

  it('isDamageModifier FALSE for an unknown/modded id (never throws, defaults out)', () => {
    expect(isDamageModifier('TOTALLY_FAKE_SPELL')).toBe(false)
  })

  it('damageModifiers keeps Damage Plus but drops Fire Trail / Homing', () => {
    const dm = damageModifiers(buildPoolIndex(['DAMAGE', 'BURN_TRAIL', 'HOMING', 'LIGHT_BULLET']))
    expect(dm).toContain('DAMAGE')
    expect(dm).not.toContain('BURN_TRAIL')
    expect(dm).not.toContain('HOMING')
  })
})
