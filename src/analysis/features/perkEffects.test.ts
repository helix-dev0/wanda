import { describe, it, expect } from 'vitest'
import type { PerkRef } from '../../schema/snapshot'
import {
  perkEffects,
  activeImmunities,
  perksGrantingImmunity,
  hasSelfProjectileNeutralizer,
} from './perkEffects'

const perk = (id: string, stacks = 1): PerkRef => ({ id, stacks })

describe('perkEffects map', () => {
  it('maps the PROTECTION_* family to its damage-type immunity', () => {
    expect(perkEffects('PROTECTION_FIRE')?.immunities).toEqual(['FIRE'])
    expect(perkEffects('PROTECTION_EXPLOSION')?.immunities).toEqual(['EXPLOSION'])
    expect(perkEffects('PROTECTION_RADIOACTIVITY')?.immunities).toEqual(['TOXIC', 'RADIOACTIVE'])
  })

  it('returns undefined for an unmapped perk', () => {
    expect(perkEffects('GLASS_CANNON')).toBeUndefined()
  })
})

describe('activeImmunities', () => {
  it('the acceptance case: PROTECTION_FIRE ⇒ {FIRE}', () => {
    expect(activeImmunities([perk('PROTECTION_FIRE')])).toEqual(new Set(['FIRE']))
  })

  it('unions immunities across multiple held perks', () => {
    const imm = activeImmunities([perk('PROTECTION_FIRE'), perk('PROTECTION_RADIOACTIVITY')])
    expect(imm).toEqual(new Set(['FIRE', 'TOXIC', 'RADIOACTIVE']))
  })

  it('no perks (the current fixture reality) ⇒ no immunities', () => {
    expect(activeImmunities([]).size).toBe(0)
  })

  it('ignores unmapped perks without throwing', () => {
    expect(activeImmunities([perk('WORM_ATTRACTOR')]).size).toBe(0)
  })
})

describe('perksGrantingImmunity (fixable-by-perk reverse lookup)', () => {
  it('names the perk that grants a hazard immunity', () => {
    expect(perksGrantingImmunity('FIRE')).toEqual(['PROTECTION_FIRE'])
    expect(perksGrantingImmunity('TOXIC')).toEqual(['PROTECTION_RADIOACTIVITY'])
  })
})

describe('hasSelfProjectileNeutralizer', () => {
  it('detects the repulsion/eater family', () => {
    expect(hasSelfProjectileNeutralizer([perk('PROJECTILE_REPULSION')])).toBe(true)
    expect(hasSelfProjectileNeutralizer([perk('PROJECTILE_EATER_SECTOR')])).toBe(true)
  })

  it('is false for unrelated perks', () => {
    expect(hasSelfProjectileNeutralizer([perk('PROTECTION_FIRE')])).toBe(false)
  })
})
